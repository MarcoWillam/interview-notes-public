import { compileFunction } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

void test('authenticated workspaces migrate, autosave and retry cloud records', async () => {
  const [hook, page] = await Promise.all([
    readFile(
      new URL('../hooks/use-interview-library.ts', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(hook, /createInterviewSyncTransport/);
  assert.match(hook, /migrateAndSyncInterviews/);
  assert.match(hook, /queueInterviewSync/);
  assert.match(hook, /transport\.current\.workspace\(\)/);
  assert.match(hook, /putWorkspace/);
  assert.match(hook, /workspacePreferences/);
  assert.match(hook, /addEventListener\('online'/);
  assert.match(hook, /syncStatus/);
  assert.match(
    page,
    /cloud:\s*!!workspaceAccount\s*&&\s*!workspaceAccount\.preview/,
  );
  assert.match(page, /需要处理冲突/);
  assert.match(page, /等待同步到云端/);
  assert.match(page, /已同步到云端/);
});

void test('preview workspaces keep the explicit local-only save state', async () => {
  const page = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(page, /已保存在当前浏览器/);
  assert.match(page, /workspaceAccount\?\.preview/);
});

void test('cloud deletion keeps the local record until the server confirms it', async () => {
  const ts = await import('typescript');
  const { IDBFactory } = await import('fake-indexeddb');
  const { createLocalStore } = await import('../lib/local/store.ts');
  const source = await readFile(
    new URL('../hooks/use-interview-library.ts', import.meta.url),
    'utf8',
  );
  const file = ts.createSourceFile(
    'hook.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let code = '';
  const visit = (node: import('typescript').Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'remove')
      code = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(code, 'remove must exist');
  const record = {
    id: 'delete-cloud-record',
    createdAt: 1,
    updatedAt: 1,
    candidate: '待删除候选人',
    role: 'AI 产品经理',
    requirements: '岗位要求',
    dimensionText: '自驱力',
    focus: '',
    resumeText: '简历正文',
    resumeName: '简历.docx',
    resumeReading: null,
    transcript: '',
    reviewed: false,
    report: null,
    conclusion: '',
    confirmed: false,
  };
  const store = createLocalStore(new IDBFactory(), 'confirmed-cloud-delete');
  await store.saveRemoteInterview(record, 4);
  const environment = {
    setWorking: () => {},
    id: 'another-current-record',
    writes: { current: Promise.resolve() },
    localStore: () => store,
    options: { cloud: true },
    setSyncStatus: () => {},
    synchronize: async () => {
      throw new Error('服务器删除失败');
    },
    refresh: async () => {},
    setReady: () => {},
  };
  const remove = compileFunction(
    `${ts.transpile(code, { target: ts.ScriptTarget.ES2022 })}; return remove;`,
    Object.keys(environment),
  )(...Object.values(environment)) as (id: string) => Promise<void>;

  await assert.rejects(remove(record.id), /服务器删除失败/);
  assert.ok(await store.getInterview(record.id));
  assert.equal((await store.listPendingSync())[0]?.operation, 'delete');
});

void test('explicit draft saves and cloud refresh are scoped to the live record', async () => {
  const hook = await readFile(
    new URL('../hooks/use-interview-library.ts', import.meta.url),
    'utf8',
  );
  assert.match(hook, /async function flush\(overrides\?: Partial<Draft>\)/);
  assert.match(hook, /\.\.\.callbacks\.current\.draft, \.\.\.overrides/);
  assert.match(hook, /interviewId === activeId\.current/);
  const refresh = hook.slice(
    hook.indexOf('async function refreshFromCloud'),
    hook.indexOf('async function open('),
  );
  assert.match(refresh, /await writes\.current/);
  assert.match(refresh, /await syncs\.current/);
});

void test('cloud refresh cannot restore a record after the user has selected another one', async () => {
  const ts = await import('typescript');
  const source = await readFile(
    new URL('../hooks/use-interview-library.ts', import.meta.url),
    'utf8',
  );
  const code = source.slice(
    source.indexOf('async function refreshFromCloud'),
    source.indexOf('async function open('),
  );
  const activeId = { current: 'first' };
  const restored: unknown[] = [];
  const environment = {
    id: 'first',
    options: { cloud: true },
    activeId,
    timer: { current: null },
    writes: { current: Promise.resolve() },
    syncs: { current: Promise.resolve() },
    transport: {
      current: { get: async () => ({ record: { id: 'first' }, revision: 2 }) },
    },
    localStore: () => ({ saveRemoteInterview: async () => {} }),
    normalizeSession: async (record: unknown) => {
      activeId.current = 'second';
      return record;
    },
    callbacks: {
      current: {
        restore: async (record: unknown) => {
          restored.push(record);
        },
      },
    },
    createdAt: { current: null },
    setReady: () => {},
    refresh: async () => {},
    setSyncStatus: () => {},
  };
  const refresh = compileFunction(
    `${ts.transpile(code, { target: ts.ScriptTarget.ES2022 })}; return refreshFromCloud;`,
    Object.keys(environment),
  )(...Object.values(environment)) as (id: string) => Promise<void>;
  await refresh('first');
  assert.deepEqual(restored, []);
});

void test('opening a task interview synchronizes before restoring the latest cloud result', async () => {
  const ts = await import('typescript');
  const source = await readFile(
    new URL('../hooks/use-interview-library.ts', import.meta.url),
    'utf8',
  );
  const file = ts.createSourceFile(
    'hook.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const functions = new Map<string, string>();
  const visit = (node: import('typescript').Node) => {
    if (ts.isFunctionDeclaration(node) && node.name)
      functions.set(node.name.text, node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(functions.has('openRecord'));
  assert.ok(functions.has('openLatest'));

  const local = {
    id: 'target-record',
    candidate: '候选人',
    createdAt: 1,
    updatedAt: 1,
    report: null,
  };
  const cloud = {
    ...local,
    updatedAt: 2,
    report: { summary: '云端刚完成的评估' },
  };
  let stored = local as typeof local | typeof cloud;
  const restored: (typeof local | typeof cloud)[] = [];
  const sequence: string[] = [];
  const environment = {
    setWorking: () => {},
    flushDirtyForNavigation: async () => {
      sequence.push('flush-current');
    },
    options: { cloud: true },
    synchronize: async () => {
      sequence.push('sync-cloud');
      stored = cloud;
    },
    localStore: () => ({
      getInterview: async () => {
        sequence.push('read-target');
        return stored;
      },
    }),
    setReady: () => {},
    createdAt: { current: null },
    normalizeSession: async (record: typeof stored) => record,
    selectId: () => {},
    visibleDraftBase: { current: new Map() },
    callbacks: {
      current: {
        restore: async (record: typeof stored) => {
          sequence.push('restore-target');
          restored.push(record);
        },
      },
    },
    setSaved: () => {},
  };
  const compiled = ts.transpile(
    `${functions.get('openRecord')}\n${functions.get('openLatest')}`,
    { target: ts.ScriptTarget.ES2022 },
  );
  const openLatest = compileFunction(
    `${compiled}; return openLatest;`,
    Object.keys(environment),
  )(...Object.values(environment)) as (id: string) => Promise<void>;

  await openLatest(local.id);
  assert.deepEqual(sequence, [
    'flush-current',
    'sync-cloud',
    'read-target',
    'restore-target',
  ]);
  assert.equal(restored[0].report?.summary, '云端刚完成的评估');
  assert.equal('followUpOutlineJobId' in restored[0], false);

  const failedRestores: unknown[] = [];
  const failedEnvironment = {
    ...environment,
    synchronize: async () => {
      throw new Error('云端同步失败');
    },
    callbacks: {
      current: {
        restore: async (record: unknown) => {
          failedRestores.push(record);
        },
      },
    },
  };
  const failedOpenLatest = compileFunction(
    `${compiled}; return openLatest;`,
    Object.keys(failedEnvironment),
  )(...Object.values(failedEnvironment)) as (id: string) => Promise<void>;
  await assert.rejects(failedOpenLatest(local.id), /云端同步失败/);
  assert.deepEqual(failedRestores, []);
});

void test('opening another record does not supersede an accepted task with an unchanged draft', async () => {
  const ts = await import('typescript');
  const { IDBFactory } = await import('fake-indexeddb');
  const { createLocalStore } = await import('../lib/local/store.ts');
  const { interviewDraft, reconcileInterviewDraft, sameInterviewDraft } =
    await import('../lib/interview-draft-merge.ts');
  const { followUpGroupFixture } =
    await import('./fixtures/follow-up-outline.ts');
  const source = await readFile(
    new URL('../hooks/use-interview-library.ts', import.meta.url),
    'utf8',
  );
  const file = ts.createSourceFile(
    'hook.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const functions = new Map<string, string>();
  const visit = (node: import('typescript').Node) => {
    if (ts.isFunctionDeclaration(node) && node.name)
      functions.set(node.name.text, node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  const compiled = ts.transpile(
    [
      functions.get('flushDirtyForNavigation'),
      functions.get('openRecord'),
      functions.get('openLatest'),
    ].join('\n'),
    { target: ts.ScriptTarget.ES2022 },
  );
  const active = {
    id: 'record-a',
    createdAt: 1,
    updatedAt: 1,
    candidate: '候选人 A',
    role: 'AI 产品经理',
    requirements: '岗位要求',
    dimensionText: '自驱力',
    focus: '',
    scoringGuidance: '',
    reportRequirements: '',
    resumeText: '简历 A',
    resumeName: 'A.docx',
    resumeReading: null,
    transcript: '',
    transcriptName: '',
    reviewed: false,
    report: null,
    conclusion: '',
    confirmed: false,
  };
  const target = {
    ...active,
    id: 'record-b',
    candidate: '候选人 B',
    resumeText: '简历 B',
    resumeName: 'B.docx',
  };
  const cloudTarget = {
    ...target,
    updatedAt: 2,
    conclusion: '云端最新结论',
  };
  const activeTaskResult = {
    ...active,
    updatedAt: 2,
    report: {
      summary: '后台任务刚生成的报告',
      dimensions: [],
      followUps: [],
    },
    outlineSupplements: [followUpGroupFixture()],
    followUpOutlineJobId: 'job-applied',
  };
  const store = createLocalStore(new IDBFactory(), 'navigation-running-task');
  await store.saveRemoteInterview(activeTaskResult, 6);
  await store.saveRemoteInterview(target, 1);
  const activeId = { current: active.id };
  const writes = { current: Promise.resolve() };
  const timer = { current: null };
  const restored: unknown[] = [];
  let taskApplied = false;
  let writeCount = 0;
  const callbacks = {
    current: {
      draft: interviewDraft(active),
      restore: async (record: typeof cloudTarget) => {
        restored.push(record);
      },
    },
  };
  const write = (
    currentId: string,
    value: ReturnType<typeof interviewDraft>,
  ) => {
    writeCount += 1;
    const next = writes.current.then(async () => {
      const saved = {
        ...value,
        id: currentId,
        createdAt: 1,
        updatedAt: Date.now(),
      };
      await store.saveInterviewDraft(saved);
      await store.queueInterviewSync(saved, 'periodic-edit');
      return saved;
    });
    writes.current = next.then(() => {});
    return next;
  };
  const environment = {
    ready: true,
    timer,
    writes,
    activeId,
    callbacks,
    localStore: () => store,
    interviewDraft,
    reconcileInterviewDraft,
    sameInterviewDraft,
    write,
    setWorking: () => {},
    options: { cloud: true },
    synchronize: async () => {
      const pending = await store.listPendingSync();
      const latestActive = await store.getInterview(active.id);
      taskApplied =
        !pending.some((item) => item.id === active.id) &&
        (await store.getSyncMeta(active.id))?.revision === 6 &&
        latestActive?.report?.summary === '后台任务刚生成的报告' &&
        latestActive?.outlineSupplements?.length === 1;
      await store.saveRemoteInterview(cloudTarget, 2);
    },
    setReady: () => {},
    createdAt: { current: null },
    normalizeSession: async (record: typeof cloudTarget) => record,
    selectId: (nextId: string) => {
      activeId.current = nextId;
    },
    visibleDraftBase: { current: new Map([[active.id, active]]) },
    setConflicts: () => {},
    setConflictCount: () => {},
    setSyncStatus: () => {},
    setError: () => {},
    setSaved: () => {},
  };
  const openLatest = compileFunction(
    `${compiled}; return openLatest;`,
    Object.keys(environment),
  )(...Object.values(environment)) as (id: string) => Promise<void>;

  await openLatest(target.id);
  assert.equal(writeCount, 0);
  assert.equal((await store.listPendingSync()).length, 0);
  assert.equal((await store.getSyncMeta(active.id))?.revision, 6);
  assert.equal(taskApplied, true);
  assert.equal(
    (await store.getInterview(active.id))?.report?.summary,
    '后台任务刚生成的报告',
  );
  assert.deepEqual(restored, [cloudTarget]);
});

void test('navigation saves only actual draft changes and waits for queued writes', async () => {
  const ts = await import('typescript');
  const { IDBFactory } = await import('fake-indexeddb');
  const { createLocalStore } = await import('../lib/local/store.ts');
  const { interviewDraft, reconcileInterviewDraft, sameInterviewDraft } =
    await import('../lib/interview-draft-merge.ts');
  const { followUpGroupFixture } =
    await import('./fixtures/follow-up-outline.ts');
  const source = await readFile(
    new URL('../hooks/use-interview-library.ts', import.meta.url),
    'utf8',
  );
  const file = ts.createSourceFile(
    'hook.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let code = '';
  const visit = (node: import('typescript').Node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'flushDirtyForNavigation'
    )
      code = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(code, 'flushDirtyForNavigation must exist');
  const record = {
    id: 'record-a',
    createdAt: 1,
    updatedAt: 1,
    candidate: '候选人 A',
    role: 'AI 产品经理',
    requirements: '岗位要求',
    dimensionText: '自驱力',
    focus: '',
    scoringGuidance: '',
    reportRequirements: '',
    resumeText: '简历',
    resumeName: '简历.docx',
    resumeReading: null,
    transcript: '',
    transcriptName: '',
    reviewed: false,
    report: null,
    conclusion: '',
    confirmed: false,
  };
  const store = createLocalStore(new IDBFactory(), 'navigation-dirty-check');
  await store.saveRemoteInterview(record, 5);
  const callbacks = { current: { draft: interviewDraft(record) } };
  const writes = { current: Promise.resolve() };
  const activeId = { current: record.id };
  const pendingTimer = setTimeout(() => {}, 60_000);
  pendingTimer.unref();
  const timer = { current: pendingTimer };
  const savedDrafts: unknown[] = [];
  const visibleDraftBase = { current: new Map([[record.id, record]]) };
  const environment = {
    ready: true,
    timer,
    writes,
    activeId,
    callbacks,
    localStore: () => store,
    interviewDraft,
    reconcileInterviewDraft,
    sameInterviewDraft,
    visibleDraftBase,
    createdAt: { current: 1 },
    setConflicts: () => {},
    setConflictCount: () => {},
    setSyncStatus: () => {},
    setError: () => {},
    write: async (id: string, draft: ReturnType<typeof interviewDraft>) => {
      savedDrafts.push(draft);
      const saved = { ...draft, id, createdAt: 1, updatedAt: Date.now() };
      await store.saveInterviewDraft(saved);
      await store.queueInterviewSync(saved, 'periodic-edit');
    },
  };
  const flushDirty = compileFunction(
    `${ts.transpile(code, { target: ts.ScriptTarget.ES2022 })}; return flushDirtyForNavigation;`,
    Object.keys(environment),
  )(...Object.values(environment)) as () => Promise<void>;

  await flushDirty();
  assert.equal(savedDrafts.length, 0);
  assert.equal((await store.listPendingSync()).length, 0);
  assert.equal((await store.getSyncMeta(record.id))?.revision, 5);

  callbacks.current.draft = {
    ...callbacks.current.draft,
    candidate: '候选人 A（已编辑）',
  };
  await flushDirty();
  assert.equal(savedDrafts.length, 1);
  assert.equal(
    (await store.listPendingSync())[0].record?.candidate,
    '候选人 A（已编辑）',
  );

  let releaseQueuedWrite = () => {};
  writes.current = new Promise<void>((resolve) => {
    releaseQueuedWrite = resolve;
  });
  let settled = false;
  const waiting = flushDirty().then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  callbacks.current.draft = {
    ...callbacks.current.draft,
    conclusion: '等待期间输入的结论',
  };
  releaseQueuedWrite();
  await waiting;
  assert.equal(
    (await store.getInterview(record.id))?.conclusion,
    '等待期间输入的结论',
  );

  activeId.current = 'new-record';
  callbacks.current.draft = {
    ...callbacks.current.draft,
    candidate: '新记录',
  };
  writes.current = Promise.resolve();
  await flushDirty();
  assert.equal((await store.getInterview('new-record'))?.candidate, '新记录');

  const backgroundId = 'background-task-result';
  const backgroundBase = { ...record, id: backgroundId };
  const group = followUpGroupFixture();
  const backgroundRemote = {
    ...backgroundBase,
    updatedAt: 6,
    report: {
      summary: '后台任务生成的报告',
      dimensions: [],
      followUps: [],
    },
    outlineSupplements: [group],
    followUpOutlineJobId: 'job-background',
  };
  await store.saveRemoteInterview(backgroundRemote, 6);
  activeId.current = backgroundId;
  callbacks.current.draft = interviewDraft(backgroundBase);
  visibleDraftBase.current.set(backgroundId, backgroundBase);
  writes.current = Promise.resolve();
  const beforeCleanNavigation = savedDrafts.length;
  await flushDirty();
  assert.equal(savedDrafts.length, beforeCleanNavigation);
  assert.equal(
    (await store.getInterview(backgroundId))?.report?.summary,
    '后台任务生成的报告',
  );
  assert.deepEqual(
    (await store.getInterview(backgroundId))?.outlineSupplements,
    [group],
  );
  assert.equal(
    (await store.listPendingSync()).some((item) => item.id === backgroundId),
    false,
  );

  const mergedId = 'background-task-with-local-note';
  const mergedBase = { ...record, id: mergedId };
  const mergedRemote = {
    ...mergedBase,
    updatedAt: 7,
    report: {
      summary: '需要保留的后台报告',
      dimensions: [],
      followUps: [],
    },
    followUpOutlineJobId: 'job-running-elsewhere',
  };
  await store.saveRemoteInterview(mergedRemote, 7);
  activeId.current = mergedId;
  callbacks.current.draft = {
    ...interviewDraft(mergedBase),
    focus: '面试官刚补充的备注',
  };
  visibleDraftBase.current.set(mergedId, mergedBase);
  writes.current = Promise.resolve();
  await flushDirty();
  const mergedOutbox = (await store.listPendingSync()).find(
    (item) => item.id === mergedId,
  );
  assert.equal(mergedOutbox?.baseRevision, 7);
  assert.equal(mergedOutbox?.record?.focus, '面试官刚补充的备注');
  assert.equal(mergedOutbox?.record?.report?.summary, '需要保留的后台报告');
  assert.equal(
    mergedOutbox?.record?.followUpOutlineJobId,
    'job-running-elsewhere',
  );

  const conflictId = 'background-task-conflict';
  const conflictBase = { ...record, id: conflictId, transcript: '共同版本' };
  const conflictRemote = {
    ...conflictBase,
    updatedAt: 8,
    transcript: '后台任务更新的面试记录',
  };
  await store.saveRemoteInterview(conflictRemote, 8);
  activeId.current = conflictId;
  callbacks.current.draft = {
    ...interviewDraft(conflictBase),
    transcript: '面试官本页更新的面试记录',
  };
  visibleDraftBase.current.set(conflictId, conflictBase);
  writes.current = Promise.resolve();
  await flushDirty();
  const conflict = (await store.listInterviewConflicts()).find(
    (item) => item.interviewId === conflictId,
  );
  assert.equal(conflict?.local.transcript, '面试官本页更新的面试记录');
  assert.equal(conflict?.remote.transcript, '后台任务更新的面试记录');
  assert.equal(
    (await store.listPendingSync()).some((item) => item.id === conflictId),
    false,
  );
  assert.equal(
    (await store.getInterview(conflictId))?.transcript,
    '后台任务更新的面试记录',
  );
});

void test('cloud recovery still refreshes after a local write has failed', async () => {
  const hook = await readFile(
    new URL('../hooks/use-interview-library.ts', import.meta.url),
    'utf8',
  );
  const refresh = hook.slice(
    hook.indexOf('async function refreshFromCloud'),
    hook.indexOf('async function open('),
  );
  assert.match(refresh, /await writes\.current\.catch\(\(\) => \{\}\)/);
});

async function followUpRefreshHarness() {
  const ts = await import('typescript');
  const { IDBFactory } = await import('fake-indexeddb');
  const { createLocalStore } = await import('../lib/local/store.ts');
  const { followUpInputFixture, followUpGroupFixture } =
    await import('./fixtures/follow-up-outline.ts');
  const input = followUpInputFixture();
  const group = followUpGroupFixture();
  const record = {
    ...input,
    id: 'record-one',
    createdAt: 1,
    updatedAt: 1,
    candidate: '候选人',
    resumeName: '简历',
    transcript: '已保存记录',
    reviewed: false,
    report: null,
    conclusion: '',
    confirmed: false,
    outlineSupplements: [],
    followUpOutlineJobId: group.jobId,
  };
  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    ...draft
  } = record;
  const store = createLocalStore(new IDBFactory(), 'follow-up-refresh');
  await store.saveRemoteInterview(record, 5);
  const remote = {
    record: {
      ...record,
      outlineSupplements: [group],
      followUpOutlineJobId: undefined,
    },
    revision: 6,
    deletedAt: null,
  };
  const applied: unknown[] = [];
  const callbacks = {
    current: {
      draft,
      restore: async (record: {
        outlineSupplements?: unknown;
        followUpOutlineJobId?: unknown;
      }) => {
        applied.push({
          outlineSupplements: record.outlineSupplements,
          followUpOutlineJobId: record.followUpOutlineJobId,
        });
      },
    },
  };
  const environment = {
    ...(await import('../lib/interview-follow-up-refresh.ts')),
    setConflicts: () => {},
    setConflictCount: () => {},
    id: record.id,
    options: { cloud: true },
    activeId: { current: record.id },
    callbacks,
    writes: { current: Promise.resolve() },
    syncs: { current: Promise.resolve() },
    visibleDraftBase: { current: new Map([[record.id, record]]) },
    followUpFields: { current: new Map() },
    transport: { current: { get: async () => remote } },
    localStore: () => store,
    createdAt: { current: 1 },
    synchronize: async () => {},
    setSyncStatus: () => {},
    setSessions: () => {},
    setSaved: () => {},
    setError: () => {},
    updateInterviewSummary: (rows: unknown[]) => rows,
    cloudVersionReason: () => 'periodic-edit',
  };
  const source = await readFile(
    new URL('../hooks/use-interview-library.ts', import.meta.url),
    'utf8',
  );
  const file = ts.createSourceFile(
    'hook.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const functions = new Map<string, string>();
  const visit = (node: import('typescript').Node) => {
    if (ts.isFunctionDeclaration(node) && node.name)
      functions.set(node.name.text, node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(
    functions.has('refreshFollowUpFromCloud'),
    'follow-up refresh must preserve the live draft rather than restore the full record',
  );
  const compiled = ts.transpile(
    `${functions.get('write')}\n${functions.get('refreshFollowUpFromCloud')}`,
    { target: ts.ScriptTarget.ES2022 },
  );
  const methods = compileFunction(
    `${compiled}; return { write, refreshFollowUpFromCloud };`,
    Object.keys(environment),
  )(...Object.values(environment)) as {
    write: (id: string, draft: object) => Promise<void>;
    refreshFollowUpFromCloud: (id?: string) => Promise<void>;
  };
  return { environment, store, methods, record, remote, applied, group };
}

void test('follow-up completion merges server groups with edits still waiting for the 400ms autosave', async () => {
  const { environment, store, methods, record, group, applied } =
    await followUpRefreshHarness();
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '刚输入还未落盘',
  };
  await methods.refreshFollowUpFromCloud();
  const saved = await store.getInterview(record.id);
  assert.equal(saved?.transcript, '刚输入还未落盘');
  assert.deepEqual(saved?.outlineSupplements, [group]);
  assert.equal(saved?.followUpOutlineJobId, undefined);
  assert.deepEqual(applied, [
    { outlineSupplements: [group], followUpOutlineJobId: undefined },
  ]);
  const outbox = await store.listPendingSync();
  assert.equal(outbox[0].baseRevision, 6);
  assert.equal(outbox[0].record?.transcript, '刚输入还未落盘');
  assert.deepEqual(outbox[0].record?.outlineSupplements, [group]);
});

void test('follow-up refresh reads the latest input after the cloud request finishes', async () => {
  const { environment, methods, store, remote, record, group } =
    await followUpRefreshHarness();
  const response = Promise.withResolvers<typeof remote>();
  const started = Promise.withResolvers<void>();
  environment.transport.current.get = () => {
    started.resolve();
    return response.promise;
  };
  const refreshing = methods.refreshFollowUpFromCloud();
  await started.promise;
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '请求期间继续输入',
  };
  response.resolve(remote);
  await refreshing;
  assert.equal(
    (await store.getInterview(record.id))?.transcript,
    '请求期间继续输入',
  );
  assert.deepEqual((await store.getInterview(record.id))?.outlineSupplements, [
    group,
  ]);
});

void test('autosave queued during refresh keeps later edits without reintroducing stale groups', async () => {
  const { environment, methods, store, remote, record, group } =
    await followUpRefreshHarness();
  const response = Promise.withResolvers<typeof remote>();
  const started = Promise.withResolvers<void>();
  environment.transport.current.get = () => {
    started.resolve();
    return response.promise;
  };
  const refreshing = methods.refreshFollowUpFromCloud();
  await started.promise;
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '刷新期间自动保存的编辑',
  };
  const saving = methods.write(record.id, environment.callbacks.current.draft);
  response.resolve(remote);
  await Promise.all([refreshing, saving]);
  const saved = await store.getInterview(record.id);
  assert.equal(saved?.transcript, '刷新期间自动保存的编辑');
  assert.deepEqual(saved?.outlineSupplements, [group]);
  assert.equal(saved?.followUpOutlineJobId, undefined);
  const outbox = await store.listPendingSync();
  assert.equal(outbox[0].baseRevision, 6);
  assert.deepEqual(outbox[0].record?.outlineSupplements, [group]);
});

void test('switching records during follow-up refresh never applies the next record draft to the previous record', async () => {
  const { environment, methods, store, remote, record, group, applied } =
    await followUpRefreshHarness();
  const response = Promise.withResolvers<typeof remote>();
  const started = Promise.withResolvers<void>();
  environment.transport.current.get = () => {
    started.resolve();
    return response.promise;
  };
  const refreshing = methods.refreshFollowUpFromCloud();
  await started.promise;
  environment.activeId.current = 'record-two';
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '另一候选人的输入',
  };
  response.resolve(remote);
  await refreshing;
  assert.deepEqual(applied, []);
  assert.equal(
    (await store.getInterview(record.id))?.transcript,
    record.transcript,
  );
  assert.deepEqual((await store.getInterview(record.id))?.outlineSupplements, [
    group,
  ]);
  assert.equal(
    environment.callbacks.current.draft.transcript,
    '另一候选人的输入',
  );
});

void test('input made during IndexedDB reconciliation remains in React and in the next autosave', async () => {
  const { environment, methods, store, record, group, applied } =
    await followUpRefreshHarness();
  const rebase = store.saveFollowUpRefresh;
  let finish: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let entered = false;
  store.saveFollowUpRefresh = async (...args) => {
    entered = true;
    await barrier;
    await rebase(...args);
  };
  const refreshing = methods.refreshFollowUpFromCloud();
  while (!entered) await new Promise<void>((resolve) => setImmediate(resolve));
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '数据库写入期间的新输入',
  };
  const saving = methods.write(record.id, environment.callbacks.current.draft);
  finish();
  await Promise.all([refreshing, saving]);
  assert.equal(
    environment.callbacks.current.draft.transcript,
    '数据库写入期间的新输入',
  );
  assert.equal(
    (await store.getInterview(record.id))?.transcript,
    '数据库写入期间的新输入',
  );
  assert.deepEqual((await store.getInterview(record.id))?.outlineSupplements, [
    group,
  ]);
  assert.deepEqual(applied, [
    { outlineSupplements: [group], followUpOutlineJobId: undefined },
  ]);
});

void test('follow-up reconcile waits for existing sync and reserves uploads until its cloud revision is rebased', async () => {
  const { environment, methods, remote, store, record } =
    await followUpRefreshHarness();
  let finishPreviousSync: () => void = () => {};
  environment.syncs.current = new Promise<void>((resolve) => {
    finishPreviousSync = resolve;
  });
  let finishRequest: (value: typeof remote) => void = () => {};
  let requests = 0;
  const started = Promise.withResolvers<void>();
  environment.transport.current.get = () => {
    requests++;
    started.resolve();
    return new Promise((resolve) => {
      finishRequest = resolve;
    });
  };
  const refreshing = methods.refreshFollowUpFromCloud();
  let uploadAllowed = false;
  const upload = environment.syncs.current.then(() => {
    uploadAllowed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests, 0);
  finishPreviousSync();
  await started.promise;
  assert.equal(requests, 1);
  assert.equal(uploadAllowed, false);
  finishRequest(remote);
  await Promise.all([refreshing, upload]);
  assert.equal(uploadAllowed, true);
  assert.equal((await store.getSyncMeta(record.id))?.revision, 6);
});

void test('only follow-up recovery uses the merge API and it publishes the compared fresh draft', async () => {
  const [page, hook] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../hooks/use-interview-library.ts', import.meta.url),
      'utf8',
    ),
  ]);
  const recovery = page.slice(
    page.indexOf('// Recover only the saved follow-up task'),
    page.indexOf('async function localAction'),
  );
  assert.match(recovery, /refreshFollowUpFromCloud\(recordId\)/);
  assert.doesNotMatch(recovery, /\.refreshFromCloud\(/);
  const refresh = hook.slice(
    hook.indexOf('async function refreshFollowUpFromCloud'),
    hook.indexOf('async function refreshFromCloud'),
  );
  assert.doesNotMatch(
    refresh,
    /restore\(value\.record\)|clearTimeout|setReady/,
  );
  assert.match(refresh, /restore\(merged\)/);
});

void test('follow-up refresh adopts remote-only transcript edits instead of treating the unchanged page as authoritative', async () => {
  const { environment, methods, remote, store, record, group } =
    await followUpRefreshHarness();
  remote.record.transcript = '另一页面已经修改的转写';
  await methods.refreshFollowUpFromCloud();
  assert.equal(
    (await store.getInterview(record.id))?.transcript,
    remote.record.transcript,
  );
  assert.equal(
    environment.callbacks.current.draft.transcript,
    remote.record.transcript,
  );
  assert.deepEqual((await store.getInterview(record.id))?.outlineSupplements, [
    group,
  ]);
  assert.equal((await store.listPendingSync()).length, 0);
});

void test('follow-up refresh merges local-only conclusion edits with remote-only transcript edits and new groups', async () => {
  const { environment, methods, remote, store, record, group } =
    await followUpRefreshHarness();
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    conclusion: '本页刚写的备注',
  };
  remote.record.transcript = '另一页更正的转写';
  await methods.refreshFollowUpFromCloud();
  const saved = await store.getInterview(record.id);
  assert.equal(saved?.conclusion, '本页刚写的备注');
  assert.equal(saved?.transcript, '另一页更正的转写');
  assert.deepEqual(saved?.outlineSupplements, [group]);
  assert.equal((await store.listInterviewConflicts()).length, 0);
  const pending = (await store.listPendingSync())[0];
  assert.equal(pending.record?.transcript, '另一页更正的转写');
  assert.equal(pending.record?.conclusion, '本页刚写的备注');
});

void test('divergent edits to the same field become a recoverable conflict and are not uploaded with a reset CAS', async () => {
  const { environment, methods, remote, store, record, group } =
    await followUpRefreshHarness();
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '本页版本',
  };
  remote.record.transcript = '另一页面版本';
  await methods.refreshFollowUpFromCloud();
  const conflicts = await store.listInterviewConflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].local.transcript, '本页版本');
  assert.equal(conflicts[0].remote.transcript, '另一页面版本');
  assert.deepEqual(conflicts[0].local.outlineSupplements, [group]);
  assert.equal((await store.listPendingSync()).length, 0);
  assert.equal(
    (await store.getInterview(record.id))?.transcript,
    '另一页面版本',
  );
});

void test('an existing outbox with an unknown common base is preserved as a conflict rather than silently rebased', async () => {
  const { environment, methods, remote, store, record } =
    await followUpRefreshHarness();
  const unsynced = { ...record, transcript: '此前已保存但未同步的本地版本' };
  await store.saveInterviewDraft(unsynced);
  await store.queueInterviewSync(unsynced);
  assert.equal((await store.listPendingSync())[0].baseRevision, 5);
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: unsynced.transcript,
  };
  remote.record.transcript = '云端的另一个版本';
  await methods.refreshFollowUpFromCloud();
  const conflicts = await store.listInterviewConflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].local.transcript, unsynced.transcript);
  assert.equal(conflicts[0].remote.transcript, remote.record.transcript);
  assert.equal(
    (await store.listPendingSync()).length,
    0,
    'conflicted local data must not receive the new remote CAS revision',
  );
});

void test('queued autosave cannot put a conflicted local field back after recovery adopts the remote side', async () => {
  const { environment, methods, remote, store, record } =
    await followUpRefreshHarness();
  const response = Promise.withResolvers<typeof remote>();
  const started = Promise.withResolvers<void>();
  environment.transport.current.get = () => {
    started.resolve();
    return response.promise;
  };
  const refreshing = methods.refreshFollowUpFromCloud();
  await started.promise;
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '等待自动保存的本页内容',
  };
  const saving = methods.write(record.id, environment.callbacks.current.draft);
  remote.record.transcript = '另一页同时修改的内容';
  response.resolve(remote);
  await Promise.all([refreshing, saving]);
  assert.equal(
    (await store.getInterview(record.id))?.transcript,
    remote.record.transcript,
  );
  assert.equal((await store.listPendingSync()).length, 0);
  const conflict = (await store.listInterviewConflicts())[0];
  assert.equal(conflict.local.transcript, '等待自动保存的本页内容');
  assert.equal(conflict.remote.transcript, '另一页同时修改的内容');
});

void test('a safe merged upload still receives the normal conflict handling when the server changes after GET', async () => {
  const { environment, methods, remote, store, record } =
    await followUpRefreshHarness();
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    conclusion: '本页备注',
  };
  await methods.refreshFollowUpFromCloud();
  const { syncInterviewOutbox, InterviewSyncConflict } =
    await import('../lib/interview-sync.ts');
  const { interviewSummary } = await import('../lib/cloud-interview.ts');
  const newer = { ...remote.record, conclusion: 'GET 后另一页修改的备注' };
  let uploadedRevision = 0;
  await syncInterviewOutbox(store, {
    list: async () => [],
    get: async () => ({ record: newer, revision: 7, deletedAt: null }),
    put: async (_id, baseRevision) => {
      uploadedRevision = baseRevision;
      throw new InterviewSyncConflict(interviewSummary(newer, 7));
    },
    remove: async () => {
      throw new Error('unexpected delete');
    },
  });
  assert.equal(uploadedRevision, 6);
  const conflicts = await store.listInterviewConflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].local.conclusion, '本页备注');
  assert.equal(conflicts[0].remote.conclusion, 'GET 后另一页修改的备注');
  assert.equal((await store.listPendingSync()).length, 0);
  assert.equal((await store.getSyncMeta(record.id))?.revision, 7);
});

