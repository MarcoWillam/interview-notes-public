import assert from 'node:assert/strict';
import test from 'node:test';
import type { CloudInterview } from '../lib/cloud-interview.ts';
import {
  createInitialHandoffRecord,
  createSecondRoundHandoffRecord,
} from '../lib/interview-handoff.ts';

const source: CloudInterview = {
  id: 'source-record-12345',
  groupId: 'group-12345',
  createdAt: 100,
  updatedAt: 200,
  candidate: '林晓雨',
  role: 'AI 产品经理（校招）',
  requirements: '理解用户问题并设计 AI 产品。',
  dimensionText: '自驱力、学习力、产品能力',
  focus: '关注潜力与真实思考过程。',
  scoringGuidance: '证据优先。',
  reportRequirements: '区分事实与判断。',
  sourceTemplateId: 'ai-product-manager',
  templateModified: false,
  outlineVersion: 3,
  hasWrittenTest: true,
  writtenTestConfirmed: true,
  resumeText: '姓名：林晓雨\n项目：校园 AI 助手。',
  resumeName: '林晓雨简历.docx',
  resumeReading: {
    candidateName: '林晓雨',
    summary: '有校园项目经历。',
    sections: [],
    followUps: [],
  },
  workSample: {
    artifact: {
      id: 'artifact-12345',
      name: '作品.zip',
      sha256: 'a'.repeat(64),
      bytes: 100,
      modifiedAt: 100,
    },
    coverage: {
      analyzed: ['README.md'],
      excluded: [],
      unsupported: [],
      truncated: false,
    },
    summary: '完成了作品分析。',
    dimensions: [],
    strengths: ['结构完整'],
    risks: ['数据不足'],
    questions: [],
  },
  transcript: '面试官：为什么做这个项目？\n候选人：我发现同学有这个问题。',
  transcriptName: '初试记录.md',
  reviewed: true,
  report: {
    summary: '具备进一步培养潜力。',
    dimensions: [
      {
        name: '自驱力',
        score: 4,
        assessment: '主动发现并推进问题。',
        evidence: ['候选人：我发现同学有这个问题。'],
      },
      {
        name: '学习力',
        score: null,
        assessment: '证据不足。',
        evidence: [],
      },
      {
        name: '产品能力',
        score: null,
        assessment: '证据不足。',
        evidence: [],
      },
    ],
    followUps: [],
  },
  conclusion: '建议进入复试。',
  confirmed: true,
  outlineSupplements: [],
  interviewStage: 'initial',
};

void test('initial handoff keeps preparation inputs and clears generated work', () => {
  const record = createInitialHandoffRecord(source, {
    id: 'target-initial-12345',
    now: 500,
  });

  assert.equal(record.id, 'target-initial-12345');
  assert.equal(record.createdAt, 500);
  assert.equal(record.updatedAt, 500);
  assert.equal(record.candidate, source.candidate);
  assert.equal(record.role, source.role);
  assert.equal(record.resumeText, source.resumeText);
  assert.equal(record.hasWrittenTest, true);
  assert.equal(record.writtenTestConfirmed, true);
  assert.equal(record.interviewStage, 'initial');
  assert.equal(record.groupId, null);
  assert.equal(record.resumeReading, null);
  assert.equal(record.workSample, null);
  assert.equal(record.transcript, '');
  assert.equal(record.report, null);
  assert.equal(record.confirmed, false);
  assert.equal(record.outlineSupplements, undefined);
});

void test('second-round handoff embeds the confirmed initial interview export', () => {
  const record = createSecondRoundHandoffRecord(source, {
    id: 'target-second-12345',
    now: 600,
  });

  assert.equal(record.interviewStage, 'second');
  assert.equal(record.priorRoundSource, 'bole-markdown');
  assert.equal(record.priorRoundName, '林晓雨-面试记录.md');
  assert.match(record.priorRoundText || '', /^# 面试评估记录/m);
  assert.match(record.priorRoundText || '', /状态：面试官已确认/);
  assert.match(record.priorRoundText || '', /建议进入复试。/);
  assert.match(record.priorRoundText || '', /为什么做这个项目/);
  assert.equal(record.resumeText, source.resumeText);
  assert.equal(record.resumeReading, null);
  assert.equal(record.secondRoundOutline, null);
  assert.equal(record.priorRoundDigest, null);
  assert.equal(record.transcript, '');
  assert.equal(record.report, null);
  assert.equal(record.confirmed, false);
});

void test('second-round handoff preserves imported initial materials from a standalone second round', () => {
  const generatedOutline = {
    version: 1 as const,
    recommendedMinutes: { min: 45 as const, max: 60 as const },
    summary: '继续验证候选人的判断与取舍。',
    requiredQuestions: [
      {
        id: 'required-1',
        question: '如果重新做一次，你会先改变哪个关键决定？',
        dimensions: ['自驱力'],
        goal: '验证复盘深度。',
        priorEvidence: '候选人已介绍原方案。',
        resumeEvidence: null,
        relatedInitialQuestion: '你当时为什么这样设计？',
        difference: '从复述方案转为验证反事实思考。',
        listenFor: ['能说明调整依据。'],
        riskSignals: ['只给笼统结论。'],
        probes: ['什么信息会让你改变答案？'],
      },
    ],
    reserveQuestions: [],
  };
  const standaloneSecondRound: CloudInterview = {
    ...source,
    id: 'source-second-round-12345',
    interviewStage: 'second',
    priorRoundSource: 'external',
    priorRoundText: '# 外部初试记录\n\n候选人已完成初试。',
    priorRoundName: '外部初试记录.txt',
    priorRoundDigest: {
      initialQuestions: ['请介绍一次项目取舍。'],
      verified: ['表达清晰'],
      gaps: ['数据意识待验证'],
      risks: [],
      conflicts: [],
    },
    secondRoundOutline: generatedOutline,
    transcript: '复试官：旧复试内容。',
    transcriptName: '旧复试记录.txt',
    reviewed: true,
    report: null,
    conclusion: '旧复试结论',
    confirmed: false,
  };

  const record = createSecondRoundHandoffRecord(standaloneSecondRound, {
    id: 'target-second-round-12345',
    now: 700,
  });

  assert.equal(record.interviewStage, 'second');
  assert.equal(record.priorRoundSource, 'external');
  assert.equal(record.priorRoundText, standaloneSecondRound.priorRoundText);
  assert.equal(record.priorRoundName, standaloneSecondRound.priorRoundName);
  assert.deepEqual(record.priorRoundDigest, standaloneSecondRound.priorRoundDigest);
  assert.deepEqual(record.secondRoundOutline, generatedOutline);
  assert.equal(record.transcript, '');
  assert.equal(record.transcriptName, undefined);
  assert.equal(record.conclusion, '');
  assert.equal(record.confirmed, false);
});
