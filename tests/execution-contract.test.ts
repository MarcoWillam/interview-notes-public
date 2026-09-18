import assert from 'node:assert/strict';
import test from 'node:test';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';
import { executionContractFor } from '../server/execution-contract.ts';
import { followUpInputFixture } from './fixtures/follow-up-outline.ts';
import { validateResumeExperienceMap } from '../lib/resume-experience-map.ts';

const standards = builtInRoleTemplates[0];
const resumeText = '姓名：林小满。组织校园用户访谈并完成两轮验证。';
const questions = Array.from({ length: 6 }, (_, index) => ({
  question: `请聊聊你在校园项目中的第${index + 1}次关键判断？`,
  questionSource: 'role' as const,
  dimensions: [standards.dimensionText.split('、')[index % 8]],
  reason: '了解候选人的实际思考。',
  resumeEvidence: null,
  listenFor: ['候选人自己的行动'],
  probes: ['当时你先做了什么？'],
}));
const workSample = {
  id: 'artifact-12345678',
  deviceId: 'device-12345678',
  name: 'ai-pm-work.zip',
  sha256: 'a'.repeat(64),
  bytes: 1024,
  modifiedAt: 1,
};

const experienceMap = validateResumeExperienceMap(
  {
    version: 1,
    summary: '识别到一段校园项目。',
    experiences: [
      {
        id: 'experience-1',
        sourceOrder: 1,
        type: 'project',
        name: '校园用户访谈',
        nameEvidence: '校园用户访谈',
        organization: null,
        period: null,
        role: null,
        context: null,
        actions: [
          { text: '组织校园用户访谈', evidence: '组织校园用户访谈' },
        ],
        decisions: [],
        collaboration: [],
        outcomes: [],
        reflection: [],
        evidence: ['组织校园用户访谈'],
        dimensionSignals: ['用户洞察与问题定义'],
        missingInformation: [],
      },
    ],
    coverage: [
      {
        source: '校园用户访谈',
        experienceId: 'experience-1',
        status: 'mapped',
      },
    ],
    unresolvedItems: [],
  },
  { resumeText, dimensions: standards.dimensionText.split('、') },
);

void test('server builds text contracts for every text-only task kind', () => {
  const fixtures = [
    {
      kind: 'interview' as const,
      input: {
        role: standards.role,
        requirements: standards.requirements,
        transcript: '候选人：我主动找了五位同学访谈。',
        dimensions: standards.dimensionText.split('、'),
      },
    },
    {
      kind: 'resume' as const,
      input: {
        ...standards,
        resumeText,
        hasWrittenTest: false,
        outlineVersion: 1,
      },
    },
    {
      kind: 'written-test' as const,
      input: {
        ...standards,
        resumeText,
        existingQuestions: questions,
        outlineVersion: 1,
      },
    },
    {
      kind: 'outline' as const,
      input: {
        ...standards,
        resumeText,
        revision: 'outline-' + 'a'.repeat(64),
        interviewQuestions: questions,
        writtenTestSupplement: null,
        workSample: null,
        outlineVersion: 1,
      },
    },
  ];
  for (const fixture of fixtures) {
    const contract = executionContractFor(fixture.kind, fixture.input);
    assert.equal(contract.contractVersion, 1);
    assert.equal(contract.runner, 'structured-text');
    assert.equal(contract.attempt, 1);
    assert.ok(contract.instructions.length > 20);
  }
});

void test('server builds artifact-bound contracts for initial and later work', () => {
  const mapping = executionContractFor('resume', {
    ...standards,
    resumeText,
    hasWrittenTest: true,
    outlineVersion: 1,
    workSample,
  });
  assert.equal(mapping.runner, 'structured-text');

  const initial = executionContractFor('initial-outline', {
    ...standards,
    resumeText,
    hasWrittenTest: true,
    outlineVersion: 1,
    workSample,
    experienceMap,
  });
  assert.equal(initial.runner, 'structured-work-sample');
  assert.equal(initial.artifact?.coveragePointer, '/workSample/coverage');
  assert.deepEqual(
    initial.artifact?.evidenceRules.map((rule) => rule.collectionPointer),
    ['/workSample/questions', '/workSample/dimensions'],
  );

  const later = executionContractFor('work-sample', {
    ...standards,
    resumeText,
    outlineVersion: 1,
    existingQuestions: questions,
    workSample,
  });
  assert.equal(later.runner, 'structured-work-sample');
  assert.equal(later.artifact?.coveragePointer, '/coverage');
  assert.deepEqual(
    later.artifact?.evidenceRules.map((rule) => rule.collectionPointer),
    ['/questions', '/dimensions'],
  );
});

