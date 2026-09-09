import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import {
  startAsrRelay,
  handleAsrStream,
  type AsrSocket,
} from '../lib/asr/relay.ts';

class Socket implements AsrSocket {
  binaryType = 'blob';
  sent: (string | Uint8Array)[] = [];
  closed = false;
  listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  accept() {}
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void,
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  emit(type: string, data?: unknown) {
    for (const fn of this.listeners.get(type) || []) fn({ data });
  }
  messages() {
    return this.sent
      .filter((v): v is string => typeof v === 'string')
      .map((v) => JSON.parse(v));
  }
}
void test('relay orders initial, PCM and exactly one ending frame, forwards cumulative results', async () => {
  const client = new Socket(),
    upstream = new Socket();
  const relay = startAsrRelay(client, upstream);
  await relay.idle();
  assert.deepEqual(client.messages(), [{ type: 'ready' }]);
  client.emit('message', new Uint8Array(6400).buffer);
  client.emit('message', '{"type":"finish"}');
  client.emit('message', '{"type":"finish"}');
  await relay.idle();
  const packets = upstream.sent as Uint8Array[];
  assert.deepEqual(
    packets.map((p) => p[1]),
    [0x10, 0x20, 0x22],
  );
  assert.equal(gunzipSync(packets[1].slice(8)).length, 6400);
  const payload = Buffer.from(JSON.stringify({ result: { text: '完整结果' } }));
  const frame = Buffer.alloc(12 + payload.length);
  frame.set([0x11, 0x93, 0x10, 0]);
  frame.writeInt32BE(-1, 4);
  frame.writeUInt32BE(payload.length, 8);
  frame.set(payload, 12);
  upstream.emit(
    'message',
    frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength),
  );
  upstream.emit('close');
  await relay.idle();
  assert.deepEqual(client.messages().slice(-2), [
    { type: 'transcript', text: '完整结果', final: true },
    { type: 'done' },
  ]);
  assert.ok(client.closed && upstream.closed);
});
void test('oversized and odd PCM frames close both sockets; provider details never escape', async () => {
  for (const frame of [
    new ArrayBuffer(32002),
    new ArrayBuffer(3),
    '{"type":"unknown","key":"private"}',
  ]) {
    const client = new Socket(),
      upstream = new Socket();
    const relay = startAsrRelay(client, upstream);
    await relay.idle();
    client.emit('message', frame);
    await relay.idle();
    assert.ok(client.closed && upstream.closed);
    assert.equal(client.messages().at(-1).type, 'error');
    assert.ok(!JSON.stringify(client.messages()).includes('private'));
  }
});
void test('ping cannot extend the ten second audio deadline', async () => {
  const callbacks = new Map<number, () => void>();
  let id = 0;
  const client = new Socket(),
    upstream = new Socket();
  const relay = startAsrRelay(client, upstream, {
    setTimer(fn, delay) {
      callbacks.set(delay, fn);
      return ++id;
    },
    clearTimer() {},
  });
  await relay.idle();
  client.emit('message', '{"type":"ping"}');
  callbacks.get(10000)!();
  await relay.idle();
  assert.equal((upstream.sent.at(-1) as Uint8Array)[1], 0x22);
  relay.close();
});
void test('HTTP boundary rejects foreign origins and missing configuration without upstream traffic', async () => {
  const req = (origin: string) =>
    new Request('https://workbench.test/api/asr/stream', {
      headers: { Upgrade: 'websocket', Origin: origin },
    });
  assert.equal(
    (await handleAsrStream(req('https://attacker.test'), {})).status,
    403,
  );
  assert.equal(
    (await handleAsrStream(req('https://workbench.test'), {})).status,
    503,
  );
  assert.equal(
    (
      await handleAsrStream(
        new Request('https://workbench.test/api/asr/stream'),
        {},
      )
    ).status,
    403,
  );
});
void test('handshake uses fixed provider and server credentials but hides rejected upstream response', async () => {
  let called = false;
  const request = new Request('https://workbench.test/api/asr/stream', {
    headers: { Upgrade: 'websocket', Origin: 'https://workbench.test' },
  });
  const result = await handleAsrStream(
    request,
    { ASR_PROVIDER: 'doubao-stream', ASR_API_KEY: 'fixture-secret' },
    async (url, init) => {
      called = true;
      assert.equal(init?.redirect, 'manual');
      assert.equal(
        url,
        'https://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      );
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('X-Api-Key'), 'fixture-secret');
      assert.equal(
        headers.get('X-Api-Resource-Id'),
        'volc.seedasr.sauc.duration',
      );
      return new Response('upstream rejected fixture-secret', { status: 401 });
    },
  );
  assert.ok(called);
  assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes('fixture-secret'));
});
void test('upstream redirect is rejected without forwarding credentials to another URL', async () => {
  let calls = 0;
  const result = await handleAsrStream(
    new Request('https://workbench.test/api/asr/stream', {
      headers: { Upgrade: 'websocket', Origin: 'https://workbench.test' },
    }),
    { ASR_PROVIDER: 'doubao-stream', ASR_API_KEY: 'fixture-secret' },
    async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, 'manual');
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://other.test/' },
      });
    },
  );
  assert.equal(result.status, 502);
  assert.equal(calls, 1);
});
void test('Blob and offset views are normalized in wire order before finish and final close', async () => {
  const client = new Socket(),
    upstream = new Socket();
  const relay = startAsrRelay(client, upstream);
  await relay.idle();
  assert.equal(client.binaryType, 'arraybuffer');
  assert.equal(upstream.binaryType, 'arraybuffer');
  client.emit('message', new Blob([new Uint8Array([1, 2])]));
  client.emit('message', new Uint8Array([9, 3, 4, 9]).subarray(1, 3));
  client.emit('message', '{"type":"finish"}');
  await relay.idle();
  const packets = upstream.sent as Uint8Array[];
  assert.deepEqual(
    packets.map((p) => p[1]),
    [0x10, 0x20, 0x20, 0x22],
  );
  assert.deepEqual(
    new Uint8Array(gunzipSync(packets[1].slice(8))),
    new Uint8Array([1, 2]),
  );
  assert.deepEqual(
    new Uint8Array(gunzipSync(packets[2].slice(8))),
    new Uint8Array([3, 4]),
  );
  const frame = (text: string, final: boolean) => {
    const payload = Buffer.from(JSON.stringify({ result: { text } }));
    const packet = Buffer.alloc(8 + payload.length);
    packet.set([0x11, final ? 0x92 : 0x90, 0x10, 0]);
    packet.writeUInt32BE(payload.length, 4);
    packet.set(payload, 8);
    return packet;
  };
  upstream.emit('message', new Blob([frame('第一句', false)]));
  const last = frame('第一句。第二句。', true);
  const padded = Buffer.concat([Buffer.from([9]), last, Buffer.from([9])]);
  upstream.emit(
    'message',
    new DataView(padded.buffer, padded.byteOffset + 1, last.byteLength),
  );
  upstream.emit('close');
  await relay.idle();
  assert.deepEqual(
    client
      .messages()
      .filter((m) => m.type === 'transcript')
      .map((m) => m.text),
    ['第一句', '第一句。第二句。'],
  );
  assert.equal(client.messages().at(-1).type, 'done');
  assert.ok(client.closed && upstream.closed);
});
void test('oversized Blob frames are rejected before allocating arrayBuffer', async () => {
  const client = new Socket(),
    upstream = new Socket();
  const relay = startAsrRelay(client, upstream);
  await relay.idle();
  const blob = new Blob([new Uint8Array(32002)]);
  blob.arrayBuffer = () => {
    throw new Error('must not allocate');
  };
  client.emit('message', blob);
  await relay.idle();
  assert.ok(client.closed && upstream.closed);
  assert.equal(client.messages().at(-1).type, 'error');
});
void test('wall duration and missing final response terminate connections; final frame survives close event ordering', async () => {
  const scheduled: { callback: () => void; delay: number }[] = [];
  const client = new Socket(),
    upstream = new Socket();
  const relay = startAsrRelay(client, upstream, {
    setTimer(callback, delay) {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimer() {},
  });
  await relay.idle();
  scheduled.find((t) => t.delay === 900000)!.callback();
  await relay.idle();
  assert.equal((upstream.sent.at(-1) as Uint8Array)[1], 0x22);
  scheduled.at(-1)!.callback();
  assert.ok(client.closed && upstream.closed);
});
void test('a PCM burst cannot create an unbounded compression queue', async () => {
  const client = new Socket(),
    upstream = new Socket();
  const relay = startAsrRelay(client, upstream);
  await relay.idle();
  for (let i = 0; i < 10; i++) client.emit('message', new ArrayBuffer(32000));
  await relay.idle();
  assert.ok(client.closed && upstream.closed);
  assert.equal(client.messages().at(-1).type, 'error');
});
