import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import {
  validateResumeInput,
  validateResumeReading,
  exportResumeReading,
  resumeSchema,
  type ResumeReading,
} from '../lib/resume-reading.ts';
import {
  calculateOutlineCoverage,
  type InterviewOutlineV2,
  type InterviewQuestionV2,
} from '../lib/interview-outline-v2.ts';
import {
  BUILTIN_TEMPLATE_IDS,
  builtInRoleTemplates,
} from '../lib/default-role-templates.ts';
const input = {
  resumeText: '姓名：张晓明\n毕业于示例大学。曾负责用户访谈，访谈了五位用户。',
  role: '产品经理',
  requirements: '用户研究',
  dimensionText: '用户研究、问题解决，沟通协作\n主动推进,岗位匹配',
  focus: '重点核实主动发起的研究',
  scoringGuidance: '基于具体行动和结果评估',
  reportRequirements: '明确列出待核实事项',
  hasWrittenTest: false,
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
  assert.deepEqual(validateResumeInput(input), { ...input, outlineVersion: 1 });
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
    questionSource: index === 0 ? ('resume' as const) : ('role' as const),
    listenFor: ['个人行动', '可核实的结果'],
    probes:
      index === 0
        ? ['你本人具体做了什么？', '这个结果如何验证？']
        : ['你本人具体做了什么？'],
  })),
};
const supplementQuestions = Array.from({ length: 3 }, (_, index) => ({
  question: `请复述笔试方案中的第 ${index + 1} 个关键判断与取舍。`,
  questionSource: 'written-test' as const,
  dimensions: [index % 2 === 0 ? '用户研究' : '问题解决'],
  reason: '核实候选人自己的判断。',
  resumeEvidence: null,
  listenFor: ['判断依据'],
  probes: ['如果假设不成立，你会如何调整？'],
}));

const workSampleReference = {
  id: 'artifact-12345678',
  deviceId: 'device-12345678',
  name: 'ai-pm-work.zip',
  sha256: 'b'.repeat(64),
  bytes: 2048,
  modifiedAt: 2,
};

function v2Input() {
  const template = builtInRoleTemplates.find(
    ({ id }) => id === BUILTIN_TEMPLATE_IDS.aiProductManager,
  )!;
  return {
    role: template.role,
    requirements: template.requirements,
    dimensionText: template.dimensionText,
    focus: template.focus,
    scoringGuidance: template.scoringGuidance,
    reportRequirements: template.reportRequirements,
    resumeText: input.resumeText,
    hasWrittenTest: false,
    outlineVersion: 2 as const,
  };
}

function v2Outline(): InterviewOutlineV2 {
  const dimensionNames = v2Input().dimensionText.split('、');
  const texts = [
    '讲讲你主动推动问题落地的经历',
    '你怎样识别用户的真实问题',
    '你如何决定产品范围取舍',
    '你如何判断任务是否适合使用AI',
    '你怎样验证方案是否真正有效',
    '你快速掌握新领域的方法是什么',
    '最困难的一次项目挑战是什么',
    '你如何推动团队形成一致决定',
  ];
  const order = [4, 0, 1, 2, 3, 5, 6, 7];
  const questions: InterviewQuestionV2[] = texts.map((question, index) => ({
    id: `v2-question-${index + 1}`,
    question,
    required: index < 5,
    estimatedMinutes: index < 5 ? 6 : 4,
    primaryDimension: dimensionNames[order[index]],
    secondaryDimensions: [],
    source: index === 1 ? 'resume' : 'role',
    goal: '核实具体行动和结果',
    resumeEvidence: index === 1 ? '曾负责用户访谈，访谈了五位用户。' : null,
    workSampleEvidence: null,
    listenFor: ['个人行动'],
    riskSignals: ['只描述团队成果'],
    probes: [{ condition: '行动不清楚', question: '你具体做了什么？' }],
  }));
  const requiredQuestions = questions.slice(0, 5);
  const reserveQuestions = questions.slice(5);
  return {
    version: 2,
    estimatedMinutes: 30,
    requiredQuestions,
    reserveQuestions,
    archivedReserveQuestions: [],
    coverage: calculateOutlineCoverage(questions, dimensionNames),
  };
}

function withV2Sources(
  outline: InterviewOutlineV2,
  source: 'written-test' | 'work-sample',
): InterviewOutlineV2 {
  return {
    ...outline,
    requiredQuestions: outline.requiredQuestions.map((question, index) =>
      index >= 1 && index <= 3
        ? {
            ...question,
            source,
            resumeEvidence: null,
            workSampleEvidence:
              source === 'work-sample'
                ? { path: `src/answer-${index}.ts`, excerpt: '关键方案实现' }
                : null,
          }
        : question,
    ),
  };
}

