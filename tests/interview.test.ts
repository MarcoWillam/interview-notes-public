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
const workSample = {
  artifact: {
    id: 'artifact-12345678',
    name: 'ai-pm-work.zip',
    sha256: 'a'.repeat(64),
    bytes: 4096,
    modifiedAt: 1,
  },
  coverage: {
    analyzed: ['README.md'],
    excluded: [],
    unsupported: [],
    truncated: false,
  },
  summary: '作品提出先访谈种子用户，再验证核心假设。',
  dimensions: [
    {
      name: '专业能力',
      score: 3,
      assessment: '提出了基本的用户验证路径。',
      evidence: [{ path: 'README.md', excerpt: '访谈五位种子用户' }],
    },
  ],
  strengths: ['先验证用户问题'],
  risks: ['缺少结果数据'],
  questions: Array.from({ length: 3 }, (_, index) => ({
    question: `请说明作品中的验证步骤 ${index + 1} 由谁完成。`,
    questionSource: 'work-sample' as const,
    dimensions: ['专业能力'],
    reason: '核实作品归属和实施过程。',
    resumeEvidence: null,
    workSampleEvidence: {
      path: 'README.md',
      excerpt: '访谈五位种子用户',
    },
    listenFor: ['候选人的具体行动'],
    probes: ['结果如何验证？'],
  })),
};
const groundedReport = {
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

void test('structured work samples are accepted without device ids or source contents', () => {
  const normalized = validateInput({ ...input, workSample });
  assert.deepEqual(normalized.workSample, workSample);
  assert.equal('deviceId' in normalized.workSample!.artifact, false);
  assert.throws(() =>
    validateInput({
      ...input,
      workSample: {
        ...workSample,
        coverage: { ...workSample.coverage, analyzed: ['/Users/me/secret.md'] },
      },
    }),
  );
});

void test('work-sample observations are verified only against interview transcript', () => {
  const withWork = validateInput({ ...input, workSample });
  const reviewed = {
    ...groundedReport,
    workSampleReview: [
      {
        observation: '候选人说明自己完成了用户访谈。',
        status: 'supported',
        transcriptEvidence: ['我负责用户调研，每周访谈五位用户。'],
      },
      {
        observation: '作品缺少结果数据。',
        status: 'unverified',
        transcriptEvidence: [],
      },
    ],
  } as const;
  assert.deepEqual(validateReport(reviewed, withWork).workSampleReview, reviewed.workSampleReview);
  assert.throws(() =>
    validateReport(
      {
        ...reviewed,
        workSampleReview: [
          {
            observation: '候选人说明自己完成了用户访谈。',
            status: 'supported',
            transcriptEvidence: ['不存在的逐字引用'],
          },
        ],
      },
      withWork,
    ),
  );
  assert.throws(() => validateReport(groundedReport, withWork));
});

void test('candidate scores stay transcript-grounded when a work sample is present', () => {
  const withWork = validateInput({ ...input, workSample });
  assert.throws(() =>
    validateReport(
      {
        ...groundedReport,
        dimensions: [
          {
            ...groundedReport.dimensions[0],
            score: 4,
            evidence: ['访谈五位种子用户'],
          },
        ],
        workSampleReview: [
          {
            observation: '作品呈现用户访谈计划。',
            status: 'unverified',
            transcriptEvidence: [],
          },
        ],
      },
      withWork,
    ),
  );
});

void test('Markdown separates work observations from candidate dimension ratings', () => {
  const withWork = validateInput({ ...input, workSample });
  const reviewed = validateReport(
    {
      ...groundedReport,
      workSampleReview: [
        {
          observation: '候选人说明自己完成了用户访谈。',
          status: 'supported',
          transcriptEvidence: ['我负责用户调研，每周访谈五位用户。'],
        },
      ],
    },
    withWork,
  );
  const markdown = exportMarkdown('张三', withWork, reviewed, '', false);
  assert.ok(markdown.includes('## 作品表现（归属与过程待核实）'));
  assert.ok(markdown.includes('面试中已验证'));
  assert.ok(markdown.indexOf('作品表现（归属与过程待核实）') < markdown.indexOf('### 专业能力'));
});
