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
      onFollowUpRefresh: (fields: object) => {
        applied.push(fields);
      },
    },
  };
  const environment = {
    id: record.id,
    options: { cloud: true },
    activeId: { current: record.id },
    callbacks,
    writes: { current: Promise.resolve() },
    syncs: { current: Promise.resolve() },
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
  let finish: (value: typeof remote) => void = () => {};
  environment.transport.current.get = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const refreshing = methods.refreshFollowUpFromCloud();
  await new Promise<void>((resolve) => setImmediate(resolve));
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '请求期间继续输入',
  };
  finish(remote);
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
  let finish: (value: typeof remote) => void = () => {};
  environment.transport.current.get = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const refreshing = methods.refreshFollowUpFromCloud();
  await new Promise<void>((resolve) => setImmediate(resolve));
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '刷新期间自动保存的编辑',
  };
  const saving = methods.write(record.id, environment.callbacks.current.draft);
  finish(remote);
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
  let finish: (value: typeof remote) => void = () => {};
  environment.transport.current.get = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const refreshing = methods.refreshFollowUpFromCloud();
  await new Promise<void>((resolve) => setImmediate(resolve));
  environment.activeId.current = 'record-two';
  environment.callbacks.current.draft = {
    ...environment.callbacks.current.draft,
    transcript: '另一候选人的输入',
  };
  finish(remote);
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
  const rebase = store.rebaseInterviewDraft;
  let finish: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let entered = false;
  store.rebaseInterviewDraft = async (...args) => {
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
  environment.transport.current.get = () => {
    requests++;
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
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(uploadAllowed, false);
  finishRequest(remote);
  await Promise.all([refreshing, upload]);
  assert.equal(uploadAllowed, true);
  assert.equal((await store.getSyncMeta(record.id))?.revision, 6);
});

void test('only follow-up recovery uses the partial refresh API and it never restores the whole page', async () => {
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
  assert.doesNotMatch(refresh, /\.restore\(|clearTimeout|setReady/);
});
