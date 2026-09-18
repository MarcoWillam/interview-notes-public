import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

void test('current UI cannot create a written-test supplement and keeps historical rendering', async () => {
  const [page, reading] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../components/interview/resume-reading-view.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);
  assert.doesNotMatch(
    page,
    /runWrittenTestSupplement|pendingWrittenTestSupplement/,
  );
  assert.doesNotMatch(reading, /一键补充笔试复盘题|需要补充笔试复盘/);
  assert.match(reading, /WrittenTestSupplementView/);
  assert.match(reading, /'written-test': '笔试复盘'/);
});

void test('a stale writtenTestJobId does not block unrelated preparation actions', async () => {
  const page = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const eligibility = page.slice(
    page.indexOf('const outlineRegenerationEligible'),
    page.indexOf('// Imports and queue responses'),
  );
  assert.doesNotMatch(eligibility, /preparationJobIds:[\s\S]*writtenTestJobId/);
  assert.doesNotMatch(eligibility, /followUpBusy[\s\S]*writtenTestJobId/);
  assert.match(page, /if \(\s*!library\.ready \|\|\s*!writtenTestJobId/);
});
