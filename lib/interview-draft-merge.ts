import type { CloudInterview } from './cloud-interview.ts';

export type InterviewDraft = Omit<
  CloudInterview,
  'id' | 'createdAt' | 'updatedAt'
>;

export function interviewDraft(record: CloudInterview): InterviewDraft {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...draft
  } = record;
  return draft;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalJson(child)]),
  );
}

export function stableJsonFingerprint(value: unknown) {
  return JSON.stringify(canonicalJson(value));
}

function sameJson(left: unknown, right: unknown) {
  return stableJsonFingerprint(left) === stableJsonFingerprint(right);
}

export function sameInterviewDraft(
  left: InterviewDraft,
  right: InterviewDraft,
) {
  return sameJson(left, right);
}

export type InterviewDraftReconciliation =
  | { kind: 'clean'; draft: InterviewDraft }
  | { kind: 'write'; draft: InterviewDraft }
  | { kind: 'conflict'; draft: InterviewDraft };

export function reconcileInterviewDraft(
  base: InterviewDraft | undefined,
  local: InterviewDraft,
  remote: InterviewDraft,
): InterviewDraftReconciliation {
  if (sameInterviewDraft(local, remote))
    return { kind: 'clean', draft: remote };
  if (!base) return { kind: 'conflict', draft: remote };
  if (sameInterviewDraft(local, base)) return { kind: 'clean', draft: remote };
  if (sameInterviewDraft(remote, base)) return { kind: 'write', draft: local };

  const merged = {} as InterviewDraft;
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]) as Set<keyof InterviewDraft>;
  for (const key of keys) {
    const baseValue = base[key];
    const localValue = local[key];
    const remoteValue = remote[key];
    const localChanged = !sameJson(localValue, baseValue);
    const remoteChanged = !sameJson(remoteValue, baseValue);
    if (localChanged && remoteChanged && !sameJson(localValue, remoteValue))
      return { kind: 'conflict', draft: remote };
    const source = localChanged ? local : remote;
    if (Object.hasOwn(source, key) && source[key] !== undefined)
      Object.assign(merged, { [key]: source[key] });
  }
  return sameInterviewDraft(merged, remote)
    ? { kind: 'clean', draft: remote }
    : { kind: 'write', draft: merged };
}
