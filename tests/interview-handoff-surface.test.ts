import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

void test('workbench offers initial and second-round handoff from the session summary', async () => {
  const [page, summary] = await Promise.all([
    readFile(new URL('app/page.tsx', root), 'utf8'),
    readFile(
      new URL('components/interview/interview-session-summary.tsx', root),
      'utf8',
    ),
  ]);

  assert.match(page, /workspaceAccount\?\.owner[\s\S]*?\? 'initial'/);
  assert.match(page, /confirmed[\s\S]*?\? 'second'/);
  assert.match(
    page,
    /interviewStage === 'second'[\s\S]{0,120}?confirmed[\s\S]{0,80}?null[\s\S]{0,80}?'second'/,
  );
  assert.match(page, /<InterviewHandoffDialog/);
  assert.match(page, /library\.flushForTask\(\)/);
  assert.match(summary, /派发初试|handoffLabel/);
  assert.match(summary, /onHandoff/);
});

void test('handoff dialog explains snapshot delivery and prevents a second dispatch', async () => {
  const dialog = await readFile(
    new URL('components/interview/interview-handoff-dialog.tsx', root),
    'utf8',
  );

  assert.match(dialog, /选择接收面试官/);
  assert.match(dialog, /独立副本/);
  assert.match(dialog, /原始简历附件和作品 ZIP 不会传输/);
  assert.match(dialog, /\/api\/handoff-accounts/);
  assert.match(dialog, /\/handoffs/);
  assert.match(dialog, /sourceRevision/);
  assert.match(dialog, /mutationId/);
  assert.match(dialog, /已派发给/);
  assert.match(dialog, /disabled=\{pending \|\| !targetUsername \|\| !!existing\}/);
});

void test('handoff controls keep a compact responsive layout', async () => {
  const styles = await readFile(new URL('app/globals.css', root), 'utf8');
  assert.match(styles, /\.interview-session-actions\s*\{/);
  assert.match(styles, /\.interview-handoff-dialog\s*\{/);
  assert.match(styles, /\.handoff-snapshot-note\s*\{/);
  assert.match(styles, /\.handoff-dialog-actions\s*\{/);
});
