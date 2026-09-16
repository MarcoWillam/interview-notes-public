import type { SecondRoundDigest } from './second-round.ts';

export type PriorRoundReviewPoints = {
  source: 'document' | 'digest' | 'none';
  pending: string[];
  focus: string[];
};

const reviewHeading =
  /^\s*(#{1,6}\s+)?(待核实事项|待考核点|重点考察事项)\s*[:：]?\s*$/;
const markdownHeading = /^\s*#{1,6}\s+/;
const listMarker = /^\s*(?:[-*•]\s*|\d+[.)、]\s*)/;

function unique(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

export function extractPriorRoundReviewPoints(
  text: string,
  digest: SecondRoundDigest | null,
): PriorRoundReviewPoints {
  const lines = text.split(/\r?\n/);
  const pending: string[] = [];
  const focus: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const heading = reviewHeading.exec(lines[index]);
    if (!heading) continue;
    const destination = heading[2] === '重点考察事项' ? focus : pending;
    const markdown = !!heading[1];
    for (index++; index < lines.length; index++) {
      const line = lines[index];
      if (
        markdownHeading.test(line) ||
        reviewHeading.test(line) ||
        (!markdown && !line.trim())
      ) {
        index--;
        break;
      }
      const item = line.replace(listMarker, '').trim();
      if (item) destination.push(item);
    }
  }

  const explicitPending = unique(pending);
  const explicitFocus = unique(focus);
  if (explicitPending.length || explicitFocus.length)
    return {
      source: 'document',
      pending: explicitPending,
      focus: explicitFocus,
    };

  const inferred = unique([
    ...(digest?.gaps || []),
    ...(digest?.risks || []),
    ...(digest?.conflicts || []),
  ]);
  return {
    source: inferred.length ? 'digest' : 'none',
    pending: inferred,
    focus: [],
  };
}
