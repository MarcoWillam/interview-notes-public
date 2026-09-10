import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

void test('AI PM outline preflight offers a local ZIP or no-artifact fallback', async () => {
  const [page, picker] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../components/interview/work-sample-picker.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);
  assert.match(page, /listRemoteArtifacts/);
  assert.match(page, /<WorkSamplePicker/);
  assert.match(page, /pendingResumeOutline\.writtenTest === true/);
  assert.match(picker, /暂不提供作品/);
  assert.match(picker, /artifact\.deviceName/);
  assert.match(picker, /artifact\.available/);
  assert.match(picker, /artifact\.bytes/);
  assert.match(picker, /artifact\.modifiedAt/);
});

void test('locked AI PM outline offers one later submission and renders a collapsed evidence view', async () => {
  const [page, reading, view] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../components/interview/resume-reading-view.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL('../components/interview/work-sample-view.tsx', import.meta.url),
      'utf8',
    ),
  ]);
  assert.match(page, /canSubmitWorkSample/);
  assert.match(page, /submitRemoteWorkSample/);
  assert.match(page, /原提纲保留，追加三题/);
  assert.match(reading, /补交笔试作品/);
  assert.match(reading, /<WorkSampleView/);
  assert.match(view, /作品表现/);
  assert.match(view, /查看维度依据与读取范围/);
  assert.match(view, /<details/);
});

void test('work sample success synchronizes the compact interview status', async () => {
  const [summary, preparation] = await Promise.all([
    readFile(
      new URL(
        '../components/interview/interview-session-summary.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../components/interview/interview-preparation.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);
  assert.match(summary, /作品已分析/);
  assert.match(preparation, /作品已分析/);
});
