import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateResumeInput,
  validateResumeReading,
  exportResumeReading,
  resumeSchema,
} from '../lib/resume-reading.ts';
const input = {
  resumeText: '姓名：张晓明\n毕业于示例大学。曾负责用户访谈，访谈了五位用户。',
  role: '产品经理',
  requirements: '用户研究',
  dimensionText: '用户研究、问题解决，沟通协作\n主动推进,岗位匹配',
  focus: '重点核实主动发起的研究',
  scoringGuidance: '基于具体行动和结果评估',
  reportRequirements: '明确列出待核实事项',
};
const result = {
  summary: '有用户研究相关自述。',
  sections: [
    {
      name: '教育背景',
      items: [{ text: '示例大学', evidence: '毕业于示例大学。' }],
    },
    {
      name: '工作经历',
      items: [
        { text: '用户访谈经验', evidence: '曾负责用户访谈，访谈了五位用户。' },
      ],
    },
    { name: '项目经验', items: [] },
    { name: '技能', items: [] },
  ],
  followUps: ['请说明访谈后的决策。'],
};
void test('resume reading accepts bounded self-reported facts and literal resume references', () => {
  assert.deepEqual(validateResumeInput(input), input);
  assert.deepEqual(validateResumeReading(result, input), {
    ...result,
    candidateName: null,
    candidateNameEvidence: null,
  });
});

const structuredResult = {
  ...result,
  candidateName: '张晓明',
  candidateNameEvidence: '姓名：张晓明',
  interviewQuestions: [
    '请讲一次你主动发起用户研究的经历，为什么开始？',
    '请具体说明访谈中最困难的问题，你如何解决？',
    '请讲一次你与同事意见不一致的经历，你如何沟通？',
    '请讲一次没有人布置任务时你主动推进工作的经历。',
    '请说明一次访谈结果如何改变了产品决策。',
    '请讲一次你需要迅速学习新技能以完成工作的经历。',
  ].map((question, index) => ({
    question,
    dimensions: [
      ['用户研究'],
      ['问题解决'],
      ['沟通协作'],
      ['主动推进'],
      ['用户研究', '岗位匹配'],
      ['岗位匹配'],
    ][index],
    reason: index === 3 ? '核实自驱力与具体行为' : '核实岗位相关行动和结果',
    resumeEvidence: index === 0 ? '曾负责用户访谈，访谈了五位用户。' : null,
    listenFor: ['个人行动', '可核实的结果'],
    probes: ['你本人具体做了什么？'],
  })),
};

void test('complete standards and six grounded interview questions survive validation', () => {
  assert.deepEqual(validateResumeInput(input), input);
  assert.equal(
    new Set(structuredResult.interviewQuestions.map((q) => q.question)).size,
    6,
  );
  assert.deepEqual(
    validateResumeReading(structuredResult, input),
    structuredResult,
  );
});

void test('invalid or missing identity normalizes only identity and preserves the guide', () => {
  for (const identity of [
    { candidateName: null, candidateNameEvidence: null },
    { candidateName: undefined, candidateNameEvidence: undefined },
    { candidateName: '张晓明', candidateNameEvidence: undefined },
    { candidateName: null, candidateNameEvidence: '姓名：张晓明' },
    { candidateName: '', candidateNameEvidence: '姓名：张晓明' },
    { candidateName: '张'.repeat(81), candidateNameEvidence: '姓名：张晓明' },
    { candidateName: 123, candidateNameEvidence: '姓名：张晓明' },
    { candidateName: '李四', candidateNameEvidence: '姓名：张晓明' },
    { candidateName: '张晓明', candidateNameEvidence: '虚构姓名：张晓明' },
    { candidateName: '张晓明', candidateNameEvidence: '毕业于示例大学。' },
  ]) {
    assert.deepEqual(
      validateResumeReading({ ...structuredResult, ...identity }, input),
      {
        ...structuredResult,
        candidateName: null,
        candidateNameEvidence: null,
      },
    );
  }
});

void test('questions reject invented evidence and invalid dimensions or array bounds', () => {
  const first = structuredResult.interviewQuestions[0];
  for (const invalid of [
    { resumeEvidence: '带领过百人团队' },
    { resumeEvidence: undefined },
    { dimensions: ['未知维度'] },
    { dimensions: [] },
    { dimensions: ['用户研究', '问题解决', '沟通协作'] },
    { probes: [] },
    { probes: ['一', '二', '三'] },
    { listenFor: [] },
    { listenFor: ['一', '二', '三', '四'] },
    { question: ' ' },
    { reason: '' },
  ]) {
    assert.throws(
      () =>
        validateResumeReading(
          {
            ...structuredResult,
            interviewQuestions: [
              { ...first, ...invalid },
              ...structuredResult.interviewQuestions.slice(1),
            ],
          },
          input,
        ),
      JSON.stringify(invalid),
    );
  }
  for (const questions of [
    [...structuredResult.interviewQuestions, first],
    structuredResult.interviewQuestions.slice(0, 5),
    [],
    null,
  ]) {
    assert.throws(() =>
      validateResumeReading(
        { ...structuredResult, interviewQuestions: questions },
        input,
      ),
    );
  }
});

