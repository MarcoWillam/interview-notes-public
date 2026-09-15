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
