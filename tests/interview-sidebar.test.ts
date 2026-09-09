import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SavedInterview } from '../lib/local/store.ts';
import {
  SIDEBAR_BREAKPOINT,
  parseSidebarCollapsed,
  updateInterviewSummary,
} from '../lib/interview-sidebar.ts';

function session(id: string, updatedAt: number): SavedInterview {
  return {
    id,
    updatedAt,
    candidate: id,
    role: 'AI 产品经理（校招）',
    requirements: '',
    dimensionText: '自驱力',
    focus: '',
    resumeText: '',
    resumeName: '',
    transcript: '',
    reviewed: false,
    report: null,
    conclusion: '',
    confirmed: false,
  };
}

void test('saved interview metadata updates without reordering existing rows', () => {
  const rows = [session('a', 30), session('b', 20)];
  const updated = updateInterviewSummary(rows, {
    ...rows[1],
    candidate: '新姓名',
    updatedAt: 40,
  });
  assert.deepEqual(
    updated.map(({ id }) => id),
    ['a', 'b'],
  );
  assert.equal(updated[1].candidate, '新姓名');
});

void test('a newly saved interview is inserted at the start', () => {
  const current = session('new', 40);
  assert.deepEqual(
    updateInterviewSummary([session('old', 20)], current).map(({ id }) => id),
    ['new', 'old'],
  );
});

void test('sidebar preference accepts only the persisted collapsed value', () => {
  assert.equal(parseSidebarCollapsed('true'), true);
  assert.equal(parseSidebarCollapsed('false'), false);
  assert.equal(parseSidebarCollapsed(null), false);
  assert.equal(SIDEBAR_BREAKPOINT, 1180);
});
