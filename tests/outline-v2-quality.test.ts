import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  calculateOutlineCoverage,
  validateInterviewOutlineV2,
  type InterviewOutlineV2,
  type InterviewQuestionV2,
} from '../lib/interview-outline-v2.ts';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';

type QualityFixture = {
  name: string;
  templateId: string;
  resumeText: string;
  hasWrittenTest: boolean;
  workSample: { path: string; excerpt: string } | null;
  expected: {
    reviewSource: 'written-test' | 'work-sample' | null;
    reviewPositions: number[];
  };
};

const fixtureNames = [
  'ai-pm-no-written.json',
  'ai-pm-written.json',
  'ai-pm-work-sample.json',
  'product-operations.json',
];

async function loadFixture(name: string): Promise<QualityFixture> {
  return JSON.parse(
    await readFile(
      join(import.meta.dirname, 'fixtures/outline-v2', name),
      'utf8',
    ),
  ) as QualityFixture;
}

function benchmarkOutline(fixture: QualityFixture): {
  outline: InterviewOutlineV2;
  dimensions: string[];
  role: string;
} {
  const template = builtInRoleTemplates.find(
    ({ id }) => id === fixture.templateId,
  );
  assert.ok(template, `${fixture.name} references a known template`);
  const dimensions = template.dimensionText.split('、');
  const stems =
    template.role === 'AI 产品经理（校招）'
      ? [
          '讲讲你主动推动目标落地的经历',
          '你如何识别用户的真实问题',
          '你如何决定首版产品范围',
          '你如何判断是否适合使用AI',
          '你怎样验证方案是否真正有效',
          '你快速掌握新领域的方法是什么',
          '最困难的一次项目挑战是什么',
          '你如何推动团队形成一致决定',
        ]
      : [
          '讲讲你主动推动目标落地的经历',
          '你如何识别不同用户的需求',
          '你如何设计用户关系运营动作',
          '你如何推动运营策略落地执行',
          '你怎样设计并判断增长实验',
          '你快速掌握新领域的方法是什么',
          '最困难的一次项目挑战是什么',
          '你如何推动团队形成一致决定',
        ];
  const dimensionOrder = [4, 0, 1, 2, 3, 5, 6, 7];
  const questions: InterviewQuestionV2[] = stems.map((question, index) => {
    const review = fixture.expected.reviewPositions.includes(index + 1);
    const source = review
      ? fixture.expected.reviewSource!
      : index === 0
        ? ('resume' as const)
        : ('role' as const);
    return {
      id: `${fixture.templateId}-${index + 1}`,
      question,
      required: index < 5,
      estimatedMinutes: index < 5 ? 6 : 4,
      primaryDimension: dimensions[dimensionOrder[index]],
      secondaryDimensions: [],
      source,
      goal: '核实候选人的具体行动、判断依据和结果',
      resumeEvidence: source === 'resume' ? fixture.resumeText : null,
      workSampleEvidence: source === 'work-sample' ? fixture.workSample : null,
      listenFor: ['候选人本人的行动和可验证结果'],
      riskSignals: ['只描述团队成果，无法说明个人行动'],
      probes: [
        {
          condition: '个人行动不清楚',
          question: '你本人具体做了什么？',
        },
      ],
    };
  });
  const activeQuestions = questions;
  return {
    role: template.role,
    dimensions,
    outline: {
      version: 2,
      estimatedMinutes: 30,
      requiredQuestions: questions.slice(0, 5),
      reserveQuestions: questions.slice(5),
      archivedReserveQuestions: [],
      coverage: calculateOutlineCoverage(activeQuestions, dimensions),
    },
  };
}

for (const fixtureName of fixtureNames) {
  void test(`outline V2 quality baseline: ${fixtureName}`, async () => {
    const fixture = await loadFixture(fixtureName);
    const { outline, role, dimensions } = benchmarkOutline(fixture);
    const validated = validateInterviewOutlineV2(outline, {
      role,
      dimensions,
      resumeText: fixture.resumeText,
      requireProductCore: true,
      hasWrittenTest: fixture.hasWrittenTest,
      hasWorkSample: !!fixture.workSample,
    });
    assert.equal(validated.requiredQuestions.length, 5);
    assert.ok(validated.reserveQuestions.length <= 3);
    assert.ok(validated.estimatedMinutes <= 32);
    const requiredPrimary = new Set(
      validated.requiredQuestions.map((question) => question.primaryDimension),
    );
    assert.ok(requiredPrimary.has('自驱力与结果闭环'));
    dimensions
      .slice(0, 4)
      .forEach((dimension) =>
        assert.ok(
          requiredPrimary.has(dimension),
          `${dimension} needs primary coverage`,
        ),
      );
    assert.ok(validated.coverage.every(({ status }) => status !== 'uncovered'));
    assert.deepEqual(
      validated.requiredQuestions
        .map((question, index) => ({ question, position: index + 1 }))
        .filter(
          ({ question }) =>
            question.source === 'written-test' ||
            question.source === 'work-sample',
        )
        .map(({ question, position }) => ({
          source: question.source,
          position,
        })),
      fixture.expected.reviewPositions.map((position) => ({
        source: fixture.expected.reviewSource,
        position,
      })),
    );
    validated.requiredQuestions
      .filter(({ source }) => source === 'resume')
      .forEach(({ resumeEvidence }) =>
        assert.ok(
          resumeEvidence && fixture.resumeText.includes(resumeEvidence),
        ),
      );
    validated.requiredQuestions
      .filter(({ source }) => source === 'work-sample')
      .forEach(({ workSampleEvidence }) =>
        assert.deepEqual(workSampleEvidence, fixture.workSample),
      );
  });
}
