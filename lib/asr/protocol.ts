// Protocol source: https://www.volcengine.com/docs/6561/1354869
const MAX_RESPONSE_BYTES = 1024 * 1024;
async function transform(bytes: Uint8Array, decompress: boolean) {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(
      decompress
        ? new DecompressionStream('gzip')
        : new CompressionStream('gzip'),
    );
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('语音服务响应超过限制');
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error('语音服务响应无法读取');
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
async function encode(
  bytes: Uint8Array,
  type: number,
  flags: number,
  serialization: number,
) {
  const payload = await transform(bytes, false);
  const packet = new Uint8Array(8 + payload.length);
  packet.set([0x11, (type << 4) | flags, (serialization << 4) | 1, 0]);
  new DataView(packet.buffer).setUint32(4, payload.length, false);
  packet.set(payload, 8);
  return packet;
}
export function encodeInitialRequest(uid: string) {
  return encode(
    new TextEncoder().encode(
      JSON.stringify({
        user: { uid },
        audio: {
          format: 'pcm',
          codec: 'raw',
          rate: 16000,
          bits: 16,
          channel: 1,
        },
        request: {
          model_name: 'bigmodel',
          result_type: 'full',
          enable_itn: true,
          enable_punc: true,
          enable_ddc: false,
        },
      }),
    ),
    1,
    0,
    1,
  );
}
export function encodeAudio(pcm: Uint8Array, final: boolean) {
  return encode(pcm, 2, final ? 2 : 0, 0);
}
export async function decodeResponse(
  bytes: Uint8Array,
): Promise<{ text: string; final: boolean }> {
  const invalid = () => new Error('语音服务返回了无效数据');
  if (
    bytes.length < 8 ||
    bytes.length > MAX_RESPONSE_BYTES ||
    bytes[0] >> 4 !== 1
  )
    throw invalid();
  const headerSize = (bytes[0] & 15) * 4;
  const type = bytes[1] >> 4,
    flags = bytes[1] & 15;
  if (headerSize < 4 || headerSize > bytes.length - 4) throw invalid();
  // Never forward provider messages: they may contain request metadata or secrets.
  if (type === 15) throw new Error('语音服务处理失败，请检查配置或稍后重试');
  if (type !== 9 || flags > 3 || bytes[2] >> 4 !== 1 || (bytes[2] & 15) > 1)
    throw invalid();
  const offset = headerSize + (flags & 1 ? 4 : 0);
  if (offset + 4 > bytes.length) throw invalid();
  const length = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, false);
  if (offset + 4 + length !== bytes.length) throw invalid();
  const raw = bytes.subarray(offset + 4);
  const payload = bytes[2] & 1 ? await transform(raw, true) : raw;
  let result: { result?: { text?: unknown }; code?: unknown };
  try {
    result = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(payload),
    );
  } catch {
    throw invalid();
  }
  if (
    !result ||
    typeof result !== 'object' ||
    (result.code !== undefined && result.code !== 20000000 && result.code !== 0)
  )
    throw invalid();
  const text = result.result?.text ?? '';
  if (typeof text !== 'string' || text.length > 80000) throw invalid();
  return { text, final: !!(flags & 2) };
}
