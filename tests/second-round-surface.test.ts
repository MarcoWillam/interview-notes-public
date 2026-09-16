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
  const [page, outline, comparison] = await Promise.all([
    readFile(new URL('app/page.tsx', root), 'utf8'),
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
  assert.match(outline, /复试提纲 · 45–60 分钟/);
  assert.match(outline, /候选题/);
  assert.match(comparison, /引用仅来自本轮复试对话/);
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