void test('fields absent from the editable draft are not mistaken for intentional local deletion', async () => {
  const { methods, remote, store, record } = await followUpRefreshHarness();
  await store.saveRemoteInterview({ ...record, groupId: 'old-group' }, 5);
  Object.assign(remote.record, { groupId: 'remote-group' });
  await methods.refreshFollowUpFromCloud();
  assert.equal((await store.getInterview(record.id))?.groupId, 'remote-group');
  assert.equal((await store.listInterviewConflicts()).length, 0);
});

void test('the existing conflict UI action can recover the complete local interview as a duplicate', async () => {
  const { environment, methods, remote, store, record, group } =
    await followUpRefreshHarness();
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '需要完整恢复的本页转写',
    conclusion: '尚未同步的面试官备注',
    reviewed: true,
  };
  remote.record.transcript = '云端保留的转写';
  await methods.refreshFollowUpFromCloud();
  const conflicts = await store.listInterviewConflicts();
  assert.equal(conflicts.length, 1);
  const ts = await import('typescript');
  const source = await readFile(
    new URL('../hooks/use-interview-library.ts', import.meta.url),
    'utf8',
  );
  const code = source.slice(
    source.indexOf('async function resolveConflict('),
    source.indexOf('async function loadPendingResults('),
  );
  const resolve = compileFunction(
    `${ts.transpile(code, { target: ts.ScriptTarget.ES2022 })}; return resolveConflict;`,
    ['conflicts', 'localStore', 'synchronize'],
  )(
    conflicts,
    () => store,
    async () => {},
  ) as (id: string, action: 'duplicate-local') => Promise<void>;
  await resolve(conflicts[0].id, 'duplicate-local');
  const duplicate = (await store.listInterviews()).find(
    (item) => item.id !== record.id,
  );
  assert.equal(duplicate?.transcript, '需要完整恢复的本页转写');
  assert.equal(duplicate?.conclusion, '尚未同步的面试官备注');
  assert.equal(duplicate?.reviewed, true);
  assert.deepEqual(duplicate?.resumeReading, record.resumeReading);
  assert.deepEqual(duplicate?.outlineSupplements, [group]);
  assert.equal(
    (await store.getInterview(record.id))?.transcript,
    remote.record.transcript,
  );
  assert.equal((await store.listInterviewConflicts()).length, 0);
});

