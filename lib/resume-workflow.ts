export type CandidateResolution =
  | { kind: 'fill'; value: string }
  | { kind: 'confirm'; current: string; detected: string }
  | { kind: 'keep' };

export function applyCandidateNameChange(
  current: string,
  selected: string,
  effects: { invalidate: () => void; setCandidate: (name: string) => void },
): void {
  const resolution = reconcileCandidateName(current, selected);
  if (resolution.kind === 'keep') return;
  effects.invalidate();
  effects.setCandidate(
    resolution.kind === 'fill' ? resolution.value : resolution.detected,
  );
}

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
