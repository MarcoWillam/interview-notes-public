import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { changedInterviewSections } from '../lib/interview-history.ts';
import type { SavedInterview } from '../lib/local/store.ts';

const record = (overrides: Partial<SavedInterview> = {}): SavedInterview => ({
  id: 'record-history-1',
  createdAt: 1,
  updatedAt: 2,
  candidate: '候选人',
  role: 'AI 产品经理',
  requirements: '岗位要求',
  dimensionText: '评估维度',
  focus: '自驱力',
  resumeText: '简历',
  resumeName: 'resume.docx',
  resumeReading: null,
  transcript: '面试记录',
  reviewed: false,
  report: null,
  conclusion: '',
  confirmed: false,
  ...overrides,
});

void test('history comparison names changed product sections without exposing JSON', () => {
  assert.deepEqual(
    changedInterviewSections(
      record(),
      record({ transcript: '更新后的记录', conclusion: '建议录用' }),
    ),
    ['面试记录', '人工结论'],
  );
});

void test('record management exposes history conflicts and recoverable trash', async () => {
  const [library, history, styles] = await Promise.all([
    readFile(new URL('../components/interview/local-library.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/interview/interview-history.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  ]);
  assert.match(library, /版本历史/);
  assert.match(library, /冲突/);
  assert.match(library, /回收站/);
  assert.match(history, /恢复为新版本/);
  assert.match(history, /本地副本另存/);
  assert.match(history, /保留云端/);
  assert.match(history, /删除的记录会保留 30 天/);
  assert.doesNotMatch(history, /JSON\.stringify\([^)]*record/);
  assert.match(styles, /\.history-layout/);
  assert.match(styles, /@media \(max-width: 760px\)/);
});
