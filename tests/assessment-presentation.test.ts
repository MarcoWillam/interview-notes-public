import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

void test('workbench and task center share competency grouping for results and downloads', async () => {
  const [page, taskCenter, css] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../components/interview/task-center.tsx', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  ]);
  assert.match(
    page,
    /groupAssessmentDimensions\(\s*role,\s*report\.dimensions,?\s*\)/,
  );
  assert.match(
    taskCenter,
    /groupAssessmentDimensions\(job\.label, report\.dimensions\)/,
  );
  assert.match(taskCenter, /candidateReportFromAssessmentResult/);
  assert.doesNotMatch(
    taskCenter,
    /groupAssessmentDimensions\(job\.label, job\.report\.dimensions\)/,
  );
  assert.match(page, /assessment-group-heading/);
  assert.match(taskCenter, /assessment-group-heading/);
  assert.match(css, /\.assessment-group-heading\s*\{/);
});
