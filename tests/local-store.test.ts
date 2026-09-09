import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
void test('template source and written-test state survive reopening', async () => {
  const factory = new IDBFactory();
  const store = createLocalStore(factory);
  const enriched: SavedInterview = {
    ...session,
    sourceTemplateId: 'builtin-campus-ai-product-manager',
    templateModified: true,
    hasWrittenTest: true,
    writtenTestConfirmed: true,
  };
  await store.saveInterview(enriched);
  assert.deepEqual(
    await createLocalStore(factory).getInterview(enriched.id),
    enriched,
  );
});
void test('legacy records remain readable without template metadata', async () => {
  const store = createLocalStore(new IDBFactory());
  await store.saveInterview(session);
  const restored = await store.getInterview(session.id);
  assert.ok(restored);
  assert.equal(restored.sourceTemplateId, undefined);
  assert.equal(restored.templateModified, undefined);
  assert.equal(restored.hasWrittenTest, undefined);
  assert.equal(restored.writtenTestConfirmed, undefined);
});
void test('new and updated resume records do not acquire a verification gate', async () => {
  const factory = new IDBFactory();
  const first = createLocalStore(factory);
  await first.saveInterview(session);
  const reopened = createLocalStore(factory);
  const record = await reopened.getInterview(session.id);
  assert.ok(record);
  assert.equal(Object.hasOwn(record, 'resumeChecked'), false);
  await reopened.saveInterview({
    ...record,
    candidate: '张晓明',
    updatedAt: 2,
  });
  const updated = await createLocalStore(factory).getInterview(session.id);
  assert.ok(updated);
  assert.equal(updated.candidate, '张晓明');
  assert.equal(Object.hasOwn(updated, 'resumeChecked'), false);
});
void test('legacy resume verification remains readable without adding it to new page drafts', async () => {
  const factory = new IDBFactory();
  const store = createLocalStore(factory);
  const legacy = { ...session, resumeChecked: true };
  await store.saveInterview(legacy);
  const reopened = createLocalStore(factory);
  assert.deepEqual(await reopened.getInterview(session.id), legacy);
  const page = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(page, /\bresumeChecked\b/);
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
void test('Markdown source and edited text survive reopening alongside legacy records', async () => {
  const factory = new IDBFactory();
  const store = createLocalStore(factory);
  await store.saveInterview(session);
  const imported = {
    ...session,
    id: 'markdown',
    transcriptName: '面试转写.md',
    transcript: '# 面试\n\n面试官：介绍项目。\n候选人：我负责需求调研。',
    resumeName: '',
    reviewed: true,
  };
  await store.saveInterview(imported);
  const reopened = createLocalStore(factory);
  assert.deepEqual(await reopened.getInterview('markdown'), imported);
  assert.deepEqual(await reopened.getInterview(session.id), session);
  const edited = {
    ...imported,
    transcript: imported.transcript + '\n候选人：完成了五次访谈。',
    reviewed: false,
  };
  await reopened.saveInterview(edited);
  assert.deepEqual(
    await createLocalStore(factory).getInterview('markdown'),
    edited,
  );
});
void test('resume source, verification and reading survive local history reopening', async () => {
  const factory = new IDBFactory();
  const first = createLocalStore(factory);
  const record = {
    ...session,
    resumeName: '简历.pdf',
    resumeChecked: true,
    resumeReading: {
      summary: '候选人自述',
      sections: ['教育背景', '工作经历', '项目经验', '技能'].map((name) => ({
        name,
        items: [],
      })),
      followUps: ['请补充项目细节'],
    },
  };
  await first.saveInterview(record);
  assert.deepEqual(
    await createLocalStore(factory).getInterview(session.id),
    record,
  );
});
