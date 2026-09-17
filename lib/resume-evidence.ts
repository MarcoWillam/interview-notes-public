/** Return the original contiguous quote when only whitespace layout differs. */
export function resolveResumeEvidence(
  source: string,
  quote: string,
): string | null {
  if (source.includes(quote)) return quote;
  const pattern = quote
    .split(/(\s+)/)
    .map((part) =>
      /^\s+$/.test(part) ? '\\s+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('');
  return source.match(new RegExp(pattern))?.[0] ?? null;
}
