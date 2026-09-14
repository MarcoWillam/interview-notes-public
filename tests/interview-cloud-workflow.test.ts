import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

void test('authenticated workspaces migrate, autosave and retry cloud records', async () => {
  const [hook, page] = await Promise.all([
    readFile(new URL('../hooks/use-interview-library.ts', import.meta.url), 'utf8'),
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
  assert.match(page, /cloud:\s*!!workspaceAccount\s*&&\s*!workspaceAccount\.preview/);
  assert.match(page, /需要处理冲突/);
  assert.match(page, /等待同步到云端/);
  assert.match(page, /已同步到云端/);
});

void test('preview workspaces keep the explicit local-only save state', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /已保存在当前浏览器/);
  assert.match(page, /workspaceAccount\?\.preview/);
});
