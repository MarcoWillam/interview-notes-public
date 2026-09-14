import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPreparationWorkSampleInput,
  createPreparationWrittenTestInput,
} from '../lib/preparation-analysis-inputs.ts';
import type { InterviewOutlineV3 } from '../lib/interview-outline-v3.ts';
import type { ResumeReading } from '../lib/resume-reading.ts';

const context = {
  role: 'AI 产品经理（校招）',
  requirements: '理解用户问题',
  dimensionText: '一、二、三、四、五、六、七、八',
  focus: '核实判断',
  scoringGuidance: '依据证据',
  reportRequirements: '列出边界',
  resumeText: '姓名：林小满',
  outlineVersion: 3 as const,
};
const outline = {
  version: 3,
  estimatedMinutes: 30,
  requiredQuestions: [],
  reserveQuestions: [],
  archivedReserveQuestions: [],
  coverage: [],
} as InterviewOutlineV3;
const reading = {
  summary: '待核实',
  sections: [],
  followUps: [],
  outline,
} satisfies ResumeReading;
const artifact = {
  id: 'artifact-12345678',
  deviceId: 'device-12345678',
  name: '作品.zip',
  sha256: 'a'.repeat(64),
  bytes: 1024,
  modifiedAt: 1,
};

void test('preparation input builders preserve the V3 outline discriminant', () => {
  const written = createPreparationWrittenTestInput(context, reading);
  const work = createPreparationWorkSampleInput(context, reading, artifact);
  assert.equal(written.outlineVersion, 3);
  assert.equal('outline' in written ? written.outline : null, outline);
  assert.equal(work.outlineVersion, 3);
  assert.equal('outline' in work ? work.outline : null, outline);
});

void test('preparation input builders keep legacy question arrays on V1', () => {
  const question = {
    question: '最近一次主动解决问题时你先做了什么？',
    questionSource: 'role' as const,
    dimensions: ['一'],
    reason: '核实行动',
    resumeEvidence: null,
    listenFor: ['行动'],
    probes: ['后来呢？'],
  };
  const legacyReading: ResumeReading = {
    ...reading,
    outline: undefined,
    interviewQuestions: [question],
    writtenTestSupplement: [question],
  };
  const legacy = { ...context, outlineVersion: 1 as const };
  const written = createPreparationWrittenTestInput(legacy, legacyReading);
  const work = createPreparationWorkSampleInput(
    legacy,
    legacyReading,
    artifact,
  );
  assert.equal(
    'existingQuestions' in written && written.existingQuestions.length,
    1,
  );
  assert.equal('existingQuestions' in work && work.existingQuestions.length, 2);
});
