import type { CloudInterview } from './cloud-interview.ts';

type Draft = Omit<CloudInterview, 'id' | 'createdAt' | 'updatedAt'>;
const taskFields = new Set(['outlineSupplements', 'followUpOutlineJobId']);

export function interviewDraft(record: CloudInterview): Draft {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...draft
  } = record;
  return draft;
}

/** Only a persisted snapshot without an outbox is a known common base. */
export function mergeFollowUpRefresh(
  base: CloudInterview,
  local: Draft,
  remote: CloudInterview,
  hasPendingSync: boolean,
) {
  const baseDraft = interviewDraft(base);
  const remoteDraft = interviewDraft(remote);
  const merged = { ...remoteDraft };
  let conflict = false;
  const keys = new Set([
    ...Object.keys(baseDraft),
    ...Object.keys(local),
    ...Object.keys(remoteDraft),
  ]);
  for (const rawKey of keys) {
    if (taskFields.has(rawKey)) continue;
    const key = rawKey as keyof Draft;
    const localField = Object.hasOwn(local, key) ? local[key] : baseDraft[key];
    const localValue = JSON.stringify(localField);
    const remoteValue = JSON.stringify(remoteDraft[key]);
    if (hasPendingSync) {
      if (localValue !== remoteValue) conflict = true;
      continue;
    }
    const baseValue = JSON.stringify(baseDraft[key]);
    const localChanged = localValue !== baseValue;
    const remoteChanged = remoteValue !== baseValue;
    if (localChanged && remoteChanged && localValue !== remoteValue)
      conflict = true;
    else if (localChanged) Object.assign(merged, { [key]: local[key] });
  }
  // Conflicting local content is retained separately, never uploaded against a
  // newly fetched revision. The working copy uses the recoverable remote side.
  const draft = conflict ? remoteDraft : merged;
  const upload =
    !conflict &&
    [...keys].some((rawKey) => {
      const key = rawKey as keyof Draft;
      return JSON.stringify(draft[key]) !== JSON.stringify(remoteDraft[key]);
    });
  return { draft, conflict, upload };
}