void test('complete standards and six grounded interview questions survive validation', () => {
  assert.deepEqual(validateResumeInput(input), { ...input, outlineVersion: 1 });
  assert.equal(
    new Set(structuredResult.interviewQuestions.map((q) => q.question)).size,
    6,
  );
  assert.deepEqual(
    validateResumeReading(structuredResult, input),
    structuredResult,
  );
});

void test('resume input defaults to V1 and accepts V2 only for untouched built-in product standards', () => {
  assert.equal(validateResumeInput(input).outlineVersion, 1);
  assert.equal(validateResumeInput(v2Input()).outlineVersion, 2);
  assert.throws(
    () => validateResumeInput({ ...v2Input(), outlineVersion: 3 }),
    /提纲版本/,
  );
  assert.throws(
    () =>
      validateResumeInput({
        ...v2Input(),
        requirements: v2Input().requirements + '临时修改',
      }),
    /内置岗位模板/,
  );
  const engineering = builtInRoleTemplates.find(
    ({ id }) => id === BUILTIN_TEMPLATE_IDS.aiEngineering,
  )!;
  assert.throws(
    () =>
      validateResumeInput({
        ...engineering,
        resumeText: input.resumeText,
        hasWrittenTest: false,
        outlineVersion: 2,
      }),
    /内置岗位模板/,
  );
});

void test('V2 resume reading requires a V2 outline and rejects V1 questions', () => {
  const value = {
    ...result,
    candidateName: '张晓明',
    candidateNameEvidence: '姓名：张晓明',
    outline: v2Outline(),
  };
  assert.deepEqual(validateResumeReading(value, v2Input()), value);
  assert.throws(
    () => validateResumeReading({ ...value, outline: undefined }, v2Input()),
    /V2 面试提纲/,
  );
  assert.throws(
    () =>
      validateResumeReading(
        { ...value, interviewQuestions: structuredResult.interviewQuestions },
        v2Input(),
      ),
    /V2 结果不能包含旧版提纲/,
  );
  assert.throws(
    () =>
      validateResumeReading(
        { ...structuredResult, outline: v2Outline() },
        input,
      ),
    /旧版结果不能包含 V2 提纲/,
  );
});

void test('AI product V2 reserves required questions two through four for written-test review', () => {
  const writtenInput = { ...v2Input(), hasWrittenTest: true };
  const writtenOutline = withV2Sources(v2Outline(), 'written-test');
  const value = {
    ...result,
    candidateName: '张晓明',
    candidateNameEvidence: '姓名：张晓明',
    outline: writtenOutline,
  };
  assert.deepEqual(validateResumeReading(value, writtenInput), value);
  assert.throws(
    () =>
      validateResumeReading({ ...value, outline: v2Outline() }, writtenInput),
    /第 2–4 题/,
  );
});

void test('product operations V2 never creates written-test or work-sample questions', () => {
  const template = builtInRoleTemplates.find(
    ({ id }) => id === BUILTIN_TEMPLATE_IDS.productOperations,
  )!;
  const operationsInput = {
    ...template,
    resumeText: input.resumeText,
    hasWrittenTest: true,
    outlineVersion: 2 as const,
  };
  const dimensions = template.dimensionText.split('、');
  const base = v2Outline();
  const questions = [...base.requiredQuestions, ...base.reserveQuestions].map(
    (question, index) => ({
      ...question,
      primaryDimension: dimensions[[4, 0, 1, 2, 3, 5, 6, 7][index]],
      secondaryDimensions: [],
      source: 'role' as const,
      resumeEvidence: null,
    }),
  );
  const outline: InterviewOutlineV2 = {
    ...base,
    requiredQuestions: questions.slice(0, 5),
    reserveQuestions: questions.slice(5),
    coverage: calculateOutlineCoverage(questions, dimensions),
  };
  const value = { ...result, outline };
  assert.deepEqual(
    validateResumeReading(value, operationsInput).outline,
    outline,
  );
  assert.throws(
    () =>
      validateResumeReading(
        { ...value, outline: withV2Sources(outline, 'written-test') },
        operationsInput,
      ),
    /产品运营.*笔试|笔试.*产品运营/,
  );
});

void test('AI product V2 uses work-sample questions in positions two through four when a work exists', () => {
  const workInput = {
    ...v2Input(),
    hasWrittenTest: true,
    workSample: workSampleReference,
  };
  const outline = withV2Sources(v2Outline(), 'work-sample');
  const value = { ...result, outline };
  assert.deepEqual(validateResumeReading(value, workInput).outline, outline);
  assert.throws(
    () => validateResumeReading({ ...value, outline: v2Outline() }, workInput),
    /第 2–4 题/,
  );
});

