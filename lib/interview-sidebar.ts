import type { SavedInterview } from './local/store';

export const SIDEBAR_BREAKPOINT = 1180;
export const SIDEBAR_STORAGE_KEY = 'interview-sidebar-collapsed';
export type SidebarSortMode = 'newest' | 'oldest' | 'manual';

export function parseSidebarCollapsed(value: string | null) {
  return value === 'true';
}

export function sidebarSortStorageKey(scope: string) {
  return `interview-sidebar-sort:${encodeURIComponent(scope)}`;
}

export function sidebarOrderStorageKey(scope: string) {
  return `interview-sidebar-order:${encodeURIComponent(scope)}`;
}

export function parseSidebarSortMode(value: string | null): SidebarSortMode {
  return value === 'oldest' || value === 'manual' ? value : 'newest';
}

export function interviewCreatedAt(row: SavedInterview) {
  return row.createdAt ?? row.updatedAt;
}

function newestFirst(a: SavedInterview, b: SavedInterview) {
  return (
    interviewCreatedAt(b) - interviewCreatedAt(a) ||
    b.updatedAt - a.updatedAt ||
    a.id.localeCompare(b.id)
  );
}

export function reconcileManualOrder(order: string[], rows: SavedInterview[]) {
  const ids = new Set(rows.map(({ id }) => id));
  const retained = order.filter(
    (id, index) => ids.has(id) && order.indexOf(id) === index,
  );
  const retainedIds = new Set(retained);
  const missing = rows
    .filter(({ id }) => !retainedIds.has(id))
    .sort(newestFirst)
    .map(({ id }) => id);
  return [...missing, ...retained];
}

export function sortInterviewSessions(
  rows: SavedInterview[],
  mode: SidebarSortMode,
  manualOrder: string[],
) {
  if (mode === 'newest') return [...rows].sort(newestFirst);
  if (mode === 'oldest') return [...rows].sort((a, b) => newestFirst(b, a));
  const order = reconcileManualOrder(manualOrder, rows);
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
}

export function moveManualInterview(
  order: string[],
  activeId: string,
  targetId: string,
) {
  if (
    activeId === targetId ||
    !order.includes(activeId) ||
    !order.includes(targetId)
  )
    return [...order];
  const next = order.filter((id) => id !== activeId);
  next.splice(next.indexOf(targetId), 0, activeId);
  return next;
}

export function updateInterviewSummary(
  rows: SavedInterview[],
  saved: SavedInterview,
) {
  const index = rows.findIndex(({ id }) => id === saved.id);
  if (index < 0) return [saved, ...rows];
  return rows.map((row, rowIndex) => (rowIndex === index ? saved : row));
}
