import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInput } from '../lib/interview.ts';
void test('empty role and transcript cannot be assessed', () => {
  assert.throws(() =>
    validateInput({
      role: '',
      requirements: '',
      transcript: '',
      dimensions: [],
    }),
  );
});

import { validateReport } from '../lib/interview.ts';
const input = {
  role: '产品经理',
  requirements: '独立推进项目',
  transcript: '候选人：我负责用户调研，每周访谈五位用户。',
  dimensions: ['专业能力'],
};
void test('assessment rejects an invented quotation instead of presenting it as evidence', () => {
  assert.throws(() =>
    validateReport(
      {
        summary: '有调研经验',
        dimensions: [
          {
            name: '专业能力',
            score: 4,
            assessment: '经验丰富',
            evidence: ['我带领五十人的团队'],
          },
        ],
        followUps: [],
      },
      input,
    ),
  );
});
void test('unobserved abilities remain unscored', () => {
  const report = {
    summary: '仍需核实',
    dimensions: [
      {
        name: '专业能力',
        score: null,
        assessment: '缺乏项目证据',
        evidence: [],
      },
    ],
    followUps: ['请描述一个项目'],
  };
  assert.equal(validateReport(report, input).dimensions[0].score, null);
  assert.throws(() =>
    validateReport(
      { ...report, dimensions: [{ ...report.dimensions[0], score: 1 }] },
      input,
    ),
  );
});
void test('valid quotations and bounded ratings are accepted', () => {
  const report = {
    summary: '有用户调研实践',
    dimensions: [
      {
        name: '专业能力',
        score: 3,
        assessment: '有调研实践，尚无结果证据',
        evidence: ['我负责用户调研，每周访谈五位用户。'],
      },
    ],
    followUps: [],
  };
  assert.equal(validateReport(report, input).dimensions[0].score, 3);
  assert.throws(() =>
    validateReport(
      { ...report, dimensions: [{ ...report.dimensions[0], score: 6 }] },
      input,
    ),
  );
});
void test('unknown or duplicate dimensions and oversized transcripts are rejected', () => {
  assert.throws(() =>
    validateInput({ ...input, dimensions: ['专业能力', '专业能力'] }),
  );
  assert.throws(() =>
    validateInput({ ...input, transcript: 'a'.repeat(80001) }),
  );
  assert.throws(() =>
    validateReport(
      {
        summary: 'x',
        dimensions: [
          { name: '陌生维度', score: null, assessment: '无', evidence: [] },
        ],
        followUps: [],
      },
      input,
    ),
  );
});

import { exportMarkdown } from '../lib/interview.ts';
void test('manual reports export honestly as drafts until the interviewer confirms', () => {
  const draft = exportMarkdown(
    '李明',
    input,
    null,
    '需要补充项目结果证据',
    false,
  );
  assert.ok(draft.includes('草稿 · 未确认'));
  assert.ok(draft.includes('AI 评估：未生成。'));
  assert.ok(draft.includes(input.transcript));
  const final = exportMarkdown('李明', input, null, '安排下一轮核实项目', true);
  assert.ok(final.includes('面试官已确认'));
});
void test('resume and interview preferences are included in validated analysis input and export', () => {
  const full = {
    ...input,
    resumeText: '自述管理过项目',
    focus: '重点核实项目规模',
    scoringGuidance: '3 分需独立完成项目',
    reportRequirements: '摘要不超过三句话',
  };
  assert.deepEqual(validateInput(full), full);
  const exported = exportMarkdown('测试', full, null, '', false);
  assert.ok(exported.includes(full.scoringGuidance));
  assert.ok(exported.includes(full.reportRequirements));
  assert.throws(() =>
    validateInput({ ...full, scoringGuidance: 'x'.repeat(4001) }),
  );
  assert.throws(() =>
    validateInput({ ...full, reportRequirements: 'x'.repeat(4001) }),
  );
  assert.ok(
    exportMarkdown('测试', full, null, '', false).includes('重点核实项目规模'),
  );
  assert.throws(() =>
    validateInput({ ...full, resumeText: 'x'.repeat(30001) }),
  );
  assert.throws(() =>
    validateReport(
      {
        summary: 'x',
        dimensions: [
          {
            name: '专业能力',
            score: 5,
            assessment: 'x',
            evidence: ['自述管理过项目'],
          },
        ],
        followUps: [],
      },
      full,
    ),
  );
});
