import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  encodeInitialRequest,
  encodeAudio,
  decodeResponse,
} from '../lib/asr/protocol.ts';

function response(value: unknown, flags = 1, compressed = true) {
  const body = Buffer.from(JSON.stringify(value));
  const payload = compressed ? gzipSync(body) : body;
  const prefix = Buffer.alloc(flags & 1 ? 12 : 8);
  prefix.set([0x11, 0x90 | flags, compressed ? 0x11 : 0x10, 0]);
  if (flags & 1) prefix.writeInt32BE(flags & 2 ? -2 : 1, 4);
  prefix.writeUInt32BE(payload.length, prefix.length - 4);
  return new Uint8Array(Buffer.concat([prefix, payload]));
}
void test('initial and PCM packets follow documented big-endian gzip protocol', async () => {
  const initial = await encodeInitialRequest('test');
  assert.deepEqual(Array.from(initial.slice(0, 4)), [0x11, 0x10, 0x11, 0]);
  assert.equal(new DataView(initial.buffer).getUint32(4), initial.length - 8);
  const config = JSON.parse(gunzipSync(initial.slice(8)).toString());
  assert.deepEqual(config.audio, {
    format: 'pcm',
    codec: 'raw',
    rate: 16000,
    bits: 16,
    channel: 1,
  });
  assert.equal(config.request.result_type, 'full');
  const pcm = new Uint8Array([0, 0, 255, 127]);
  const packet = await encodeAudio(pcm, false);
  assert.equal(packet[1], 0x20);
  assert.deepEqual(new Uint8Array(gunzipSync(packet.slice(8))), pcm);
  const tail = await encodeAudio(new Uint8Array(), true);
  assert.equal(tail[1], 0x22);
  assert.equal(gunzipSync(tail.slice(8)).length, 0);
});
void test('decodes cumulative transcript and final flags, with and without gzip/sequence', async () => {
  assert.deepEqual(
    await decodeResponse(response({ result: { text: '你好' } })),
    { text: '你好', final: false },
  );
  assert.deepEqual(
    await decodeResponse(response({ result: { text: '你好。' } }, 3)),
    { text: '你好。', final: true },
  );
  assert.deepEqual(
    await decodeResponse(response({ result: { text: '' } }, 2, false)),
    { text: '', final: true },
  );
});
void test('rejects error frames, malformed sizes and oversized decompressed JSON without disclosing payload', async () => {
  const error = Buffer.alloc(12);
  error.set([0x11, 0xf0, 0x10, 0]);
  error.writeUInt32BE(45000001, 4);
  await assert.rejects(decodeResponse(error), /语音服务/);
  const invalid = response({ result: { text: 'a' } });
  await assert.rejects(decodeResponse(invalid.slice(0, -1)));
  await assert.rejects(
    decodeResponse(response({ result: { text: 'x'.repeat(1024 * 1024 + 1) } })),
  );
});
