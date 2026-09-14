import assert from 'node:assert/strict';
import test from 'node:test';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';
import { executionContractFor } from '../server/execution-contract.ts';

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
  const initial = executionContractFor('resume', {
    ...standards,
    resumeText,
    hasWrittenTest: true,
    outlineVersion: 1,
    workSample,
  });
  assert.equal(initial.runner, 'structured-work-sample');
  assert.equal(initial.artifact?.coveragePointer, '/workSample/coverage');

  const later = executionContractFor('work-sample', {
    ...standards,
    resumeText,
    outlineVersion: 1,
    existingQuestions: questions,
    workSample,
  });
  assert.equal(later.runner, 'structured-work-sample');
  assert.equal(later.artifact?.coveragePointer, '/coverage');
});

void test('server selects the V3 campus-potential prompt and schema at claim time', () => {
  const contract = executionContractFor('resume', {
    ...standards,
    resumeText,
    hasWrittenTest: false,
    outlineVersion: 3,
  });
  assert.equal(contract.runner, 'structured-text');
  assert.match(contract.instructions, /V3 校招潜力/);
  const schema = contract.schema as {
    properties: { outline: { properties: { version: { enum: number[] } } } };
  };
  assert.deepEqual(schema.properties.outline.properties.version.enum, [3]);
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
