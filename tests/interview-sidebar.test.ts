import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { SavedInterview } from '../lib/local/store.ts';
import {
  SIDEBAR_BREAKPOINT,
  interviewCreatedAt,
  moveManualInterview,
  parseSidebarCollapsed,
  parseSidebarSortMode,
  reconcileManualOrder,
  sidebarOrderStorageKey,
  sidebarSortStorageKey,
  sortInterviewSessions,
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

void test('sidebar sorts by creation time and falls back for legacy records', () => {
  const old = { ...session('old', 900), createdAt: 100 };
  const recent = { ...session('recent', 200), createdAt: 300 };
  const legacy = session('legacy', 250);
  const rows = [old, recent, legacy];

  assert.equal(interviewCreatedAt(legacy), 250);
  assert.deepEqual(
    sortInterviewSessions(rows, 'newest', []).map(({ id }) => id),
    ['recent', 'legacy', 'old'],
  );
  assert.deepEqual(
    sortInterviewSessions(rows, 'oldest', []).map(({ id }) => id),
    ['old', 'legacy', 'recent'],
  );
  assert.equal(parseSidebarSortMode('oldest'), 'oldest');
  assert.equal(parseSidebarSortMode('manual'), 'manual');
  assert.equal(parseSidebarSortMode('invalid'), 'newest');
  assert.equal(parseSidebarSortMode(null), 'newest');
});

void test('manual order prepends new records, drops deleted ids and moves deterministically', () => {
  const rows = [
    { ...session('new', 400), createdAt: 400 },
    { ...session('old', 100), createdAt: 100 },
  ];
  assert.deepEqual(reconcileManualOrder(['old', 'deleted'], rows), [
    'new',
    'old',
  ]);
  assert.deepEqual(
    sortInterviewSessions(rows, 'manual', ['old', 'new']).map(({ id }) => id),
    ['old', 'new'],
  );
  assert.deepEqual(moveManualInterview(['a', 'b', 'c'], 'c', 'a'), [
    'c',
    'a',
    'b',
  ]);
  assert.deepEqual(moveManualInterview(['a', 'b', 'c'], 'a', 'c'), [
    'b',
    'a',
    'c',
  ]);
  assert.equal(
    sidebarSortStorageKey('account-a'),
    'interview-sidebar-sort:account-a',
  );
  assert.equal(
    sidebarOrderStorageKey('account-b'),
    'interview-sidebar-order:account-b',
  );
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

void test('the interview library preserves one creation time for every record id', async () => {
  const [hook, store] = await Promise.all([
    readFile(
      new URL('../hooks/use-interview-library.ts', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../lib/local/store.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(store, /createdAt\?: number/);
  assert.match(
    hook,
    /Omit<SavedInterview, 'id' \| 'createdAt' \| 'updatedAt'>/,
  );
  assert.match(hook, /const createdAt = useRef<number \| null>\(null\)/);
  assert.match(hook, /createdAt: createdAt\.current/);
  assert.match(hook, /createdAt\.current = .*\.createdAt \?\? .*\.updatedAt/);
});

void test('sidebar exposes current state, responsive preference, and management actions', async () => {
  const source = await readFile(
    new URL('../components/interview/interview-sidebar.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /aria-current=\{current \? 'page' : undefined\}/);
  assert.match(source, /SIDEBAR_STORAGE_KEY/);
  assert.match(source, /window\.matchMedia/);
  assert.match(source, /新的面试/);
  assert.match(source, /记录管理/);
  assert.match(source, /未命名面试/);
  assert.match(source, /event\.key !== 'Escape'/);
  assert.match(source, /focusSidebarTrigger/);
});

void test('sidebar exposes account-scoped time and custom drag ordering', async () => {
  const source = await readFile(
    new URL('../components/interview/interview-sidebar.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /storageScope: string/);
  assert.match(source, /sidebarSortStorageKey\(props\.storageScope\)/);
  assert.match(source, /sidebarOrderStorageKey\(props\.storageScope\)/);
  assert.match(source, /最近添加/);
  assert.match(source, /最早添加/);
  assert.match(source, /自定义排序/);
  assert.match(source, /sortInterviewSessions/);
  assert.match(source, /reconcileManualOrder/);
  assert.match(source, /draggable=\{sortMode === 'manual'\}/);
  assert.match(source, /onDragStart=/);
  assert.match(source, /onDragOver=/);
  assert.match(source, /onDrop=/);
  assert.match(source, /event\.key === 'ArrowUp'/);
  assert.match(source, /event\.key === 'ArrowDown'/);
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

void test('workbench renders remote and local actions in one account-aware header', async () => {
  const [page, remote, taskCenter, css] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../components/interview/remote-workspace.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../components/interview/task-center.tsx', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(remote, /className="remote-bar"/);
  assert.match(remote, /workspaceAccount=\{\{/);
  assert.match(remote, /onOpenDevices:/);
  assert.match(remote, /onOpenAccount:/);
  assert.match(remote, /onLogout:/);
  assert.match(page, /export type WorkspaceAccount/);
  assert.match(page, /className="topbar-actions"/);
  assert.match(page, /className="workspace-tools"/);
  assert.match(page, /更多操作/);
  assert.match(page, /className="workspace-account-menu"/);
  assert.match(page, /<TaskCenter/);
  assert.match(page, /电脑连接/);
  assert.match(page, /账号配置/);
  assert.match(page, /退出登录/);
  assert.match(taskCenter, /workspace-action-copy/);
  assert.doesNotMatch(css, /\.remote-bar/);
  assert.match(css, /--workbench-header-height/);
  assert.match(css, /\.topbar\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /\.workspace-tools-content/);
  assert.match(css, /\.workspace-account-menu/);
  assert.match(css, /\.interview-sidebar-sort/);
  assert.match(css, /\.interview-sidebar-drag-handle/);
});
