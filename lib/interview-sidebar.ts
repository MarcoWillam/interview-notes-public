import type { SavedInterview } from './local/store';

export const SIDEBAR_BREAKPOINT = 1180;
export const SIDEBAR_STORAGE_KEY = 'interview-sidebar-collapsed';

export function parseSidebarCollapsed(value: string | null) {
  return value === 'true';
}

export function updateInterviewSummary(
  rows: SavedInterview[],
  saved: SavedInterview,
) {
  const index = rows.findIndex(({ id }) => id === saved.id);
  if (index < 0) return [saved, ...rows];
  return rows.map((row, rowIndex) => (rowIndex === index ? saved : row));
}
