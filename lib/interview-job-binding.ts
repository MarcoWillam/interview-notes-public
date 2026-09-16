import {
  applyFollowUpOutlineResult,
  validateFollowUpOutlineInput,
  type FollowUpOutlineResult,
} from './follow-up-outline.ts';
import type { CloudInterview, CloudVersionReason } from './cloud-interview.ts';
import type { CodexExecutionKind as JobKind } from './codex-execution-contract.ts';
import type { ResumeReading } from './resume-reading.ts';
import type { Report } from './interview.ts';
import { applyWrittenTestSupplement } from './interview-template-state.ts';
import {
  applyOutlineRegeneration,
  type OutlineRegenerationResult,
} from './outline-regeneration.ts';
import { applyLateWorkSample } from './work-sample-workflow.ts';
import type { WrittenTestSupplementResult } from './written-test-supplement.ts';
import type { WorkSampleAnalysisResult } from './work-sample.ts';
import {
  validateSecondRoundAssessmentInput,
  validateSecondRoundOutlineInput,
  type SecondRoundAssessmentResult,
  type SecondRoundOutlineResult,
} from './second-round.ts';

const standards = (record: CloudInterview) => ({
  role: record.role,
  requirements: record.requirements,
  dimensionText: record.dimensionText,
  focus: record.focus,
  scoringGuidance: record.scoringGuidance || '',
  reportRequirements: record.reportRequirements || '',
});