void test('server splits resume mapping from V3 outline generation', () => {
  const contract = executionContractFor('resume', {
    ...standards,
    resumeText,
    hasWrittenTest: false,
    outlineVersion: 3,
  });
  assert.equal(contract.runner, 'structured-text');
  assert.match(contract.instructions, /经历地图/);
  const schema = contract.schema as {
    properties: { version: { enum: number[] } };
  };
  assert.deepEqual(schema.properties.version.enum, [1]);

  const outline = executionContractFor('initial-outline', {
    ...standards,
    resumeText,
    hasWrittenTest: false,
    outlineVersion: 3,
    experienceMap,
  });
  assert.equal(outline.runner, 'structured-text');
  assert.match(outline.instructions, /V3 校招潜力/);
  assert.deepEqual(
    (
      outline.schema as {
        properties: { outline: { properties: { version: { enum: number[] } } } };
      }
    ).properties.outline.properties.version.enum,
    [3],
  );
});

void test('resume contracts restrict question sources to the submitted written-test state', () => {
  const withoutWrittenTest = executionContractFor('initial-outline', {
    ...standards,
    resumeText,
    hasWrittenTest: false,
    outlineVersion: 3,
    experienceMap,
  });
  const withoutSchema = withoutWrittenTest.schema as {
    properties: {
      outline: {
        properties: Record<
          'requiredQuestions' | 'reserveQuestions' | 'archivedReserveQuestions',
          { items: { properties: { source: { enum: string[] } } } }
        >;
      };
    };
  };
  for (const collection of [
    'requiredQuestions',
    'reserveQuestions',
    'archivedReserveQuestions',
  ] as const)
    assert.deepEqual(
      withoutSchema.properties.outline.properties[collection].items.properties
        .source.enum,
      ['role', 'resume'],
    );
  assert.match(withoutWrittenTest.instructions, /hasWrittenTest=false/);
  assert.match(withoutWrittenTest.instructions, /不代表本候选人完成了笔试/);

  const withWrittenTest = executionContractFor('initial-outline', {
    ...standards,
    resumeText,
    hasWrittenTest: true,
    outlineVersion: 3,
    experienceMap,
  });
  const withSchema = withWrittenTest.schema as typeof withoutSchema;
  assert.deepEqual(
    withSchema.properties.outline.properties.requiredQuestions.items.properties
      .source.enum,
    ['role', 'resume', 'written-test'],
  );

  const legacyWithoutWrittenTest = executionContractFor('initial-outline', {
    ...standards,
    resumeText,
    hasWrittenTest: false,
    outlineVersion: 1,
    experienceMap,
  });
  const legacySchema = legacyWithoutWrittenTest.schema as {
    properties: {
      interviewQuestions: {
        items: { properties: { questionSource: { enum: string[] } } };
      };
    };
  };
  assert.deepEqual(
    legacySchema.properties.interviewQuestions.items.properties.questionSource
      .enum,
    ['role', 'resume'],
  );
});

void test('server appends bounded semantic feedback only on retry', () => {
  const contract = executionContractFor(
    'resume',
    {
      ...standards,
      resumeText,
      hasWrittenTest: false,
      outlineVersion: 1,
    },
    { attempt: 2, feedback: '面试问题数量不正确。' },
  );
  assert.equal(contract.attempt, 2);
  assert.match(contract.instructions, /上一次结果未通过服务器校验/);
});