void test('written-test guides require review questions in positions two through four', () => {
  const writtenInput = { ...input, hasWrittenTest: true };
  const writtenGuide = {
    ...structuredResult,
    interviewQuestions: structuredResult.interviewQuestions.map(
      (question, index) => ({
        ...question,
        questionSource:
          index >= 1 && index <= 3
            ? ('written-test' as const)
            : question.questionSource,
        resumeEvidence:
          index >= 1 && index <= 3 ? null : question.resumeEvidence,
      }),
    ),
  };
  assert.deepEqual(
    validateResumeReading(writtenGuide, writtenInput),
    writtenGuide,
  );
  assert.throws(() => validateResumeReading(structuredResult, writtenInput));
  assert.throws(() => validateResumeReading(writtenGuide, input));
});

void test('an attached work sample grounds questions two through four', () => {
  const workInput = {
    ...input,
    hasWrittenTest: true,
    workSample: workSampleReference,
  };
  const workEvidence = {
    path: 'docs/brief.md',
    excerpt: '目标用户是运营人员',
  };
  const workGuide = {
    ...structuredResult,
    interviewQuestions: structuredResult.interviewQuestions.map(
      (question, index) => ({
        ...question,
        questionSource:
          index >= 1 && index <= 3
            ? ('work-sample' as const)
            : question.questionSource,
        resumeEvidence:
          index >= 1 && index <= 3 ? null : question.resumeEvidence,
        workSampleEvidence: index >= 1 && index <= 3 ? workEvidence : undefined,
      }),
    ),
  };
  assert.deepEqual(validateResumeInput(workInput), {
    ...workInput,
    outlineVersion: 1,
  });
  const validated = validateResumeReading(workGuide, workInput);
  assert.equal(validated.interviewQuestions?.[1].questionSource, 'work-sample');
  assert.throws(() => validateResumeReading(structuredResult, workInput));
});

