import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCandidateNameChange,
  reconcileCandidateName,
} from '../lib/resume-workflow.ts';

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

for (const current of ['', '张明']) {
  void test(`adopting a detected name invalidates the assessment before updating ${current || 'an empty name'}`, () => {
    const record = {
      candidate: current,
      report: { summary: '旧评估' } as { summary: string } | null,
      confirmed: true,
      conclusion: '面试官原有意见',
    };
    applyCandidateNameChange(current, ' 张晓明 ', {
      invalidate() {
        assert.equal(record.candidate, current);
        record.report = null;
        record.confirmed = false;
      },
      setCandidate(name) {
        assert.equal(record.report, null);
        assert.equal(record.confirmed, false);
        record.candidate = name;
      },
    });
    assert.deepEqual(record, {
      candidate: '张晓明',
      report: null,
      confirmed: false,
      conclusion: '面试官原有意见',
    });
  });
}

void test('keeping the current candidate preserves their assessment and confirmation', () => {
  applyCandidateNameChange('张明', ' 张明 ', {
    invalidate() {
      assert.fail('keeping the candidate must not invalidate their assessment');
    },
    setCandidate() {
      assert.fail('keeping the candidate must not rewrite their name');
    },
  });
});