void test('server builds protocol five contracts for second-round outline and assessment', () => {
  const priorRoundText =
    '# 面试评估记录\n\n候选人：林小满\n岗位：AI 产品经理（校招）\n\n## 候选人简历（自述背景，待面试核实）\n组织用户访谈。\n\n## 对话记录（人工校对文本）\n候选人：我组织了访谈。';
  const outline = executionContractFor('second-round-outline', {
    ...standards,
    candidate: '林小满',
    priorRoundSource: 'bole-markdown',
    priorRoundText,
    priorRoundName: '初试.md',
    resumeText: '组织用户访谈。',
  });
  assert.equal(outline.runner, 'structured-text');
  assert.match(outline.instructions, /6 道必问/);
  assert.match(outline.instructions, /默认不设置笔试问题/);
  assert.match(outline.instructions, /最多 1 道/);
  assert.match(outline.instructions, /至少覆盖 4 种/);
  assert.match(outline.instructions, /简历中未明确具体项目/);
  const outlineSchema = outline.schema as {
    properties: {
      outline: {
        properties: {
          version: { enum: number[] };
          requiredQuestions: {
            minItems: number;
            items: { required: string[] };
          };
        };
      };
    };
  };
  assert.deepEqual(
    outlineSchema.properties.outline.properties.version.enum,
    [2],
  );
  assert.equal(
    outlineSchema.properties.outline.properties.requiredQuestions.minItems,
    6,
  );
  assert.ok(
    outlineSchema.properties.outline.properties.requiredQuestions.items.required.includes(
      'contextSummary',
    ),
  );
  assert.ok(
    outlineSchema.properties.outline.properties.requiredQuestions.items.required.includes(
      'resumeContext',
    ),
  );

  const assessment = executionContractFor('second-round-assessment', {
    role: standards.role,
    requirements: standards.requirements,
    transcript: '候选人：我重新访谈了三位用户。',
    dimensions: standards.dimensionText.split('、'),
    resumeText: '组织用户访谈。',
    focus: standards.focus,
    scoringGuidance: standards.scoringGuidance,
    reportRequirements: standards.reportRequirements,
    priorRoundText,
  });
  assert.match(assessment.instructions, /只.*本轮 transcript/);
  assert.ok(
    (assessment.schema as { required: string[] }).required.includes(
      'priorRoundComparison',
    ),
  );
});

void test('server builds a validated follow-up outline text contract', () => {
  const source = followUpInputFixture();
  const contract = executionContractFor('follow-up-outline', {
    ...source,
    requestedFocus: '  自驱力与主动发现问题  ',
  });
  assert.equal(contract.runner, 'structured-text');
  assert.equal(
    (contract.payload as { requestedFocus: string }).requestedFocus,
    '自驱力与主动发现问题',
  );
  assert.equal(
    (
      contract.schema as {
        properties: { questions: { minItems: number; maxItems: number } };
      }
    ).properties.questions.minItems,
    2,
  );
  assert.equal(
    (
      contract.schema as {
        properties: { questions: { minItems: number; maxItems: number } };
      }
    ).properties.questions.maxItems,
    2,
  );
  assert.match(contract.instructions, /自然、亲和/);
  assert.match(contract.instructions, /12–30/);
});

void test('follow-up outline retries append bounded feedback without changing payload', () => {
  const input = followUpInputFixture();
  const retainedFeedback = `first line ${'x'.repeat(989)}`;
  const discardedMarker = '<<discarded-feedback-marker>>';
  const feedback = `first line\n${'x'.repeat(989)}${discardedMarker}\nignored suffix`;
  const initial = executionContractFor('follow-up-outline', input, {
    feedback: '初次执行不应附带历史校验信息。',
  });
  const contract = executionContractFor('follow-up-outline', input, {
    attempt: 2,
    feedback,
  });
  assert.doesNotMatch(initial.instructions, /上一次结果未通过服务器校验/);
  assert.equal(contract.attempt, 2);
  assert.deepEqual(
    contract.payload,
    executionContractFor('follow-up-outline', input).payload,
  );
  assert.ok(
    contract.instructions.endsWith(
      `上一次结果未通过服务器校验：${retainedFeedback}。请修正后重新返回完整 JSON。`,
    ),
  );
  assert.equal(retainedFeedback.length, 1_000);
  assert.ok(feedback.length > 1_000);
  assert.ok(!contract.instructions.includes(discardedMarker));
  assert.ok(!contract.instructions.includes('ignored suffix'));
});
