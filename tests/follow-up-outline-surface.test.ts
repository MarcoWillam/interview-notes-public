import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeRequestedFocus } from '../lib/follow-up-outline.ts';

void test('follow-up focus counts emoji by Unicode code point', () => {
  const focus = '😀'.repeat(101);
  assert.equal(Array.from(normalizeRequestedFocus(focus)).length, 101);
  assert.throws(() => normalizeRequestedFocus('😀'.repeat(201)));
});

void test('follow-up outline surface exposes an accessible focused-generation dialog', async () => {
  const source = await readFile(
    new URL(
      '../components/interview/follow-up-outline-view.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /补充追问/);
  assert.match(source, /需要补问的维度或关注点/);
  assert.doesNotMatch(source, /maxLength=\{200\}/);
  assert.match(source, /Array\.from\(value\)\.length/);
  assert.match(source, /normalizeRequestedFocus/);
  assert.match(source, /2 道/);
  assert.match(source, /简历[\s\S]*现有面试提纲/);
  assert.match(source, /不.*修改.*原/);
  assert.match(source, /DialogTitle/);
  assert.match(source, /DialogFooter/);
});

void test('follow-up groups retain their own question details and deletion confirmation', async () => {
  const source = await readFile(
    new URL(
      '../components/interview/follow-up-outline-view.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /left\.createdAt\s*-\s*right\.createdAt/);
  assert.match(source, /requestedFocus/);
  assert.match(source, /createdAt/);
  assert.match(source, /group\.questions\.map/);
  assert.match(source, /<details>/);
  assert.match(source, /riskSignals/);
  assert.match(source, /probe\.condition/);
  assert.match(source, /删除本组/);
  assert.match(source, /AlertDialogTitle/);
  assert.match(source, /不会修改原面试提纲/);
});

void test('resume reading places follow-up groups after either outline and before actions', async () => {
  const source = await readFile(
    new URL('../components/interview/resume-reading-view.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /groups\?: readonly FollowUpOutlineGroup\[\]/);
  assert.match(source, /busy\?: boolean/);
  assert.match(source, /draft\?: string/);
  assert.match(source, /onGenerate\?:/);
  assert.match(source, /onDelete\?:/);
  const mainOutline = source.indexOf(
    '<InterviewOutlineV2View outline={value.outline} />',
  );
  const legacyOutline = source.indexOf('!value.outline && !!questions.length');
  const followUps = source.indexOf('<FollowUpOutlineView');
  const writtenAction = source.indexOf('written-test-supplement-action');
  assert.ok(mainOutline >= 0 && followUps > mainOutline);
  assert.ok(legacyOutline >= 0 && followUps > legacyOutline);
  assert.match(source, /value\.outline \|\| !!questions\.length/);
  assert.ok(writtenAction < 0 || followUps < writtenAction);
});

void test('follow-up surface styles fit groups and stacked dialog actions on narrow screens', async () => {
  const css = await readFile(
    new URL('../app/globals.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /\.follow-up-outline/);
  assert.match(css, /\.follow-up-outline-group/);
  assert.match(css, /\.follow-up-outline-dialog/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  const followUpStylesStart = css.indexOf('.follow-up-outline {');
  const stylesAt760Start = css.indexOf(
    '@media (max-width: 760px)',
    followUpStylesStart,
  );
  const stylesAt760 = css.slice(
    stylesAt760Start,
    css.indexOf('@media (max-width: 480px)', stylesAt760Start),
  );
  assert.match(
    stylesAt760,
    /follow-up-outline-dialog \[data-slot='dialog-footer'\][\s\S]*flex-direction:\s*column-reverse/,
  );
  assert.match(
    stylesAt760,
    /follow-up-outline-delete-dialog \[data-slot='alert-dialog-footer'\][\s\S]*width:\s*100%/,
  );
  assert.match(
    css,
    /follow-up-outline-dialog[\s\S]*\[data-slot='dialog-footer'\]/,
  );
});