void test('input validates all standards bounds and dimension rules', () => {
  for (const invalid of [
    { focus: 'a'.repeat(8001) },
    { scoringGuidance: 'a'.repeat(4001) },
    { reportRequirements: 'a'.repeat(4001) },
    { dimensionText: 'a'.repeat(481) },
    { dimensionText: '' },
    { dimensionText: '用户研究、用户研究' },
    { focus: 7 },
  ])
    assert.throws(() => validateResumeInput({ ...input, ...invalid }));
});

for (const padding of ['', ' \n\t']) {
  void test(`questions reject duplicate stems with ${padding ? 'surrounding whitespace' : 'identical text'}`, () => {
    const questions = structuredResult.interviewQuestions.map(
      (question, index) =>
        index === 5
          ? {
              ...question,
              question:
                padding +
                structuredResult.interviewQuestions[0].question +
                padding,
            }
          : question,
    );
    assert.throws(
      () =>
        validateResumeReading(
          {
            ...structuredResult,
            interviewQuestions: questions,
          },
          input,
        ),
      /面试问题不能重复/,
    );
  });
}

void test('model schema requires identity and bounded structured questions', () => {
  assert.ok(resumeSchema.required.includes('candidateName'));
  assert.ok(resumeSchema.required.includes('candidateNameEvidence'));
  assert.ok(resumeSchema.required.includes('interviewQuestions'));
  const schema = resumeSchema;
  assert.deepEqual(schema.properties.candidateName.type, ['string', 'null']);
  assert.deepEqual(schema.properties.candidateNameEvidence.type, [
    'string',
    'null',
  ]);
  const questions = schema.properties.interviewQuestions;
  assert.equal(questions.minItems, 6);
  assert.equal(questions.maxItems, 6);
  assert.equal(questions.items.additionalProperties, false);
  assert.deepEqual(questions.items.required, [
    'question',
    'dimensions',
    'reason',
    'resumeEvidence',
    'listenFor',
    'probes',
  ]);
  for (const [field, min, max] of [
    ['dimensions', 1, 2],
    ['listenFor', 1, 3],
    ['probes', 1, 2],
  ] as const) {
    assert.equal(questions.items.properties[field].minItems, min);
    assert.equal(questions.items.properties[field].maxItems, max);
  }
});

void test('markdown exports numbered interview guide before remaining follow-ups', () => {
  const markdown = exportResumeReading(structuredResult);
  assert.ok(markdown.indexOf('## 面试提纲') >= 0);
  assert.ok(
    markdown.indexOf('## 面试提纲') < markdown.indexOf('## 其他建议追问'),
  );
  structuredResult.interviewQuestions.forEach((q, index) => {
    assert.ok(markdown.includes(`${index + 1}. ${q.question}`));
    for (const item of [...q.dimensions, ...q.listenFor, ...q.probes])
      assert.ok(markdown.includes(item));
  });
  assert.ok(markdown.includes('简历证据'));
  assert.ok(markdown.includes('曾负责用户访谈，访谈了五位用户。'));
  assert.ok(markdown.includes('观察点'));
  const legacy = exportResumeReading(result);
  assert.ok(legacy.includes('## 建议追问\n- 请说明访谈后的决策。'));
  assert.ok(!legacy.includes('## 面试提纲'));
});

void test('markdown separates question paragraphs, evidence and follow-up lists', () => {
  const markdown = exportResumeReading(structuredResult);
  assert.ok(
    markdown.includes(
      [
        `### 1. ${structuredResult.interviewQuestions[0].question}`,
        '',
        '维度：用户研究',
        '',
        '提问理由：核实岗位相关行动和结果',
        '',
        '简历证据：',
        '',
        '> 曾负责用户访谈，访谈了五位用户。',
        '',
        '观察点：',
        '',
        '- 个人行动',
        '- 可核实的结果',
        '',
        '追问：',
        '',
        '- 你本人具体做了什么？',
        '',
        `### 2. ${structuredResult.interviewQuestions[1].question}`,
      ].join('\n'),
    ),
  );
  assert.ok(
    markdown.includes('简历证据：\n\n简历未提供明确依据。\n\n观察点：'),
  );
});
void test('reading rejects invented references and missing categories', () => {
  assert.throws(() =>
    validateResumeReading(
      {
        ...result,
        sections: [
          {
            name: '教育背景',
            items: [{ text: '虚构', evidence: '不存在的证据' }],
          },
          ...result.sections.slice(1),
        ],
      },
      input,
    ),
  );
  assert.throws(() =>
    validateResumeReading({ ...result, sections: [] }, input),
  );
});
void test('reading needs resume text but does not require interview transcript or role', () => {
  assert.equal(validateResumeInput({ resumeText: input.resumeText }).role, '');
  assert.throws(() => validateResumeInput({ resumeText: '' }));
  assert.throws(() => validateResumeInput({ resumeText: 'a'.repeat(30001) }));
});
