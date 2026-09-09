import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { SavedInterview } from '../lib/local/store.ts';
import {
  SIDEBAR_BREAKPOINT,
  parseSidebarCollapsed,
  updateInterviewSummary,
} from '../lib/interview-sidebar.ts';

function session(id: string, updatedAt: number): SavedInterview {
  return {
    id,
    updatedAt,
    candidate: id,
    role: 'AI 产品经理（校招）',
    requirements: '',
    dimensionText: '自驱力',
    focus: '',
    resumeText: '',
    resumeName: '',
    transcript: '',
    reviewed: false,
    report: null,
    conclusion: '',
    confirmed: false,
  };
}

void test('saved interview metadata updates without reordering existing rows', () => {
  const rows = [session('a', 30), session('b', 20)];
  const updated = updateInterviewSummary(rows, {
    ...rows[1],
    candidate: '新姓名',
    updatedAt: 40,
  });
  assert.deepEqual(
    updated.map(({ id }) => id),
    ['a', 'b'],
  );
  assert.equal(updated[1].candidate, '新姓名');
});

void test('a newly saved interview is inserted at the start', () => {
  const current = session('new', 40);
  assert.deepEqual(
    updateInterviewSummary([session('old', 20)], current).map(({ id }) => id),
    ['new', 'old'],
  );
});

void test('sidebar preference accepts only the persisted collapsed value', () => {
  assert.equal(parseSidebarCollapsed('true'), true);
  assert.equal(parseSidebarCollapsed('false'), false);
  assert.equal(parseSidebarCollapsed(null), false);
  assert.equal(SIDEBAR_BREAKPOINT, 1180);
});

void test('the interview library updates sidebar summaries after a successful save', async () => {
  const source = await readFile(
    new URL('../hooks/use-interview-library.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /setSessions\(\(rows\) => updateInterviewSummary\(rows, saved\)\)/,
  );
});

void test('sidebar exposes current state, responsive preference, and management actions', async () => {
  const source = await readFile(
    new URL('../components/interview/interview-sidebar.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /aria-current=\{current \? 'page' : undefined\}/);
  assert.match(source, /SIDEBAR_STORAGE_KEY/);
  assert.match(source, /window\.matchMedia/);
  assert.match(source, /new ResizeObserver/);
  assert.match(source, /--remote-bar-height/);
  assert.match(source, /新的面试/);
  assert.match(source, /记录管理/);
  assert.match(source, /未命名面试/);
  assert.match(source, /event\.key !== 'Escape'/);
  assert.match(source, /focusSidebarTrigger/);
});

void test('local library is management-only and keeps destructive safeguards', async () => {
  const source = await readFile(
    new URL('../components/interview/local-library.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /<DialogTitle>记录管理<\/DialogTitle>/);
  assert.match(source, /申请持久保存/);
  assert.match(source, /aria-label=\{`下载 \$\{row\.candidate/);
  assert.match(source, /删除这场本地面试/);
  assert.doesNotMatch(source, /<FolderOpen/);
  assert.doesNotMatch(source, />\s*打开\s*</);
});

void test('workbench mounts the sidebar and reserves independent scrolling areas', async () => {
  const [page, css] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  ]);
  assert.match(page, /<InterviewSidebar/);
  assert.doesNotMatch(page, />\s*本地面试记录\s*</);
  assert.match(css, /\.workbench-shell\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.interview-sidebar-list\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width:\s*1179px\)/);
});
