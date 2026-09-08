import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalStore } from '../lib/local/store.ts';
import { createAudioWriter } from '../lib/local/audio-writer.ts';

void test('quota failure preserves every chunk for download and retry without duplication', async () => {
  const store = createLocalStore(new IDBFactory());
  await store.beginAudio('a', 'audio/webm');
  let full = true;
  let failures = 0;
  const writer = createAudioWriter(
    {
      ...store,
      appendAudio: async (...args) => {
        if (args[1] === 1 && full)
          throw new DOMException('Full', 'QuotaExceededError');
        await store.appendAudio(...args);
      },
    },
    'a',
    'audio/webm',
    () => {
      failures++;
    },
  );
  writer.append(new Blob(['header']), 1);
  writer.append(new Blob(['middle']), 2);
  writer.append(new Blob(['tail']), 3);
  const first = await writer.finish(3);
  assert.equal(await first.blob.text(), 'headermiddletail');
  assert.equal(first.complete, false);
  assert.equal(failures, 1);
  assert.equal(await (await store.readAudio('a'))?.text(), 'header');
  full = false;
  const retry = await writer.finish(3, true);
  assert.equal(retry.complete, true);
  assert.equal(await retry.blob.text(), 'headermiddletail');
  assert.equal(await (await store.readAudio('a'))?.text(), 'headermiddletail');
});

void test('failed read retains memory tail until storage access recovers', async () => {
  const store = createLocalStore(new IDBFactory());
  await store.beginAudio('a', 'audio/webm');
  let unavailable = true;
  const writer = createAudioWriter(
    {
      ...store,
      appendAudio: async (...args) => {
        if (unavailable && args[1] === 1) throw new Error('write failure');
        await store.appendAudio(...args);
      },
      readAudio: async (id) => {
        if (unavailable) throw new Error('read failure');
        return store.readAudio(id);
      },
    },
    'a',
    'audio/webm',
    () => {},
  );
  writer.append(new Blob(['head']), 1);
  writer.append(new Blob(['tail']), 2);
  await assert.rejects(writer.finish(2));
  unavailable = false;
  assert.equal(await (await writer.finish(2, true)).blob.text(), 'headtail');
});

void test('metadata failure still exposes audio and does not report complete', async () => {
  const store = createLocalStore(new IDBFactory());
  await store.beginAudio('a', 'audio/webm');
  const writer = createAudioWriter(
    {
      ...store,
      finishAudio: async () => {
        throw new Error('failed');
      },
    },
    'a',
    'audio/webm',
    () => {},
  );
  writer.append(new Blob(['audio']), 1);
  const result = await writer.finish(1);
  assert.equal(result.complete, false);
  assert.equal(await result.blob.text(), 'audio');
});

void test('empty initialization can be retried without deleting real audio', async () => {
  const store = createLocalStore(new IDBFactory());
  await store.beginAudio('a', 'audio/webm');
  await store.discardEmptyAudio('a');
  await store.beginAudio('a', 'audio/webm');
  await store.appendAudio('a', 0, new Blob(['keep']), 1);
  await store.discardEmptyAudio('a');
  assert.equal(await (await store.readAudio('a'))?.text(), 'keep');
});

void test('read recovery exposes download even while retry writes still fail', async () => {
  const store = createLocalStore(new IDBFactory());
  await store.beginAudio('a', 'audio/webm');
  let canRead = false;
  const writer = createAudioWriter(
    {
      ...store,
      appendAudio: async (...args) => {
        if (args[1] > 0) throw new Error('disk full');
        await store.appendAudio(...args);
      },
      readAudio: async (id) => {
        if (!canRead) throw new Error('cannot read');
        return store.readAudio(id);
      },
    },
    'a',
    'audio/webm',
    () => {},
  );
  writer.append(new Blob(['head']), 1);
  writer.append(new Blob(['tail']), 2);
  await assert.rejects(writer.finish(2));
  canRead = true;
  const recovery = await writer.finish(2, true);
  assert.equal(recovery.complete, false);
  assert.equal(await recovery.blob.text(), 'headtail');
});
