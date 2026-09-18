import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('workbench keeps the private interviewer review in record state and conclusion flow', async () => {
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(
    page,
    /const \[interviewerReview, setInterviewerReview\][\s\S]{0,80}useState/,
  );
  assert.match(page, /\n\s+interviewerReview,\n/);
  assert.match(page, /setInterviewerReview\(saved\.interviewerReview \|\| null\)/);
  assert.match(
    page,
    /<InterviewerReviewView\s+value=\{interviewerReview\}/,
  );
  assert.match(page, /setInterviewerReview\(data\.interviewerReview \?\? null\)/);
});

void test('interviewer review surface prioritizes actions and keeps evidence details collapsed', async () => {
  const [component, css] = await Promise.all([
    readFile(
      new URL(
        '../components/interview/interviewer-review-view.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  ]);
  assert.match(component, /我的面试复盘/);
  assert.match(component, /岗位覆盖/);
  assert.match(component, /经历深挖/);
  assert.match(component, /问题表达/);
  assert.match(component, /证据核实/);
  assert.match(component, /表现较好/);
  assert.match(component, /可以改进/);
  assert.match(component, /优先改进/);
  assert.match(component, /优先改进建议/);
  assert.match(component, /<details/);
  assert.match(component, /原问题与改写/);
  assert.match(component, /遗漏的追问机会/);
  assert.match(component, /面试官：/);
  assert.match(component, /候选人：/);
  assert.match(css, /\.interviewer-review\s*\{/);
  assert.match(css, /\.interviewer-review-dimensions\s*\{/);
  assert.match(css, /@media \(max-width: 760px\)/);
});
