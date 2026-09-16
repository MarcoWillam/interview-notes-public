import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

void test('new interview offers distinct initial and second-round entry points', async () => {
  const page = await readFile(new URL('app/page.tsx', root), 'utf8');
  assert.match(page, /新建初试/);
  assert.match(page, /新建复试/);
  assert.match(page, /SecondRoundCreateDialog/);
});

void test('new interview actions share one consistent button layout', async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL('app/page.tsx', root), 'utf8'),
    readFile(new URL('app/globals.css', root), 'utf8'),
  ]);
  assert.match(page, /className="new-interview-actions"/);
  assert.match(
    styles,
    /\.new-interview-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    styles,
    /\.new-interview-actions\s*>\s*button\s*\{[\s\S]*height:\s*42px[\s\S]*border-radius:\s*8px/,
  );
});

void test('second-round creation requires external resumes and accepts Bole exports', async () => {
  const dialog = await readFile(
    new URL('components/interview/second-round-create-dialog.tsx', root),
    'utf8',
  );
  assert.match(dialog, /accept="\.md,\.txt"/);
  assert.match(dialog, /accept="\.doc,\.docx,\.pdf"/);
  assert.match(dialog, /外部初试资料必须上传并成功解析候选人简历/);
  assert.match(dialog, /无需重复上传/);
  assert.match(dialog, /第 \{step\} \/ 3 步/);
});

void test('second-round workbench exposes preparation, transcript and independent report', async () => {
  const [page, styles, outline, comparison] = await Promise.all([
    readFile(new URL('app/page.tsx', root), 'utf8'),
    readFile(new URL('app/globals.css', root), 'utf8'),
    readFile(
      new URL('components/interview/second-round-outline-view.tsx', root),
      'utf8',
    ),
    readFile(
      new URL('components/interview/second-round-comparison-view.tsx', root),
      'utf8',
    ),
  ]);
  assert.match(page, /复试准备/);
  assert.match(page, /复试记录/);
  assert.match(page, /独立复试结论/);
  assert.match(page, /重新导入初试资料/);
  assert.match(page, /重新上传候选人简历/);
  assert.match(page, /!secondRoundOutline/);
  assert.match(page, /second-round-preparation-body/);
  assert.match(page, /second-round-material-grid/);
  assert.match(page, /second-round-preparation-actions/);
  assert.match(
    styles,
    /\.second-round-preparation-body\s*\{[\s\S]*min-height:\s*0/,
  );
  assert.match(
    styles,
    /\.second-round-material-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    styles,
    /\.second-round-preparation-body\s*\{[\s\S]*padding-top:\s*12px/,
  );
  assert.match(styles, /@media \(max-width:\s*760px\)/);
  assert.match(
    outline,
    /className="interview-guide outline-v2 second-round-outline"/,
  );
  assert.match(outline, /className="outline-v2-heading"/);
  assert.match(
    outline,
    /className="interview-question-card outline-v2-question second-round-question"/,
  );
  assert.match(outline, /className="outline-v2-section second-round-reserve"/);
  assert.match(outline, /复试追问/);
  assert.match(outline, /depthAngleLabels/);
  assert.match(outline, /value\.version === 2/);
  assert.match(outline, /className="second-round-context"/);
  assert.match(outline, /提问背景/);
  assert.match(outline, /className="second-round-goal-highlight"/);
  assert.match(outline, /重点验证/);
  assert.match(outline, /className="second-round-resume-source"/);
  assert.match(outline, /简历中未明确具体项目/);
  assert.match(outline, /主维度/);
  assert.match(outline, /辅助/);
  assert.match(outline, /验证目标、初复试差异、依据与追问/);
  assert.match(outline, /候选题/);
  assert.match(
    styles,
    /\.second-round-context\s*\{[\s\S]*-webkit-line-clamp:\s*2/,
  );
  assert.match(styles, /\.second-round-goal-highlight\s*\{[\s\S]*background:/);
  assert.match(styles, /\.second-round-resume-source\s*\{/);
  assert.match(comparison, /引用仅来自本轮复试对话/);
});

void test('second-round tasks submit independent snapshots and recover into their originating record', async () => {
  const [page, taskCenter] = await Promise.all([
    readFile(new URL('app/page.tsx', root), 'utf8'),
    readFile(new URL('components/interview/task-center.tsx', root), 'utf8'),
  ]);
  const outlineHandler = page.slice(
    page.indexOf('async function runSecondRoundOutline'),
    page.indexOf('async function analyzeSecondRound'),
  );
  const assessmentHandler = page.slice(
    page.indexOf('async function analyzeSecondRound'),
    page.indexOf('async function analyze()'),
  );
  for (const handler of [outlineHandler, assessmentHandler]) {
    assert.doesNotMatch(handler, /flushForTask/);
    assert.doesNotMatch(handler, /interviewId|interviewRevision|recordBinding/);
    assert.match(handler, /secondRoundTaskSourceHash/);
    assert.match(handler, /library\.flush\(/);
  }
  assert.match(page, /secondRoundOutlineSourceHash/);
  assert.match(page, /secondRoundAssessmentSourceHash/);
  assert.match(page, /recoverSecondRoundTaskResult/);
  assert.match(page, /secondRoundOutlineJobId \|\| busyRef\.current/);
  assert.match(page, /!!busy \|\| !!secondRoundOutlineJobId/);
  assert.match(taskCenter, /独立复试任务/);
});

void test('navigation surfaces initial and second-round badges', async () => {
  const [sidebar, dashboard, summary] = await Promise.all([
    readFile(
      new URL('components/interview/interview-sidebar.tsx', root),
      'utf8',
    ),
    readFile(
      new URL('components/interview/candidate-dashboard.tsx', root),
      'utf8',
    ),
    readFile(
      new URL('components/interview/interview-session-summary.tsx', root),
      'utf8',
    ),
  ]);
  for (const source of [sidebar, dashboard, summary]) {
    assert.match(source, /复试/);
    assert.match(source, /初试/);
  }
});
