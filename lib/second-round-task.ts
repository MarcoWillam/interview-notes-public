import {
  validateSecondRoundAssessmentInput,
  validateSecondRoundAssessmentResult,
  validateSecondRoundOutlineInput,
  validateSecondRoundOutlineResult,
  type SecondRoundAssessmentInput,
  type SecondRoundAssessmentResult,
  type SecondRoundOutlineInput,
  type SecondRoundOutlineResult,
} from './second-round.ts';

export type IndependentSecondRoundTaskKind =
  | 'second-round-outline'
  | 'second-round-assessment';

export async function secondRoundTaskSourceHash(
  kind: 'second-round-outline',
  value: unknown,
): Promise<string>;
export async function secondRoundTaskSourceHash(
  kind: 'second-round-assessment',
  value: unknown,
): Promise<string>;
export async function secondRoundTaskSourceHash(
  kind: IndependentSecondRoundTaskKind,
  value: unknown,
): Promise<string>;
export async function secondRoundTaskSourceHash(
  kind: IndependentSecondRoundTaskKind,
  value: unknown,
): Promise<string> {
  const normalized: SecondRoundOutlineInput | SecondRoundAssessmentInput =
    kind === 'second-round-outline'
      ? validateSecondRoundOutlineInput(value)
      : validateSecondRoundAssessmentInput(value);
  const source = `${kind}\n${JSON.stringify(normalized)}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(source),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function recoverSecondRoundTaskResult(
  kind: 'second-round-outline',
  input: SecondRoundOutlineInput,
  expectedSourceHash: string,
  report: unknown,
): Promise<
  { status: 'ready'; result: SecondRoundOutlineResult } | { status: 'stale' }
>;
export async function recoverSecondRoundTaskResult(
  kind: 'second-round-assessment',
  input: SecondRoundAssessmentInput,
  expectedSourceHash: string,
  report: unknown,
): Promise<
  { status: 'ready'; result: SecondRoundAssessmentResult } | { status: 'stale' }
>;
export async function recoverSecondRoundTaskResult(
  kind: IndependentSecondRoundTaskKind,
  input: SecondRoundOutlineInput | SecondRoundAssessmentInput,
  expectedSourceHash: string,
  report: unknown,
) {
  const currentSourceHash = await secondRoundTaskSourceHash(kind, input);
  if (currentSourceHash !== expectedSourceHash)
    return { status: 'stale' } as const;
  return {
    status: 'ready' as const,
    result:
      kind === 'second-round-outline'
        ? validateSecondRoundOutlineResult(
            report,
            input as SecondRoundOutlineInput,
          )
        : validateSecondRoundAssessmentResult(
            report,
            input as SecondRoundAssessmentInput,
          ),
  };
}
