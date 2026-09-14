import type { CloudInterview, CloudVersionReason } from './cloud-interview.ts';
import type { CodexExecutionKind as JobKind } from './codex-execution-contract.ts';
import type { ResumeReading } from './resume-reading.ts';
import type { Report } from './interview.ts';
import { applyWrittenTestSupplement } from './interview-template-state.ts';
import { applyOutlineRegeneration, type OutlineRegenerationResult } from './outline-regeneration.ts';
import { applyLateWorkSample } from './work-sample-workflow.ts';
import type { WrittenTestSupplementResult } from './written-test-supplement.ts';
import type { WorkSampleAnalysisResult } from './work-sample.ts';

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

export function resultVersionReason(kind: JobKind): CloudVersionReason {
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
): CloudInterview {
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
