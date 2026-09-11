import {
  outlineRevision,
  validateOutlineRegenerationInput,
  type OutlineRegenerationInput,
  type OutlineRegenerationResult,
} from './outline-regeneration.ts';
import type { Report } from './interview.ts';
import type { ResumeReading } from './resume-reading.ts';
import type { InterviewStandards } from './standards.ts';

export type OutlineRegenerationState = {
  resumeText: string;
  reading: ResumeReading | null;
  transcript: string;
  report: Report | null;
  confirmed: boolean;
  regeneratedAt?: number;
  activeJobId?: string;
  busy?: boolean;
};

export function canRegenerateOutline(value: OutlineRegenerationState) {
  return !!(
    value.resumeText.trim() &&
    value.reading?.interviewQuestions?.length === 6 &&
    !value.transcript.trim() &&
    !value.report &&
    !value.confirmed &&
    !value.regeneratedAt &&
    !value.activeJobId &&
    !value.busy
  );
}

export function createOutlineRegenerationInput(value: {
  resumeText: string;
  standards: InterviewStandards;
  reading: ResumeReading;
}): OutlineRegenerationInput {
  return validateOutlineRegenerationInput({
    ...value.standards,
    resumeText: value.resumeText,
    revision: outlineRevision(value),
    interviewQuestions: value.reading.interviewQuestions,
    writtenTestSupplement: value.reading.writtenTestSupplement || null,
    workSample: value.reading.workSample || null,
  });
}

export function regenerationResultIsCurrent(
  input: OutlineRegenerationInput,
  result: OutlineRegenerationResult,
) {
  return input.revision === result.revision;
}
