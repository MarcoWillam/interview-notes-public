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
  preparationJobIds?: Array<string | undefined>;
  busy?: boolean;
};

export function canRegenerateOutline(value: OutlineRegenerationState) {
  return !!(
    value.resumeText.trim() &&
    ((value.reading?.interviewQuestions?.length === 6 &&
      value.reading.interviewQuestions.every(
        (question) => question.questionSource,
      )) ||
      value.reading?.outline?.version === 2 ||
      value.reading?.outline?.version === 3) &&
    !value.transcript.trim() &&
    !value.report &&
    !value.confirmed &&
    !value.regeneratedAt &&
    !value.activeJobId &&
    !value.preparationJobIds?.some(Boolean) &&
    !value.busy
  );
}

export async function createOutlineRegenerationInput(value: {
  resumeText: string;
  standards: InterviewStandards;
  reading: ResumeReading;
}): Promise<OutlineRegenerationInput> {
  if (!value.resumeText.trim())
    throw new Error('请重新上传或粘贴候选人简历后再生成提纲。');
  const revision = await outlineRevision(value);
  if (
    value.reading.outline?.version === 2 ||
    value.reading.outline?.version === 3
  )
    return validateOutlineRegenerationInput({
      ...value.standards,
      resumeText: value.resumeText,
      revision,
      outlineVersion: value.reading.outline.version,
      outline: value.reading.outline,
      workSample: value.reading.workSample || null,
      ...(value.reading.outline.version === 3 && value.reading.experienceMap
        ? { experienceMap: value.reading.experienceMap }
        : {}),
    });
  return validateOutlineRegenerationInput({
    ...value.standards,
    resumeText: value.resumeText,
    revision,
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

export function canApplyOutlineRegeneration(value: {
  submittedRecordId: string;
  currentRecordId: string;
  submittedInput: OutlineRegenerationInput;
  currentInput: OutlineRegenerationInput;
  transcript: string;
  report: Report | null;
  confirmed: boolean;
}) {
  return !!(
    value.submittedRecordId === value.currentRecordId &&
    value.submittedInput.revision === value.currentInput.revision &&
    !value.transcript.trim() &&
    !value.report &&
    !value.confirmed
  );
}
