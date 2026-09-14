import {
  resumeInstructionsFor,
  resumeOutputSchema,
  validateResumeInput,
  type ResumeInput,
} from '../lib/resume-reading.ts';
import {
  writtenTestSupplementInstructionsFor,
  writtenTestSupplementOutputSchema,
  validateWrittenTestSupplementInput,
  type WrittenTestSupplementInput,
} from '../lib/written-test-supplement.ts';
import type { InterviewInput } from '../lib/interview.ts';
import { assessmentInstructions, reportSchema } from '../lib/assessment.ts';
import {
  outlineRegenerationInstructionsFor,
  outlineRegenerationOutputSchema,
  validateOutlineRegenerationInput,
  validateOutlineRegenerationResult,
  type OutlineRegenerationInput,
} from '../lib/outline-regeneration.ts';
import {
  runStructuredCodex,
  runStructuredCodexWithWorkSample,
} from './codex-runtime.ts';

export * from './codex-runtime.ts';

export async function analyzeWithCodex(
  input: InterviewInput,
  signal: AbortSignal,
): Promise<unknown> {
  return runStructuredCodex(
    input,
    signal,
    assessmentInstructions,
    reportSchema,
  );
}

export async function readResumeWithCodex(
  input: ResumeInput,
  signal: AbortSignal,
): Promise<unknown> {
  const normalized = validateResumeInput(input);
  const version = normalized.outlineVersion ?? 1;
  return runStructuredCodex(
    normalized,
    signal,
    resumeInstructionsFor(version),
    resumeOutputSchema(version),
  );
}

export async function generateWrittenTestSupplementWithCodex(
  input: WrittenTestSupplementInput,
  signal: AbortSignal,
): Promise<unknown> {
  const normalized = validateWrittenTestSupplementInput(input);
  const version = normalized.outlineVersion ?? 1;
  return runStructuredCodex(
    normalized,
    signal,
    writtenTestSupplementInstructionsFor(version),
    writtenTestSupplementOutputSchema(version),
  );
}

export async function regenerateOutlineWithCodex(
  value: OutlineRegenerationInput,
  signal: AbortSignal,
): Promise<unknown> {
  const input = validateOutlineRegenerationInput(value);
  const version = input.outlineVersion ?? 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runStructuredCodex(
      input,
      signal,
      `${outlineRegenerationInstructionsFor(version)}${
        attempt
          ? `\n上一次结果的主问题未满足短句结构。本次必须逐题检查 ${version === 2 ? '8–24' : '12–30'} 字、最多一个问号，并把所有细节移入观察点和追问。`
          : ''
      }`,
      outlineRegenerationOutputSchema(version),
    );
    try {
      return validateOutlineRegenerationResult(raw, input);
    } catch (error) {
      lastError = error;
      if (
        attempt > 0 ||
        !/12–30|一个问点|自然、亲和/.test(
          error instanceof Error ? error.message : '',
        )
      )
        throw error;
    }
  }
  throw lastError;
}

export { runStructuredCodex, runStructuredCodexWithWorkSample };
