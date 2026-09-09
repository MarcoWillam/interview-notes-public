// oxlint-disable-next-line import/default -- Vite worker URL imports export a generated asset URL.
import workletUrl from './pcm.worklet.ts?worker&url';
async function prepareWithin<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('audio setup timeout')),
          10000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export type LiveState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'finishing'
  | 'paused'
  | 'error';
type Events = {
  text: (text: string) => void;
  state: (state: LiveState) => void;
  error: (message: string) => void;
};
type Segment = {
  socket: WebSocket;
  text: string;
  ready: Promise<void>;
  done: Promise<void>;
  end: () => void;
  ending: boolean;
  readyFlag: boolean;
  completed: boolean;
};
export class LiveTranscriber {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private segment: Segment | null = null;
  private queue: ArrayBuffer[] = [];
  private committed: string;
  private canceled = false;
  private running = false;
  private captureFlush: Promise<void> | null = null;
  private flushAck: (() => void) | null = null;
  private rotation: ReturnType<typeof setInterval> | null = null;
  private operations = Promise.resolve();
  constructor(
    private events: Events,
    initial: string,
  ) {
    this.committed = initial.trim();
  }
  async start(media: MediaStream) {
    try {
      this.events.state('connecting');
      this.context = new AudioContext();
      await prepareWithin(this.context.audioWorklet.addModule(workletUrl));
      if (this.canceled) return;
      this.node = new AudioWorkletNode(this.context, 'interview-pcm');
      this.node.port.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.audio(e.data);
        else if (e.data?.type === 'flushed') this.flushAck?.();
      };
      this.source = this.context.createMediaStreamSource(media);
      const mute = this.context.createGain();
      mute.gain.value = 0;
      this.source.connect(this.node);
      this.node.connect(mute);
      mute.connect(this.context.destination);
      await prepareWithin(this.context.resume());
      if (this.canceled) return;
      this.running = true;
      this.node.port.postMessage({ type: 'start' });
      await this.connect();
      if (!this.canceled && this.running) this.events.state('listening');
      this.rotation = setInterval(
        () => {
          if (this.running && !this.canceled)
            void this.serialize(async () => {
              await this.finishSegment();
              if (this.running && !this.canceled) await this.connect();
            });
        },
        10 * 60 * 1000,
      );
    } catch {
      this.fail(
        '实时转写连接失败，请检查本地服务、网络及豆包权限；本地录音继续保存。',
      );
    }
  }
  private serialize(task: () => Promise<void>) {
    this.operations = this.operations
      .then(task)
      .catch(() =>
        this.fail('实时转写连接中断，已收到的文字和本地录音保留，请稍后校对。'),
      );
    return this.operations;
  }
  private async connect() {
    if (this.canceled) return;
    const url = new URL('/api/asr/stream', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    let readyResolve!: () => void,
      readyReject!: (error: Error) => void,
      doneResolve!: () => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const done = new Promise<void>((resolve) => {
      doneResolve = resolve;
    });
    const segment: Segment = {
      socket,
      text: '',
      ready,
      done,
      end: doneResolve,
      ending: false,
      readyFlag: false,
      completed: false,
    };
    this.segment = segment;
    const timeout = setTimeout(() => {
      readyReject(new Error('timeout'));
      this.fail('实时转写连接超时，本地录音继续保存。');
    }, 10000);
    socket.onmessage = (event) => {
      if (this.canceled) return;
      try {
        const value = JSON.parse(String(event.data));
        if (value.type === 'ready') {
          clearTimeout(timeout);
          segment.readyFlag = true;
          readyResolve();
          this.drain();
        }
        if (value.type === 'transcript' && typeof value.text === 'string') {
          segment.text = value.text;
          const text = [this.committed, segment.text]
            .filter(Boolean)
            .join('\n');
          if (text.length > 80000) {
            this.fail('转写已达到 80,000 字上限，请保留录音并新建面试。');
            return;
          }
          this.events.text(text);
        }
        if (value.type === 'error') {
          readyReject(new Error('provider'));
          this.fail(
            typeof value.message === 'string'
              ? value.message
              : '豆包转写失败，本地录音仍保留。',
          );
        }
        if (value.type === 'done') {
          segment.completed = true;
          if (!segment.ending)
            this.fail('转写连接提前结束，本地录音继续保存。');
          doneResolve();
          socket.close();
        }
      } catch {
        this.fail('实时转写返回格式异常，本地录音继续保存。');
      }
    };
    socket.onerror = () => {
      clearTimeout(timeout);
      readyReject(new Error('socket'));
      this.fail('实时转写连接失败，请检查服务与网络；本地录音继续保存。');
      doneResolve();
    };
    socket.onclose = () => {
      clearTimeout(timeout);
      readyReject(new Error('closed'));
      if (!this.canceled && !segment.completed)
        this.fail(
          '实时转写连接提前断开，最后文字可能不完整；本地录音继续保存。',
        );
      doneResolve();
    };
    await ready;
  }
  private audio(buffer: ArrayBuffer) {
    if (this.canceled) return;
    this.queue.push(buffer);
    if (this.queue.reduce((n, part) => n + part.byteLength, 0) > 320000) {
      this.fail('网络跟不上录音速度，实时转写已停止；本地录音继续保存。');
      return;
    }
    this.drain();
  }
  private drain() {
    const segment = this.segment;
    if (
      !segment?.readyFlag ||
      segment.ending ||
      segment.socket.readyState !== WebSocket.OPEN
    )
      return;
    while (this.queue.length) {
      if (segment.socket.bufferedAmount > 320000) {
        this.fail('实时转写网络拥堵，本地录音继续保存。');
        return;
      }
      segment.socket.send(this.queue.shift()!);
    }
  }
  private flushCapture(): Promise<void> {
    if (!this.node || this.canceled) return Promise.resolve();
    if (this.captureFlush) return this.captureFlush;
    this.captureFlush = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.flushAck = null;
        reject(new Error('capture timeout'));
      }, 1500);
      this.flushAck = () => {
        clearTimeout(timer);
        this.flushAck = null;
        resolve();
      };
      this.node!.port.postMessage({ type: 'flush' });
    }).finally(() => {
      this.captureFlush = null;
    });
    return this.captureFlush;
  }
  private async finishQueuedAudio() {
    await this.finishSegment();
    if (!this.canceled && this.queue.length) {
      await this.connect();
      await this.finishSegment();
    }
  }
  private async finishSegment() {
    const segment = this.segment;
    if (!segment || this.canceled) return;
    await segment.ready;
    this.drain();
    segment.ending = true;
    segment.socket.send(JSON.stringify({ type: 'finish' }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        segment.done,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('final timeout')), 15000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      segment.socket.close();
    }
    this.committed = [this.committed, segment.text].filter(Boolean).join('\n');
    if (this.segment === segment) this.segment = null;
  }
  pause() {
    this.running = false;
    const flushed = this.flushCapture().then(
      () => true,
      () => false,
    );
    if (!this.canceled) this.events.state('finishing');
    return this.serialize(async () => {
      if (this.canceled) return;
      if (!(await flushed)) throw new Error('capture timeout');
      await this.finishQueuedAudio();
      if (!this.canceled) this.events.state('paused');
    });
  }
  resume() {
    return this.serialize(async () => {
      if (this.canceled) return;
      this.events.state('connecting');
      this.running = true;
      this.node?.port.postMessage({ type: 'start' });
      await this.connect();
      if (!this.canceled && this.running) this.events.state('listening');
    });
  }
  finish() {
    this.running = false;
    if (this.rotation) clearInterval(this.rotation);
    const flushed = this.flushCapture().then(
      () => true,
      () => false,
    );
    if (!this.canceled) this.events.state('finishing');
    return this.serialize(async () => {
      if (this.canceled) return;
      if (!(await flushed)) throw new Error('capture timeout');
      await this.finishQueuedAudio();
      if (!this.canceled) {
        this.events.state('idle');
        this.dispose();
      }
    });
  }
  private fail(message: string) {
    if (this.canceled) return;
    this.events.error(message);
    this.events.state('error');
    this.dispose();
  }
  dispose() {
    this.canceled = true;
    this.running = false;
    if (this.rotation) clearInterval(this.rotation);
    this.segment?.socket.close();
    this.segment?.end();
    this.segment = null;
    this.node?.disconnect();
    this.source?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.node = null;
    this.source = null;
    this.queue = [];
  }
}