export function interviewJobSource(record: CloudInterview, kind: JobKind) {
  const base = standards(record);
  if (kind === 'second-round-outline')
    return {
      ...base,
      candidate: record.candidate,
      priorRoundSource: record.priorRoundSource,
      priorRoundText: record.priorRoundText,
      priorRoundName: record.priorRoundName,
      resumeText: record.resumeText,
    };
  if (kind === 'second-round-assessment')
    return {
      role: record.role,
      requirements: record.requirements,
      transcript: record.transcript,
      dimensions: record.dimensionText
        .split(/[、,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
      resumeText: record.resumeText,
      focus: record.focus,
      scoringGuidance: record.scoringGuidance || '',
      reportRequirements: record.reportRequirements || '',
      priorRoundText: record.priorRoundText,
    };
  if (kind === 'follow-up-outline')
    return {
      ...Object.fromEntries(
        Object.entries(base).map(([key, value]) => [key, value.trim()]),
      ),
      resumeText: record.resumeText.trim(),
      resumeReading: record.resumeReading || null,
      outlineVersion: record.outlineVersion || 1,
      existingSupplements: record.outlineSupplements || [],
    };
  if (kind === 'resume')
    return {
      ...base,
      resumeText: record.resumeText,
      hasWrittenTest: !!record.hasWrittenTest,
      outlineVersion: record.outlineVersion || 1,
    };
  if (kind === 'interview')
    return {
      ...base,
      resumeText: record.resumeText,
      transcript: record.transcript,
      reviewed: record.reviewed,
      workSample: record.workSample || null,
    };
  return {
    ...base,
    resumeText: record.resumeText,
    resumeReading: record.resumeReading || null,
    hasWrittenTest: !!record.hasWrittenTest,
    workSample: record.workSample || null,
  };
}

function equal(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function assertInterviewJobInputMatches(
  record: CloudInterview,
  kind: JobKind,
  input: Record<string, unknown>,
) {
  if (kind === 'second-round-outline') {
    if (record.interviewStage !== 'second')
      throw new Error('当前记录不是复试记录。');
    const expected = validateSecondRoundOutlineInput(
      interviewJobSource(record, kind),
    );
    if (!equal(input, expected))
      throw new Error('复试提纲资料与云端面试记录不一致。');
    return;
  }
  if (kind === 'second-round-assessment') {
    if (record.interviewStage !== 'second' || !record.reviewed)
      throw new Error('当前复试记录尚未完成校对。');
    const expected = validateSecondRoundAssessmentInput(
      interviewJobSource(record, kind),
    );
    if (!equal(input, expected))
      throw new Error('复试评估资料与云端面试记录不一致。');
    return;
  }
  if (kind === 'follow-up-outline') {
    const expected = validateFollowUpOutlineInput({
      ...interviewJobSource(record, kind),
      requestedFocus: input.requestedFocus,
    });
    if (!equal(input, expected))
      throw new Error('补充追问资料与云端面试记录不一致。');
    return;
  }
  const expectedStandards = standards(record);
  const comparableStandards =
    kind === 'interview'
      ? Object.entries(expectedStandards)
          .filter(([key]) => key !== 'dimensionText')
          .map(([key, value]) => [key, value.trim()] as const)
      : Object.entries(expectedStandards);
  for (const [key, value] of comparableStandards)
    if ((input[key] || '') !== value)
      throw new Error('任务资料与云端面试记录不一致。');
  if ((input.resumeText || '') !== record.resumeText.trim())
    throw new Error('任务简历与云端面试记录不一致。');
  if (kind === 'resume') {
    if (
      !!input.hasWrittenTest !== !!record.hasWrittenTest ||
      Number(input.outlineVersion || 1) !== Number(record.outlineVersion || 1)
    )
      throw new Error('提纲设置与云端面试记录不一致。');
    return;
  }
  if (kind === 'interview') {
    const dimensions = record.dimensionText
      .split(/[、,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      input.transcript !== record.transcript.trim() ||
      !equal(input.dimensions, dimensions) ||
      !equal(input.workSample, record.workSample)
    )
      throw new Error('评估资料与云端面试记录不一致。');
    return;
  }
  const reading = record.resumeReading;
  if (!reading) throw new Error('云端面试记录缺少现有提纲。');
  if (input.outlineVersion === 2 || input.outlineVersion === 3) {
    if (!equal(input.outline, reading.outline))
      throw new Error('任务提纲与云端面试记录不一致。');
  } else if (
    kind === 'outline'
      ? !equal(input.interviewQuestions, reading.interviewQuestions) ||
        !equal(input.writtenTestSupplement, reading.writtenTestSupplement) ||
        !equal(input.workSample, reading.workSample)
      : !equal(input.existingQuestions, reading.interviewQuestions)
  ) {
    throw new Error('任务提纲与云端面试记录不一致。');
  }
}

export function resultVersionReason(kind: JobKind, record?: CloudInterview): CloudVersionReason {
  if (kind === 'follow-up-outline') return 'follow-up-outline-generated';
  if (kind === 'second-round-outline')
    return record?.secondRoundOutline
      ? 'second-round-outline-regenerated'
      : 'second-round-outline-generated';
  if (kind === 'second-round-assessment')
    return 'second-round-assessment-generated';
  return kind === 'resume'
    ? 'outline-generated'
    : kind === 'written-test'
      ? 'written-test-supplemented'
      : kind === 'work-sample'
        ? 'work-sample-analyzed'
        : kind === 'outline'
          ? 'outline-regenerated'
          : 'assessment-generated';
}

export function applyInterviewJobResult(
  record: CloudInterview,
  kind: JobKind,
  result: unknown,
  now: number,
  metadata?: { jobId: string },
): CloudInterview {
  if (kind === 'second-round-outline') {
    if (!metadata?.jobId) throw new Error('复试提纲结果缺少任务编号。');
    const value = result as SecondRoundOutlineResult;
    const next: CloudInterview = {
      ...record,
      priorRoundDigest: value.digest,
      secondRoundOutline: value.outline,
      updatedAt: now,
    };
    delete next.secondRoundOutlineJobId;
    return next;
  }
  if (kind === 'second-round-assessment') {
    const value = result as SecondRoundAssessmentResult;
    const { priorRoundComparison, ...report } = value;
    const next: CloudInterview = {
      ...record,
      report,
      priorRoundComparison,
      confirmed: false,
      updatedAt: now,
    };
    delete next.secondRoundAssessmentJobId;
    return next;
  }
  if (kind === 'follow-up-outline') {
    if (!metadata?.jobId) throw new Error('补充追问结果缺少任务编号。');
    const next = {
      ...record,
      outlineSupplements: applyFollowUpOutlineResult(
        record.outlineSupplements || [],
        result as FollowUpOutlineResult,
        { id: metadata.jobId, jobId: metadata.jobId, createdAt: now },
      ),
      updatedAt: now,
    };
    if (next.followUpOutlineJobId === metadata.jobId)
      delete next.followUpOutlineJobId;
    return next;
  }
  if (kind === 'resume') {
    const reading = result as ResumeReading;
    return {
      ...record,
      candidate: record.candidate || reading.candidateName?.trim() || '',
      resumeReading: reading,
      workSample: reading.workSample || record.workSample || null,
      updatedAt: now,
    };
  }
  if (kind === 'written-test') {
    if (!record.resumeReading) throw new Error('当前记录缺少面试提纲。');
    return {
      ...record,
      resumeReading: applyWrittenTestSupplement(
        record.resumeReading,
        result as WrittenTestSupplementResult,
      ),
      hasWrittenTest: true,
      writtenTestConfirmed: true,
      writtenTestJobId: undefined,
      updatedAt: now,
    };
  }
  if (kind === 'work-sample') {
    return {
      ...applyLateWorkSample(record, result as WorkSampleAnalysisResult),
      report: null,
      confirmed: false,
      updatedAt: now,
    };
  }
  if (kind === 'outline') {
    if (!record.resumeReading) throw new Error('当前记录缺少面试提纲。');
    return {
      ...record,
      resumeReading: applyOutlineRegeneration(
        record.resumeReading,
        result as OutlineRegenerationResult,
      ),
      outlineRegeneratedAt: now,
      outlineRegenerationJobId: undefined,
      updatedAt: now,
    };
  }
  return {
    ...record,
    report: result as Report,
    confirmed: false,
    updatedAt: now,
  };
}
