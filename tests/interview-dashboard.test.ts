import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadStatusModule() {
  const url = new URL('../lib/interview-status.ts', import.meta.url);
  const source = await readFile(url, 'utf8').catch(() => '');
  if (!source) return null;
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
  );
}

const base = {
  id: 'candidate',
  updatedAt: 1,
  candidate: '林晓雨',
  role: 'AI 产品经理（校招）',
  requirements: '',
  dimensionText: '自驱力',
  focus: '',
  resumeText: '',
  resumeName: '',
  resumeReading: null,
  transcript: '',
  reviewed: false,
  report: null,
  conclusion: '',
  confirmed: false,
};

void test('interview status is derived from existing record progress', async () => {
  const statusModule = await loadStatusModule();
  assert.ok(statusModule, 'interview status module should exist');
  const rows = [
    base,
    { ...base, transcript: '待校对记录' },
    { ...base, transcript: '已校对记录', reviewed: true },
    { ...base, transcript: '记录', reviewed: true, conclusion: '待确认' },
    { ...base, transcript: '记录', reviewed: true, confirmed: true },
  ];
  assert.deepEqual(rows.map(statusModule.interviewStatus), [
    'preparing',
    'needs-review',
    'needs-assessment',
    'needs-confirmation',
    'completed',
  ]);
  assert.deepEqual(
    statusModule.interviewStatusOptions.map(
      (item: { value: string; label: string }) => item.label,
    ),
    ['准备中', '待校对', '待评估', '待确认', '已完成'],
  );
  assert.equal(
    statusModule.interviewStatus({
      ...base,
      report: { summary: '', dimensions: [], followUps: [] },
    }),
    'needs-confirmation',
  );
});

void test('candidate dashboard and page navigation expose the approved workflow', async () => {
  const [dashboard, page] = await Promise.all([
    readFile(
      new URL(
        '../components/interview/candidate-dashboard.tsx',
        import.meta.url,
      ),
      'utf8',
    ).catch(() => ''),
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(dashboard, /候选人看板/);
  assert.match(dashboard, /全部候选人/);
  assert.match(dashboard, /待评估/);
  assert.match(dashboard, /待确认/);
  assert.match(dashboard, /已完成/);
  assert.match(dashboard, /搜索候选人/);
  assert.match(dashboard, /岗位/);
  assert.match(dashboard, /状态/);
  assert.match(dashboard, /分组/);
  assert.match(dashboard, /时间/);
  assert.match(dashboard, /最近面试/);
  assert.match(dashboard, /新的面试/);
  assert.match(page, /useState<'dashboard' \| 'workbench'>\('dashboard'\)/);
  assert.match(page, /<CandidateDashboard/);
  assert.match(page, /候选人看板/);
  assert.match(page, /面试工作台/);
});

void test('sidebar and current interview share visible derived status', async () => {
  const [sidebar, summary, page] = await Promise.all([
    readFile(
      new URL('../components/interview/interview-sidebar.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL(
        '../components/interview/interview-session-summary.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(sidebar, /interview-sidebar-status-filter/);
  assert.match(sidebar, /interview-status-badge/);
  assert.match(sidebar, /interviewStatus\(session\)/);
  assert.match(summary, /status: InterviewStatus/);
  assert.match(summary, /interview-status-badge/);
  assert.match(page, /status=\{interviewStatus\(/);
});
