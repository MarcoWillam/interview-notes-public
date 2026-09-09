import {
  encodeInitialRequest,
  encodeAudio,
  decodeResponse,
} from './protocol.ts';

export type AsrEnv = {
  ASR_PROVIDER?: string;
  ASR_API_KEY?: string;
  ASR_RESOURCE_ID?: string;
};
export interface AsrSocket {
  binaryType?: string;
  accept(): void;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void,
  ): void;
}
type Timers = {
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (timer: unknown) => void;
};
const defaultTimers: Timers = {
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
const MAX_FRAME = 32000;
const MAX_SESSION_BYTES = 16000 * 2 * 15 * 60;
const MAX_QUEUE_BYTES = 256 * 1024;
type BinaryData = ArrayBuffer | ArrayBufferView | Blob;
function binarySize(data: unknown): number | null {
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
    return data.byteLength;
  if (data instanceof Blob) return data.size;
  return null;
}
async function binaryBytes(data: BinaryData): Promise<Uint8Array> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}
export function startAsrRelay(
  browser: AsrSocket,
  upstream: AsrSocket,
  timers: Timers = defaultTimers,
) {
  browser.binaryType = 'arraybuffer';
  upstream.binaryType = 'arraybuffer';
  let closed = false,
    finishing = false,
    ready = false;
  let totalBytes = 0,
    queuedBytes = 0,
    responseBytes = 0;
  let endingMessage: string | undefined;
  let audioTimer: unknown, finalTimer: unknown, sessionTimer: unknown;
  let outbound: Promise<void> = Promise.resolve(),
    inbound: Promise<void> = Promise.resolve();
  function send(value: object) {
    if (closed) return;
    try {
      browser.send(JSON.stringify(value));
    } catch {
      close();
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    for (const timer of [audioTimer, finalTimer, sessionTimer])
      if (timer !== undefined) timers.clearTimer(timer);
    try {
      upstream.close(1000, 'Session ended');
    } catch {
      /* Already closed. */
    }
    try {
      browser.close(1000, 'Session ended');
    } catch {
      /* Already closed. */
    }
  }
  function fail(message: string) {
    if (closed) return;
    try {
      send({ type: 'error', message });
    } finally {
      close();
    }
  }
  function finish(message?: string) {
    if (closed || finishing) return;
    finishing = true;
    timers.clearTimer(audioTimer);
    timers.clearTimer(sessionTimer);
    endingMessage = message;
    outbound = outbound
      .then(async () => {
        if (closed) return;
        upstream.send(await encodeAudio(new Uint8Array(), true));
        finalTimer = timers.setTimer(
          () => fail('语音服务结束响应超时，已保留收到的文字'),
          10000,
        );
      })
      .catch(() => fail('语音连接中断，已保留收到的文字'));
  }
  function resetAudioDeadline() {
    if (audioTimer !== undefined) timers.clearTimer(audioTimer);
    audioTimer = timers.setTimer(
      () => finish('连续 10 秒未收到音频，本段转写已结束'),
      10000,
    );
  }
  browser.addEventListener('message', (event) => {
    if (closed) return;
    if (typeof event.data === 'string') {
      if (event.data.length > 128) {
        fail('语音控制消息无效');
        return;
      }
      try {
        const command = JSON.parse(event.data);
        if (command?.type === 'finish') {
          finish();
          return;
        }
        if (command?.type === 'ping') return;
      } catch {
        /* Use a fixed public error below. */
      }
      fail('语音控制消息无效');
      return;
    }
    if (finishing) return;
    const size = binarySize(event.data);
    if (!ready || size === null || !size || size % 2 || size > MAX_FRAME) {
      fail('音频分包无效，请重新开始实时转写');
      return;
    }
    const data = event.data as BinaryData;
    if (totalBytes + size > MAX_SESSION_BYTES) {
      finish('本段实时转写已达到 15 分钟上限');
      return;
    }
    totalBytes += size;
    queuedBytes += size;
    if (queuedBytes > MAX_QUEUE_BYTES) {
      fail('音频发送过快，请重新开始实时转写');
      return;
    }
    resetAudioDeadline();
    outbound = outbound
      .then(async () => {
        try {
          // Blob conversion stays inside the queue so a later finish cannot overtake it.
          if (!closed) {
            const pcm = await binaryBytes(data);
            if (!closed) upstream.send(await encodeAudio(pcm, false));
          }
        } finally {
          queuedBytes -= size;
        }
      })
      .catch(() => fail('语音连接中断，已保留收到的文字'));
    if (totalBytes === MAX_SESSION_BYTES)
      finish('本段实时转写已达到 15 分钟上限');
  });
  upstream.addEventListener('message', (event) => {
    if (closed) return;
    const size = binarySize(event.data);
    if (size === null || !size) {
      fail('语音服务返回了无效数据');
      return;
    }
    const data = event.data as BinaryData;
    responseBytes += size;
    if (size > 1024 * 1024 || responseBytes > 2 * 1024 * 1024) {
      fail('语音服务响应超过限制');
      return;
    }
    inbound = inbound
      .then(async () => {
        try {
          if (closed) return;
          const result = await decodeResponse(await binaryBytes(data));
          if (closed) return;
          send({ type: 'transcript', ...result });
          if (result.final) {
            if (endingMessage) send({ type: 'error', message: endingMessage });
            send({ type: 'done' });
            close();
          }
        } finally {
          responseBytes -= size;
        }
      })
      .catch(() => fail('语音服务响应异常，请检查配置或稍后重试'));
  });
  upstream.addEventListener('error', () =>
    fail('语音服务连接异常，已保留收到的文字'),
  );
  upstream.addEventListener('close', () => {
    // A close event may follow a final binary frame while gzip decoding is pending.
    inbound = inbound.then(() => {
      if (!closed) fail('语音服务提前断开，已保留收到的文字');
    });
  });
  browser.addEventListener('error', close);
  browser.addEventListener('close', () => {
    if (closed) return;
    finish();
    outbound = outbound.finally(close);
  });
  outbound = outbound
    .then(async () => {
      const packet = await encodeInitialRequest(crypto.randomUUID());
      if (closed) return;
      upstream.send(packet);
      ready = true;
      resetAudioDeadline();
      sessionTimer = timers.setTimer(
        () => finish('本段实时转写已达到 15 分钟上限'),
        15 * 60 * 1000,
      );
      send({ type: 'ready' });
    })
    .catch(() => fail('语音连接初始化失败，请稍后重试'));
  return {
    close,
    idle: async () => {
      await outbound;
      await inbound;
    },
  };
}

export async function handleAsrStream(
  request: Request,
  env: AsrEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const error = (message: string, status: number) =>
    Response.json(
      { error: message },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return error('请求来源不受支持', 403);
  if (
    request.method !== 'GET' ||
    request.headers.get('upgrade')?.toLowerCase() !== 'websocket'
  )
    return error('请通过 WebSocket 连接实时转写', 426);
  if (env.ASR_PROVIDER !== 'doubao-stream' || !env.ASR_API_KEY?.trim())
    return error('尚未配置实时语音服务', 503);
  let upstream: AsrSocket | undefined;
  const controller = new AbortController();
  const handshakeTimer = setTimeout(() => controller.abort(), 10000);
  try {
    const connectionId = crypto.randomUUID();
    // Workers uses an HTTPS upgrade fetch for the fixed WSS endpoint.
    const response = await fetcher(
      'https://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      {
        headers: {
          Upgrade: 'websocket',
          'X-Api-Key': env.ASR_API_KEY,
          'X-Api-Resource-Id':
            env.ASR_RESOURCE_ID || 'volc.seedasr.sauc.duration',
          'X-Api-Request-Id': connectionId,
          'X-Api-Connect-Id': connectionId,
          'X-Api-Sequence': '-1',
        },
        redirect: 'manual',
        signal: controller.signal,
      },
    );
    clearTimeout(handshakeTimer);
    upstream = (response as Response & { webSocket?: AsrSocket }).webSocket;
    if (response.status !== 101 || !upstream) {
      await response.body?.cancel();
      return error('实时语音服务连接失败，请检查服务配置或稍后重试', 502);
    }
    const pair = new WebSocketPair();
    const server = pair[1] as unknown as AsrSocket;
    upstream.binaryType = 'arraybuffer';
    server.binaryType = 'arraybuffer';
    upstream.accept();
    server.accept();
    await startAsrRelay(server, upstream).idle();
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    try {
      upstream?.close(1000, 'Connection failed');
    } catch {
      /* Already closed. */
    }
    return error('实时语音服务连接失败，请检查服务配置或稍后重试', 502);
  } finally {
    clearTimeout(handshakeTimer);
  }
}
