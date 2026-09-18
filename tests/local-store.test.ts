import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalStore, type SavedInterview } from '../lib/local/store.ts';
const builtInTemplateIds = [
  'builtin-campus-ai-product-manager',
  'builtin-campus-product-operations',
  'builtin-campus-ai-engineering',
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

void test('version 4 adds local groups and group deletion preserves interviews', async () => {
  const factory = new IDBFactory();
  await new Promise<void>((resolve, reject) => {
    const request = factory.open('group-migration', 4);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('interviews', { keyPath: 'id' });
      db.createObjectStore('audio', { keyPath: 'id' });
      db.createObjectStore('preferences', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'id' });
      db.createObjectStore('chunks', {
        keyPath: ['id', 'sequence'],
      }).createIndex('session', 'id');
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

  const store = createLocalStore(factory, 'group-migration');
  await store.saveInterview(session);
  const first = await store.saveInterviewGroup({
    id: 'campus',
    name: ' 校招 ',
    createdAt: 10,
    order: 1,
  });
  const second = await store.saveInterviewGroup({
    id: 'intern',
    name: '实习生',
    createdAt: 20,
    order: 2,
  });
  assert.equal(first.name, '校招');
  assert.deepEqual(await store.listInterviewGroups(), [first, second]);
  await assert.rejects(
    store.saveInterviewGroup({ ...second, id: 'duplicate', name: '校招' }),
    /分组名称已存在/,
  );
  await assert.rejects(
    store.saveInterviewGroup({ ...second, id: 'blank', name: ' ' }),
    /1–40/,
  );

  await store.moveInterviewToGroup(session.id, first.id);
  assert.equal((await store.getInterview(session.id))?.groupId, first.id);
  const autosaved = await store.saveInterviewDraft({
    ...session,
    candidate: '自动保存后的候选人',
    updatedAt: 2,
  });
  assert.equal(autosaved.groupId, first.id);
  assert.equal((await store.getInterview(session.id))?.groupId, first.id);
  await assert.rejects(
    store.moveInterviewToGroup(session.id, 'missing'),
    /分组已不存在/,
  );

  const renamed = await store.saveInterviewGroup({
    ...first,
    name: '应届招聘',
  });
  assert.equal(renamed.name, '应届招聘');
  await store.deleteInterviewGroup(first.id);
  assert.equal((await store.getInterview(session.id))?.groupId, null);
  assert.deepEqual(await store.listInterviewGroups(), [second]);
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
    workSample: null,
    workSampleJobId: 'work-job-12345678',
  };
  await store.saveInterview(enriched);
  assert.deepEqual(
    await createLocalStore(factory).getInterview(enriched.id),
    enriched,
  );
});

void test('outline version and V2 reading survive reopening without a database upgrade', async () => {
  const factory = new IDBFactory();
  const store = createLocalStore(factory);
  const enriched: SavedInterview = {
    ...session,
    outlineVersion: 2,
    resumeReading: {
      summary: 'V2 简历阅读',
      sections: ['教育背景', '工作经历', '项目经验', '技能'].map((name) => ({
        name,
        items: [],
      })),
      followUps: [],
      outline: {
        version: 2,
        estimatedMinutes: 30,
        requiredQuestions: [],
        reserveQuestions: [],
        archivedReserveQuestions: [],
        coverage: [],
      },
    },
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
  assert.equal(restored.workSample, undefined);
  assert.equal(restored.workSampleJobId, undefined);
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
void test('resume outline generation has one preflight entry and no repeat-reading copy', async () => {
  const [page, preparationInputs] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../lib/preparation-analysis-inputs.ts', import.meta.url),
      'utf8',
    ),
  ]);
  assert.match(page, /function openResumeOutlinePreflight\(/);
  assert.match(page, /resumeOutlineLocked\(resumeReading\)/);
  assert.match(page, /提纲已生成/);
  assert.match(page, /确认提纲生成条件/);
  assert.doesNotMatch(page, /重新阅读简历|替换并自动阅读/);
  assert.match(page, /outlineVersionForStandards/);
  assert.match(page, /outlineVersion:\s*context\.outlineVersion/);
  assert.match(page, /createPreparationWrittenTestInput/);
  assert.match(preparationInputs, /reading\.outline/);
});
void test('resume outline confirmation uses the styled select and fixed-size radio controls', async () => {
  const [page, css] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /确认岗位[\s\S]*<NativeSelect/);
  assert.match(page, /className="resume-outline-written-test-option"/);
  assert.match(
    css,
    /\.resume-outline-confirmation-form input\[type='radio'\][\s\S]*?width:\s*16px;[\s\S]*?padding:\s*0;/,
  );
});
void test('written-test supplement has a dedicated confirmation and remote task path', async () => {
  const page = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(page, /function runWrittenTestSupplement\(/);
  assert.match(page, /submitRemoteWrittenTest\(/);
  assert.match(page, /补充笔试复盘题/);
  assert.match(page, /setHasWrittenTest\(true\)/);
  assert.match(page, /setWrittenTestConfirmed\(true\)/);
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
    builtInTemplateIds.slice(1),
  );
  assert.equal(
    (await reopened.getSettings())?.defaultTemplateId,
    builtInTemplateIds[1],
  );
});
void test('the final template cannot be deleted', async () => {
  const store = createLocalStore(new IDBFactory(), 'last-template');
  const only = {
    id: 'only',
    name: '唯一模板',
    role: '测试岗位',
    requirements: '测试要求',
    dimensionText: '专业能力',
    focus: '',
    scoringGuidance: '',
    reportRequirements: '',
  };
  await store.savePreferencesConfig(
    {
      id: 'global',
      defaultTemplateId: only.id,
      defaults: {
        role: '',
        requirements: '',
        dimensionText: '专业能力',
        focus: '',
        scoringGuidance: '',
        reportRequirements: '',
      },
    },
    [only],
  );
  await assert.rejects(store.deletePreference(only.id), /至少保留一个岗位模板/);
  assert.deepEqual(await store.listPreferences(), [only]);
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

void test('follow-up groups and active task survive reopening without changing the main reading or report', async () => {
  const { followUpGroupFixture, followUpInputFixture } =
    await import('./fixtures/follow-up-outline.ts');
  const factory = new IDBFactory();
  const store = createLocalStore(factory, 'follow-up-records');
  const group = followUpGroupFixture();
  const record: SavedInterview = {
    ...session,
    resumeReading: followUpInputFixture().resumeReading,
    outlineSupplements: [group],
    followUpOutlineJobId: 'follow-up-active-task',
  };
  await store.saveInterviewDraft(record);
  const reopened = createLocalStore(factory, 'follow-up-records');
  assert.deepEqual(await reopened.getInterview(record.id), record);
  const deleted = { ...record, outlineSupplements: [] };
  await reopened.saveInterviewDraft(deleted);
  assert.deepEqual(await store.getInterview(record.id), deleted);
  assert.deepEqual(
    (await store.getInterview(record.id))?.resumeReading,
    record.resumeReading,
  );
  assert.deepEqual(
    (await store.getInterview(record.id))?.report,
    record.report,
  );
});

void test('a proven conflict-free task merge atomically preserves the draft and records the compared revision', async () => {
  const store = createLocalStore(new IDBFactory(), 'follow-up-rebase');
  await store.saveRemoteInterview(session, 4);
  const { followUpGroupFixture } =
    await import('./fixtures/follow-up-outline.ts');
  const merged = {
    ...session,
    transcript: '最新输入',
    outlineSupplements: [followUpGroupFixture()],
  };
  await store.saveFollowUpRefresh(merged, 5, { upload: true });
  assert.deepEqual(await store.getInterview(session.id), merged);
  assert.equal((await store.getSyncMeta(session.id))?.revision, 5);
  const pending = (await store.listPendingSync())[0];
  assert.deepEqual(pending.record, merged);
  assert.equal(pending.baseRevision, 5);
  assert.ok(pending.mutationId);
});

void test('task refresh cannot upload a conflict under a new CAS revision and preserves both sides atomically', async () => {
  const store = createLocalStore(new IDBFactory(), 'follow-up-conflict-save');
  await store.saveRemoteInterview(session, 4);
  await store.queueInterviewSync(session);
  const before = await store.listPendingSync();
  const remote = { ...session, transcript: '云端版本' };
  const conflict = {
    id: 'conflict-one',
    interviewId: session.id,
    createdAt: 1,
    local: { ...session, transcript: '本地版本' },
    remote,
  };
  await assert.rejects(
    store.saveFollowUpRefresh(remote, 5, { upload: true, conflict }),
    /不能使用新的云端版本号上传/,
  );
  assert.deepEqual(await store.listPendingSync(), before);
  assert.equal((await store.getSyncMeta(session.id))?.revision, 4);
  await store.saveFollowUpRefresh(remote, 5, { upload: false, conflict });
  assert.deepEqual(await store.listInterviewConflicts(), [conflict]);
  assert.deepEqual(await store.getInterview(session.id), remote);
  assert.equal((await store.listPendingSync()).length, 0);
});
