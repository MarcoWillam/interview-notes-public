export type CandidateResolution =
  | { kind: 'fill'; value: string }
  | { kind: 'confirm'; current: string; detected: string }
  | { kind: 'keep' };

export function reconcileCandidateName(
  current: string,
  detected: string | null | undefined,
): CandidateResolution {
  const currentName = current.trim();
  const detectedName = detected?.trim();
  if (!detectedName || currentName === detectedName) return { kind: 'keep' };
  if (!currentName) return { kind: 'fill', value: detectedName };
  return { kind: 'confirm', current: currentName, detected: detectedName };
}
