import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalStore, type SavedInterview } from '../lib/local/store.ts';
const builtInTemplateIds = [
  'builtin-campus-ai-product-manager',
  'builtin-campus-product-operations',
];
const session: SavedInterview = {
  id: 'first',
  updatedAt: 1,
  candidate: '测试候选人',
  role: '产品经理',
  requirements: '负责调研',
  dimensionText: '专业能力',
  focus: '项目证据',
  resumeText: '三年产品经验',
  resumeName: '简历.doc',
  transcript: '',
  reviewed: false,
  report: null,
  conclusion: '',
  confirmed: false,
};
void test('interview draft survives reopening the local store', async () => {
  const factory = new IDBFactory();
  const first = createLocalStore(factory);
  await first.saveInterview(session);
  const reopened = createLocalStore(factory);
  assert.deepEqual(await reopened.getInterview('first'), session);
});
void test('audio chunks reopen in recording order and deletion is isolated', async () => {
  const factory = new IDBFactory();
  const store = createLocalStore(factory);
  await store.saveInterview(session);
  await store.beginAudio('first', 'audio/webm');
  await store.appendAudio('first', 0, new Blob(['header']), 1);
  await store.appendAudio('first', 1, new Blob(['tail']), 2);
  await store.finishAudio('first', 2, true);
  await store.saveInterview({ ...session, id: 'second' });
  await store.beginAudio('second', 'audio/webm');
  await store.appendAudio('second', 0, new Blob(['keep']), 1);
  const reopened = createLocalStore(factory);
  assert.equal(await (await reopened.readAudio('first'))?.text(), 'headertail');
  assert.equal((await reopened.getAudio('first'))?.complete, true);
  await reopened.deleteInterview('first');
  assert.equal(await reopened.readAudio('first'), null);
  assert.equal(await (await reopened.readAudio('second'))?.text(), 'keep');
});
void test('interrupted recordings recover their committed prefix and cannot be overwritten', async () => {
  const store = createLocalStore(new IDBFactory());
  await store.beginAudio('first', 'audio/webm');
  await store.appendAudio('first', 0, new Blob(['saved']), 3);
  assert.equal((await store.getAudio('first'))?.complete, false);
  assert.equal(await (await store.readAudio('first'))?.text(), 'saved');
  await assert.rejects(store.beginAudio('first', 'audio/webm'));
});
void test('preference templates persist without candidate fields', async () => {
  const store = createLocalStore(new IDBFactory());
  const preference = {
    id: 'pm',
    name: '产品经理一面',
    role: '产品经理',
    requirements: '调研',
    dimensionText: '专业能力',
    focus: '项目结果',
  };
  await store.savePreference(preference);
  assert.deepEqual(
    (await store.listPreferences()).find(({ id }) => id === preference.id),
    preference,
  );
  await store.deletePreference('pm');
  assert.equal(
    (await store.listPreferences()).some(({ id }) => id === preference.id),
    false,
  );
});
void test('deleting a built-in template is durable across ordinary reopen', async () => {
  const factory = new IDBFactory();
  const first = createLocalStore(factory, 'deleted-built-in');
  await first.deletePreference(builtInTemplateIds[0]);
  const reopened = createLocalStore(factory, 'deleted-built-in');
  assert.deepEqual(
    (await reopened.listPreferences()).map(({ id }) => id),
    [builtInTemplateIds[1]],
  );
  assert.equal(await reopened.getSettings(), undefined);
});
