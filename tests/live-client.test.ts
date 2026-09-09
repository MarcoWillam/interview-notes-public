import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import ts from 'typescript';

type Events = {
  text: (text: string) => void;
  state: (state: string) => void;
  error: (message: string) => void;
};
type Client = {
  start: (media: MediaStream) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  finish: () => Promise<void>;
  dispose: () => void;
};
const source = (
  await readFile(new URL('../lib/asr/live-client.ts', import.meta.url), 'utf8')
).replace(/^import workletUrl .*;$/m, "const workletUrl = 'fake-worklet.js';");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { LiveTranscriber } = (await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)) as { LiveTranscriber: new (events: Events, initial: string) => Client };

async function until(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.ok(predicate(), message);
}

function harness() {
  const sockets: FakeSocket[] = [];
  const worklets: FakeWorklet[] = [];
  const states: string[] = [],
    texts: string[] = [],
    errors: string[] = [];
  let rotate: (() => void) | undefined;
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    sent: (string | ArrayBuffer)[] = [];
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: URL) {
      sockets.push(this);
    }
    send(data: string | ArrayBuffer) {
      this.sent.push(data);
    }
    receive(value: object) {
      this.onmessage?.({ data: JSON.stringify(value) });
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.());
    }
    get finishing() {
      return this.sent.some(
        (part) =>
          typeof part === 'string' && JSON.parse(part).type === 'finish',
      );
    }
    get frames() {
      return this.sent.filter(
        (part): part is ArrayBuffer => part instanceof ArrayBuffer,
      );
    }
  }
  class FakeWorklet {
    enabled = false;
    messages: string[] = [];
    port = {
      onmessage: null as
        | ((event: { data: ArrayBuffer | { type: string } }) => void)
        | null,
      postMessage: (message: { type: string }) => {
        this.messages.push(message.type);
        if (message.type === 'start') this.enabled = true;
        if (message.type === 'flush') {
          this.enabled = false;
          queueMicrotask(() =>
            this.port.onmessage?.({ data: { type: 'flushed' } }),
          );
        }
      },
    };
    constructor() {
      worklets.push(this);
    }
    connect() {}
    disconnect() {}
    capture(marker: number) {
      if (this.enabled)
        this.port.onmessage?.({ data: new Uint8Array([marker]).buffer });
    }
  }
  class FakeContext {
    audioWorklet = { addModule: async () => {} };
    destination = {};
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {} };
    }
    async resume() {}
    async close() {}
  }
  const replacements = {
    AudioContext: FakeContext,
    AudioWorkletNode: FakeWorklet,
    WebSocket: FakeSocket,
    location: { href: 'http://localhost/', protocol: 'http:' },
    setInterval: (callback: () => void) => {
      rotate = callback;
      return 1;
    },
    clearInterval: () => {
      rotate = undefined;
    },
  };
  const descriptors = Object.keys(replacements).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(replacements))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const client = new LiveTranscriber(
    {
      text: (value) => texts.push(value),
      state: (value) => states.push(value),
      error: (value) => errors.push(value),
    },
    '既有记录',
  );
  return {
    client,
    sockets,
    worklets,
    states,
    texts,
    errors,
    rotate: () => {
      assert.ok(rotate, 'rotation timer installed');
      rotate();
    },
    async start() {
      const starting = client.start({} as MediaStream);
      await until(() => sockets.length === 1, 'first connection created');
      sockets[0].receive({ type: 'ready' });
      await starting;
    },
    async dispose() {
      client.dispose();
      await nextTurn();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

void test('finish during rotation sends queued audio through a final connection', async (t) => {
  const h = harness();
  t.after(() => h.dispose());
  await h.start();
  h.sockets[0].receive({ type: 'transcript', text: '前段' });
  h.rotate();
  await until(() => h.sockets[0].finishing, 'rotation finalizes old segment');
  h.worklets[0].capture(42);
  const finishing = h.client.finish();
  h.sockets[0].receive({ type: 'done' });
  await until(
    () => h.sockets.length === 2,
    'queued audio needs another connection',
  );
  h.sockets[1].receive({ type: 'ready' });
  await until(() => h.sockets[1].finishing, 'tail connection receives finish');
  assert.deepEqual(
    h.sockets[1].frames.map((b) => [...new Uint8Array(b)]),
    [[42]],
  );
  h.sockets[1].receive({ type: 'transcript', text: '尾段' });
  h.sockets[1].receive({ type: 'done' });
  await finishing;
  assert.equal(h.texts.at(-1), '既有记录\n前段\n尾段');
  assert.equal(h.states.at(-1), 'idle');
  assert.deepEqual(h.errors, []);
});

void test('pause stops capture immediately while rotation waits for its final result', async (t) => {
  const h = harness();
  t.after(() => h.dispose());
  await h.start();
  h.rotate();
  await until(
    () => h.sockets[0].finishing,
    'rotation waits for final response',
  );
  const pausing = h.client.pause();
  assert.equal(
    h.worklets[0].messages.at(-1),
    'flush',
    'capture stop must not wait behind network operations',
  );
  h.worklets[0].capture(99);
  h.sockets[0].receive({ type: 'done' });
  await pausing;
  assert.equal(h.states.at(-1), 'paused');
  const resuming = h.client.resume();
  await until(() => h.sockets.length === 2, 'resume opens a connection');
  h.sockets[1].receive({ type: 'ready' });
  await resuming;
  h.worklets[0].capture(7);
  assert.deepEqual(
    h.sockets[1].frames.map((b) => [...new Uint8Array(b)]),
    [[7]],
  );
});

void test('close before server done reports failure even after finish was sent', async (t) => {
  const h = harness();
  t.after(() => h.dispose());
  await h.start();
  h.sockets[0].receive({ type: 'transcript', text: '尚未定稿' });
  const finishing = h.client.finish();
  await until(() => h.sockets[0].finishing, 'finish sent');
  h.sockets[0].close();
  await finishing;
  assert.equal(h.states.at(-1), 'error');
  assert.ok(h.errors.length > 0);
  assert.equal(h.texts.at(-1), '既有记录\n尚未定稿');
});

void test('automatic finish while initial connection is pending never returns to listening', async (t) => {
  const h = harness();
  t.after(() => h.dispose());
  const starting = h.client.start({} as MediaStream);
  await until(() => h.sockets.length === 1, 'connection pending');
  const finishing = h.client.finish();
  await until(() => h.states.includes('finishing'), 'finish state published');
  h.sockets[0].receive({ type: 'ready' });
  await starting;
  await until(() => h.sockets[0].finishing, 'pending connection is finalized');
  assert.equal(h.states.at(-1), 'finishing');
  assert.equal(h.states.includes('listening'), false);
  h.sockets[0].receive({ type: 'done' });
  await finishing;
  assert.equal(h.states.at(-1), 'idle');
});

void test('cumulative provider transcripts replace the current segment and append only finalized segments', async (t) => {
  const h = harness();
  t.after(() => h.dispose());
  await h.start();
  h.sockets[0].receive({ type: 'transcript', text: '项目' });
  h.sockets[0].receive({ type: 'transcript', text: '项目经验' });
  assert.equal(h.texts.at(-1), '既有记录\n项目经验');
  const pausing = h.client.pause();
  await until(() => h.sockets[0].finishing, 'pause finalizes segment');
  h.sockets[0].receive({ type: 'transcript', text: '项目经验完整' });
  h.sockets[0].receive({ type: 'done' });
  await pausing;
  const resuming = h.client.resume();
  await until(() => h.sockets.length === 2, 'resume opens next segment');
  h.sockets[1].receive({ type: 'ready' });
  await resuming;
  h.sockets[1].receive({ type: 'transcript', text: '团队' });
  h.sockets[1].receive({ type: 'transcript', text: '团队协作' });
  assert.equal(h.texts.at(-1), '既有记录\n项目经验完整\n团队协作');
  assert.deepEqual(h.errors, []);
});
