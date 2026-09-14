import type { InterviewOutlineV2 } from './interview-outline-v2.ts';
import type { InterviewOutlineV3 } from './interview-outline-v3.ts';
import type { ResumeReading } from './resume-reading.ts';
import type { InterviewStandards } from './standards.ts';
import type { WorkSampleInput, WorkSampleReference } from './work-sample.ts';
import type { WrittenTestSupplementInput } from './written-test-supplement.ts';

export type PreparationAnalysisContext = InterviewStandards & {
  resumeText: string;
  outlineVersion: 1 | 2 | 3;
};

type StructuredOutlineSnapshot =
  | { outlineVersion: 2; outline: InterviewOutlineV2 }
  | { outlineVersion: 3; outline: InterviewOutlineV3 };

function structuredOutlineSnapshot(
  context: PreparationAnalysisContext,
  reading: ResumeReading,
): StructuredOutlineSnapshot | null {
  if (context.outlineVersion === 3 && reading.outline?.version === 3)
    return { outlineVersion: 3, outline: reading.outline };
  if (context.outlineVersion === 2 && reading.outline?.version === 2)
    return { outlineVersion: 2, outline: reading.outline };
  return null;
}

function commonInput(context: PreparationAnalysisContext) {
  return {
    role: context.role,
    requirements: context.requirements,
    dimensionText: context.dimensionText,
    focus: context.focus,
    scoringGuidance: context.scoringGuidance,
    reportRequirements: context.reportRequirements,
    resumeText: context.resumeText,
  };
}

export function createPreparationWrittenTestInput(
  context: PreparationAnalysisContext,
  reading: ResumeReading,
): WrittenTestSupplementInput {
  const common = commonInput(context);
  const structured = structuredOutlineSnapshot(context, reading);
  return structured
    ? { ...common, ...structured }
    : { ...common, existingQuestions: reading.interviewQuestions || [] };
}

export function createPreparationWorkSampleInput(
  context: PreparationAnalysisContext,
  reading: ResumeReading,
  workSample: WorkSampleReference,
): WorkSampleInput {
  const common = { ...commonInput(context), workSample };
  const structured = structuredOutlineSnapshot(context, reading);
  return structured
    ? { ...common, ...structured }
    : {
        ...common,
        existingQuestions: [
          ...(reading.interviewQuestions || []),
          ...(reading.writtenTestSupplement || []),
        ],
      };
}
