import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

void test('V2 outline separates required, reserve, archived and coverage views', async () => {
  const source = await readFile(
    new URL(
      '../components/interview/interview-outline-v2-view.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /必问题 ·.*requiredQuestions\.length/);
  assert.match(source, /候选题 ·/);
  assert.match(source, /能力覆盖/);
  assert.match(source, /此前候选题/);
  assert.match(source, /riskSignals/);
  assert.match(source, /probe\.condition/);
  assert.match(source, /预计.*分钟/);
  assert.match(source, /已覆盖/);
  assert.match(source, /覆盖偏弱/);
  assert.match(source, /未覆盖/);
});

void test('V2 outline keeps details collapsed and has responsive coverage styles', async () => {
  const [source, css, reading] = await Promise.all([
    readFile(
      new URL(
        '../components/interview/interview-outline-v2-view.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../components/interview/resume-reading-view.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);
  assert.match(source, /<details/);
  assert.doesNotMatch(source, /<details[^>]*\sopen/);
  assert.match(css, /\.outline-v2-coverage-list/);
  assert.match(css, /grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(reading, /<InterviewOutlineV2View outline=\{value\.outline\}/);
  assert.match(reading, /更新候选题/);
});

void test('V2 supplement confirmations describe reserve replacement and history', async () => {
  const source = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /替换当前候选区并归档此前候选题/);
  assert.match(source, /5 道必问题保持不变/);
});

void test('structured outline surface renders V2 and V3 counts from the result', async () => {
  const [source, reading] = await Promise.all([
    readFile(
      new URL(
        '../components/interview/interview-outline-v2-view.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../components/interview/resume-reading-view.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);
  assert.match(source, /outline\.requiredQuestions\.length/);
  assert.match(source, /outline\.reserveQuestions\.length/);
  assert.match(reading, /value\.outline/);
  assert.doesNotMatch(reading, /value\.outline\?\.version === 2 &&/);
});
