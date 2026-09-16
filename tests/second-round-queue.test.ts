import assert from 'node:assert/strict';
import test from 'node:test';
import { builtInRoleTemplates } from '../lib/default-role-templates.ts';
import type { CloudInterview } from '../lib/cloud-interview.ts';
import { interviewJobSource } from '../lib/interview-job-binding.ts';
import {
  CONNECTOR_VERSION,
  SERVER_DRIVEN_EXECUTION_PROTOCOL,
} from '../lib/connector-release.ts';
import { QueueStore } from '../server/queue/store.ts';

const standards = builtInRoleTemplates[0];
const priorRoundText = `# 面试评估记录

候选人：林小满
岗位：${standards.role}

## 候选人简历（自述背景，待面试核实）
林小满组织五位同学访谈，并主动完成两轮原型验证。

## 待核实事项
- 尚未说明为什么放弃第一个方案。

## 对话记录（人工校对文本）
面试官：请介绍这次校园项目。
候选人：我组织了五位同学访谈。`;
const resumeText = '林小满组织五位同学访谈，并主动完成两轮原型验证。';

function outlineQuestion(index: number) {
  return {
    id: `required-${index + 1}`,
    question: `当时你为何选择第${index + 1}种验证方式？`,
    dimensions: ['产品方案与范围取舍'],
    goal: '核实候选人的独立判断和取舍依据。',
    priorEvidence: '尚未说明为什么放弃第一个方案。',
    resumeEvidence: '主动完成两轮原型验证',
    relatedInitialQuestion: '请介绍这次校园项目。',
    difference: '初试了解项目概况，复试核实选择依据。',
    listenFor: ['是否说明本人判断', '是否说明替代方案'],
    riskSignals: ['只描述团队决定'],
    probes: ['如果重来一次，你会调整什么？'],
  };
}

const outlineResult = {
  digest: {
    initialQuestions: ['请介绍这次校园项目。'],
    verified: ['候选人组织了五位同学访谈。'],
    gaps: ['尚未说明为什么放弃第一个方案。'],
    risks: ['范围取舍缺少事实依据。'],
    conflicts: [],
  },
  outline: {
    version: 1 as const,
    recommendedMinutes: { min: 45 as const, max: 60 as const },
    summary: '围绕初试缺口继续核实判断、取舍和迁移能力。',
    requiredQuestions: Array.from({ length: 6 }, (_, index) =>
      outlineQuestion(index),
    ),
    reserveQuestions: [],
  },
};

void test('existing protocol five connector completes bound second-round outline and assessment', () => {
  let now = 1_000_000;
  const store = new QueueStore(':memory:', () => now);
  try {
    const user = store.createUser('alice', 'password-alice-123').id;
    const id = 'second-round-record-123';
    const record: CloudInterview = {
      id,
      createdAt: now,
      updatedAt: now,
      interviewStage: 'second',
      priorRoundSource: 'bole-markdown',
      priorRoundText,
      priorRoundName: '初试.md',
      priorRoundDigest: null,
      secondRoundOutline: null,
      candidate: '林小满',
      role: standards.role,
      requirements: standards.requirements,
      dimensionText: standards.dimensionText,
      focus: standards.focus,
      scoringGuidance: standards.scoringGuidance,
      reportRequirements: standards.reportRequirements,
      resumeText,
      resumeName: '初试.md',
      resumeReading: null,
      transcript: '',
      reviewed: false,
      report: null,
      conclusion: '',
      confirmed: false,
    };
    let saved = store.interviews.put(user, id, 0, 'create-second', record);
    const outlineJob = store.submit(
      user,
      'second-outline-client-123',
      '林小满 · 生成复试提纲',
      interviewJobSource(saved.record, 'second-round-outline'),
      'second-round-outline',
      id,
      { interviewId: id, interviewRevision: saved.revision },
    );
    const device = store.redeem(store.pairing(user).code, '现有协议五电脑', {
      version: CONNECTOR_VERSION,
      protocol: SERVER_DRIVEN_EXECUTION_PROTOCOL,
    });
    const outlineClaim = store.claim(
      device.token,
      true,
      ['interview', 'resume', 'outline'],
      {
        version: CONNECTOR_VERSION,
        protocol: SERVER_DRIVEN_EXECUTION_PROTOCOL,
      },
    )! as {
      id: string;
      lease: string;
      kind: string;
      execution: { attempt: number };
    };
    assert.equal(outlineClaim.id, outlineJob.id);
    assert.equal(outlineClaim.kind, 'second-round-outline');
    assert.equal(
      store.finish(
        device.token,
        outlineClaim.id,
        outlineClaim.lease,
        outlineResult,
        false,
        undefined,
        outlineClaim.execution.attempt,
      ).accepted,
      true,
    );
    saved = store.interviews.get(user, id);
    assert.equal(saved.record.secondRoundOutline?.requiredQuestions.length, 6);

    now += 1;
    saved = store.interviews.put(
      user,
      id,
      saved.revision,
      'add-second-transcript',
      {
        ...saved.record,
        updatedAt: now,
        transcript: '候选人：我重新访谈了三位用户，并主动否定了原方案。',
        reviewed: true,
      },
    );
    const assessmentJob = store.submit(
      user,
      'second-assessment-client-123',
      '林小满 · 复试结论评估',
      interviewJobSource(saved.record, 'second-round-assessment'),
      'second-round-assessment',
      id,
      { interviewId: id, interviewRevision: saved.revision },
    );
    const assessmentClaim = store.claim(
      device.token,
      true,
      ['interview', 'resume', 'outline'],
      {
        version: CONNECTOR_VERSION,
        protocol: SERVER_DRIVEN_EXECUTION_PROTOCOL,
      },
    )! as {
      id: string;
      lease: string;
      kind: string;
      execution: { attempt: number };
    };
    assert.equal(assessmentClaim.id, assessmentJob.id);
    assert.equal(assessmentClaim.kind, 'second-round-assessment');
    const result = {
      summary: '复试补充了主动调整方案的事实，其他维度证据不足。',
      dimensions: standards.dimensionText.split('、').map((name) => ({
        name,
        score: null,
        assessment: '本轮证据不足。',
        evidence: [],
      })),
      followUps: [],
      workSampleReview: [],
      priorRoundComparison: [
        {
          statement: '候选人能够主动调整方案。',
          status: 'supplemented',
          transcriptEvidence: ['我重新访谈了三位用户，并主动否定了原方案。'],
        },
      ],
    };
    assert.equal(
      store.finish(
        device.token,
        assessmentClaim.id,
        assessmentClaim.lease,
        result,
        false,
        undefined,
        assessmentClaim.execution.attempt,
      ).accepted,
      true,
    );
    const completed = store.interviews.get(user, id).record;
    assert.equal(completed.report?.summary, result.summary);
    assert.equal(completed.priorRoundComparison?.[0].status, 'supplemented');
  } finally {
    store.close();
  }
});
