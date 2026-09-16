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