void test('regular guides reject written-test wording', () => {
  assert.throws(() =>
    validateResumeReading(
      {
        ...structuredResult,
        interviewQuestions: structuredResult.interviewQuestions.map(
          (question, index) =>
            index === 0
              ? { ...question, question: '请复盘这次笔试。' }
              : question,
        ),
      },
      input,
    ),
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
    { questionSource: 'unknown' },
    { questionSource: undefined },
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
    'questionSource',
    'dimensions',
    'reason',
    'resumeEvidence',
    'workSampleEvidence',
    'listenFor',
    'probes',
  ]);
  assert.deepEqual(questions.items.properties.questionSource.enum, [
    'resume',
    'written-test',
    'work-sample',
    'role',
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

void test('markdown exports exactly six complete numbered questions before other follow-ups', () => {
  const markdown = exportResumeReading(structuredResult);
  const guideStart = markdown.indexOf('## 面试提纲');
  const followUpsStart = markdown.indexOf('## 其他建议追问');
  assert.ok(guideStart >= 0 && followUpsStart > guideStart);
  assert.ok(markdown.includes('## 面试提纲 · 常规'));
  const guide = markdown.slice(guideStart, followUpsStart);
  const headings = [...markdown.matchAll(/^### (\d+)\. (.+)$/gm)];
  assert.deepEqual(
    headings.map((heading) => [Number(heading[1]), heading[2]]),
    structuredResult.interviewQuestions.map((q, index) => [
      index + 1,
      q.question,
    ]),
  );
  const blocks = guide.split(/^### \d+\. .+$/m).slice(1);
  assert.equal(blocks.length, 6);
  blocks.forEach((block, index) => {
    const q = structuredResult.interviewQuestions[index];
    assert.ok(block.includes(`维度：${q.dimensions.join('、')}`));
    assert.ok(
      block.includes(
        `来源：${q.questionSource === 'resume' ? '简历经历' : '岗位通用'}`,
      ),
    );
    assert.ok(block.includes(`提问理由：${q.reason}`));
    const evidence = block.split('简历证据：\n\n')[1]?.split('\n\n观察点：')[0];
    assert.equal(
      evidence,
      q.resumeEvidence === null
        ? '简历未提供明确依据。'
        : '> ' + q.resumeEvidence.replaceAll('\n', '\n> '),
    );
    const observation = block.split('观察点：\n\n')[1]?.split('\n\n追问：')[0];
    assert.equal(
      observation,
      q.listenFor.map((item) => '- ' + item).join('\n'),
    );
    const probes = block.split('追问：\n\n')[1]?.trim().split('\n');
    assert.ok(probes && probes.length >= 1 && probes.length <= 2);
    assert.deepEqual(
      probes,
      q.probes.map((probe) => '- ' + probe),
    );
  });
  assert.equal(
    markdown.slice(followUpsStart),
    '## 其他建议追问\n' +
      structuredResult.followUps.map((q) => '- ' + q).join('\n'),
  );
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
        '来源：简历经历',
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
        '- 这个结果如何验证？',
        '',
        `### 2. ${structuredResult.interviewQuestions[1].question}`,
      ].join('\n'),
    ),
  );
  assert.ok(
    markdown.includes('简历证据：\n\n简历未提供明确依据。\n\n观察点：'),
  );
});
void test('V2 markdown exports required, reserve, coverage and archived questions in order', () => {
  const outline = v2Outline();
  const archived = {
    ...outline.reserveQuestions[0],
    id: 'archived-question-1',
    question: '你会如何验证另一个关键假设',
  };
  const markdown = exportResumeReading({
    ...result,
    outline: { ...outline, archivedReserveQuestions: [archived] },
  });
  const resumeSection = markdown.indexOf('## 教育背景');
  const requiredSection = markdown.indexOf('## 五道必问题');
  const reserveSection = markdown.indexOf('## 候选题');
  const coverageSection = markdown.indexOf('## 能力覆盖');
  const archivedSection = markdown.indexOf('## 归档候选题');
  const followUpsSection = markdown.indexOf('## 其他待核实项');
  assert.ok(
    resumeSection < requiredSection &&
      requiredSection < reserveSection &&
      reserveSection < coverageSection &&
      coverageSection < archivedSection &&
      archivedSection < followUpsSection,
  );
  const first = outline.requiredQuestions[0];
  assert.ok(markdown.includes(`### 1. ${first.question}`));
  assert.ok(markdown.includes(`预计用时：${first.estimatedMinutes} 分钟`));
  assert.ok(markdown.includes(`主评估维度：${first.primaryDimension}`));
  assert.ok(markdown.includes('辅助评估维度：无'));
  assert.ok(markdown.includes('来源：岗位通用'));
  assert.ok(markdown.includes(`验证目标：${first.goal}`));
  assert.ok(markdown.includes(`- ${first.listenFor[0]}`));
  assert.ok(markdown.includes(`- ${first.riskSignals[0]}`));
  assert.ok(
    markdown.includes(
      `- 当${first.probes[0].condition}时：${first.probes[0].question}`,
    ),
  );
  assert.ok(markdown.includes(`### 1. ${archived.question}`));
});
void test('markdown appends three written-test questions after the original outline', () => {
  const markdown = exportResumeReading({
    ...structuredResult,
    writtenTestSupplement: supplementQuestions,
  });
  assert.ok(
    markdown.indexOf('## 面试提纲') < markdown.indexOf('## 笔试复盘补充'),
  );
  assert.deepEqual(
    [...markdown.matchAll(/^### (\d+)\. /gm)].map((match) => match[1]),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
  );
});
void test('supplemented regular guides remain valid after status changes to written test', () => {
  const supplemented = {
    ...structuredResult,
    writtenTestSupplement: supplementQuestions,
  };
  assert.deepEqual(
    validateResumeReading(supplemented, { ...input, hasWrittenTest: true }),
    supplemented,
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

// Node strips TypeScript but not JSX; compile the view in memory for real SSR assertions.
async function renderReading(
  value: ResumeReading,
  props: Record<string, unknown> = {},
) {
  const viewUrl = new URL(
    '../components/interview/resume-reading-view.tsx',
    import.meta.url,
  );
  const source = await readFile(viewUrl, 'utf8');
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      /from (["'])([^"']+)\1/g,
      (_match, quote: string, specifier: string) => {
        if (specifier === './work-sample-view') {
          const stub = 'export function WorkSampleView(){return null}';
          return `from ${quote}data:text/javascript;base64,${Buffer.from(stub).toString('base64')}${quote}`;
        }
        if (specifier === './interview-outline-v2-view') {
          const stub = 'export function InterviewOutlineV2View(){return null}';
          return `from ${quote}data:text/javascript;base64,${Buffer.from(stub).toString('base64')}${quote}`;
        }
        const resolved = specifier.startsWith('.')
          ? new URL(specifier + '.ts', viewUrl).href
          : import.meta.resolve(specifier);
        return `from ${quote}${resolved}${quote}`;
      },
    );
  const { ResumeReadingView } = await import(
    'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
  );
  return renderToStaticMarkup(
    createElement(ResumeReadingView, { value, ...props }),
  );
}

void test('reading view shows six core questions with evidence and native collapsed guidance', async () => {
  const html = await renderReading(structuredResult);
  assert.ok(html.includes('面试提纲 · 常规 · 30–40 分钟'));
  assert.ok(html.indexOf('面试提纲') < html.indexOf('简历阅读结果'));
  assert.match(
    html,
    /<details class="resume-reading-details"><summary>[\s\S]*简历阅读结果/,
  );
  assert.doesNotMatch(html, /<details class="resume-reading-details" open/);
  assert.ok(html.includes('2 条要点'));
  assert.ok(html.indexOf(result.summary) > html.indexOf('简历阅读结果'));
  const cards = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)];
  assert.equal(cards.length, 6);
  cards.forEach(([card], index) => {
    const q = structuredResult.interviewQuestions[index];
    const details = card.match(/<details>([\s\S]*?)<\/details>/)?.[1];
    assert.ok(
      details,
      'supporting guidance uses native details closed by default',
    );
    assert.ok(details.includes('<summary>提问理由、观察点与追问</summary>'));
    const visible = card.slice(0, card.indexOf('<details>'));
    assert.ok(visible.includes(`${index + 1}. ${q.question}`));
    for (const dimension of q.dimensions)
      assert.ok(visible.includes(dimension));
    assert.ok(
      visible.includes(q.questionSource === 'resume' ? '简历经历' : '岗位通用'),
    );
    if (q.resumeEvidence !== null)
      assert.ok(
        visible.includes(`<blockquote>${q.resumeEvidence}</blockquote>`),
      );
    for (const item of [q.reason, ...q.listenFor, ...q.probes])
      assert.ok(details.includes(item));
  });
  assert.ok(html.indexOf('其他建议追问') > html.lastIndexOf('</article>'));
  assert.ok(
    !html
      .slice(0, html.lastIndexOf('</article>'))
      .includes(result.followUps[0]),
  );
});

void test('reading view exposes one outline regeneration action and its consumed state', async () => {
  const available = await renderReading(structuredResult, {
    canRegenerate: true,
    regenerationBusy: false,
    onRegenerate: () => {},
  });
  assert.match(available, />重新生成提纲</);
  assert.doesNotMatch(available, /已重新生成/);

  const consumed = await renderReading(structuredResult, {
    canRegenerate: false,
    regenerationUsed: true,
  });
  assert.doesNotMatch(consumed, />重新生成提纲</);
  assert.match(consumed, /已重新生成/);
});

void test('written-test reading labels the guide and review questions explicitly', async () => {
  const value = {
    ...structuredResult,
    interviewQuestions: structuredResult.interviewQuestions.map(
      (question, index) => ({
        ...question,
        questionSource:
          index >= 1 && index <= 3
            ? ('written-test' as const)
            : question.questionSource,
        resumeEvidence:
          index >= 1 && index <= 3 ? null : question.resumeEvidence,
      }),
    ),
  };
  const html = await renderReading(value);
  assert.ok(html.includes('面试提纲 · 含笔试复盘 · 30–40 分钟'));
  assert.equal((html.match(/笔试复盘/g) || []).length, 4);
});

void test('reading view offers one supplement action then appends questions seven through nine', async () => {
  const action = await renderReading(structuredResult, {
    canSupplement: true,
    onSupplement() {},
  });
  assert.ok(action.includes('一键补充笔试复盘题'));
  const html = await renderReading({
    ...structuredResult,
    writtenTestSupplement: supplementQuestions,
  });
  assert.ok(html.indexOf('面试提纲') < html.indexOf('笔试复盘补充 · 3 道'));
  assert.ok(html.includes(`7. ${supplementQuestions[0].question}`));
  assert.ok(html.includes(`9. ${supplementQuestions[2].question}`));
  assert.equal((html.match(/<article\b/g) || []).length, 9);
  assert.ok(!html.includes('一键补充笔试复盘题'));
});

void test('legacy reading view renders facts and other follow-ups without a guide', async () => {
  const html = await renderReading(result);
  assert.ok(html.includes('简历阅读结果'));
  assert.match(html, /<details class="resume-reading-details">/);
  assert.doesNotMatch(html, /<details class="resume-reading-details" open/);
  assert.ok(html.includes(result.summary));
  assert.ok(html.includes('建议追问'));
  assert.ok(html.includes(result.followUps[0]));
  assert.ok(!html.includes('面试提纲'));
  assert.ok(!html.includes('<article'));
});