void test('queued autosave preserves a remote optional-field deletion instead of retaining the old property', async () => {
  const { environment, methods, remote, store, record } =
    await followUpRefreshHarness();
  const response = Promise.withResolvers<typeof remote>();
  const started = Promise.withResolvers<void>();
  environment.transport.current.get = () => {
    started.resolve();
    return response.promise;
  };
  const refreshing = methods.refreshFollowUpFromCloud();
  await started.promise;
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    conclusion: '新增备注',
  };
  const saving = methods.write(record.id, environment.callbacks.current.draft);
  delete (remote.record as { scoringGuidance?: string }).scoringGuidance;
  response.resolve(remote);
  await Promise.all([refreshing, saving]);
  assert.equal(
    (await store.getInterview(record.id))?.scoringGuidance,
    undefined,
  );
  assert.equal((await store.getInterview(record.id))?.conclusion, '新增备注');
});

void test('background cache pulls do not turn an unchanged visible draft into a supposed local edit', async () => {
  const { environment, methods, remote, store, record } =
    await followUpRefreshHarness();
  remote.record.transcript = '后台同步已拉取的另一页面版本';
  await store.saveRemoteInterview(remote.record, 6);
  await methods.refreshFollowUpFromCloud();
  assert.equal(
    environment.callbacks.current.draft.transcript,
    remote.record.transcript,
  );
  assert.equal(
    (await store.getInterview(record.id))?.transcript,
    remote.record.transcript,
  );
  assert.equal((await store.listPendingSync()).length, 0);
});
