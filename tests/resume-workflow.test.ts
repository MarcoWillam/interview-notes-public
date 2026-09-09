import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCandidateName } from '../lib/resume-workflow.ts';

void test('fills an empty candidate from the resume name', () => {
  assert.deepEqual(reconcileCandidateName('', '张晓明'), {
    kind: 'fill',
    value: '张晓明',
  });
});

void test('keeps the current candidate when the names match', () => {
  assert.deepEqual(reconcileCandidateName('张晓明', '张晓明'), {
    kind: 'keep',
  });
});

void test('requires an explicit choice when the names conflict', () => {
  assert.deepEqual(reconcileCandidateName('张明', '张晓明'), {
    kind: 'confirm',
    current: '张明',
    detected: '张晓明',
  });
});

void test('keeps the current candidate when detection is absent or blank', () => {
  for (const detected of [null, undefined, '', '  ']) {
    assert.deepEqual(reconcileCandidateName('张明', detected), {
      kind: 'keep',
    });
    assert.deepEqual(reconcileCandidateName('', detected), { kind: 'keep' });
  }
});

void test('trims both names before comparing and returning a resolution', () => {
  assert.deepEqual(reconcileCandidateName('  ', ' 张晓明\n'), {
    kind: 'fill',
    value: '张晓明',
  });
  assert.deepEqual(reconcileCandidateName(' 张晓明 ', '\n张晓明'), {
    kind: 'keep',
  });
  assert.deepEqual(reconcileCandidateName(' 张明 ', ' 张晓明 '), {
    kind: 'confirm',
    current: '张明',
    detected: '张晓明',
  });
});
