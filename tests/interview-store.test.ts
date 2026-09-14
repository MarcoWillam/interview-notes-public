import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueueStore } from '../server/queue/store.ts';
import {
  InterviewStore,
  InterviewStoreError,
  RevisionConflict,
} from '../server/interviews/store.ts';
import type { CloudInterview } from '../lib/cloud-interview.ts';

const baseRecord: CloudInterview = {
  id: 'record-12345678',
  createdAt: 100,
  updatedAt: 100,
  candidate: '测试候选人',
  role: 'AI 产品经理（校招）',
  requirements: '理解用户问题并推动方案落地',
  dimensionText: '自驱力、学习力、产品思维',
  focus: '潜力与可培养性',
  resumeText: '姓名：测试候选人。负责校园项目。',
  resumeName: '测试候选人简历.pdf',
  resumeReading: null,
  transcript: '',
  reviewed: false,
  report: null,
  conclusion: '',
  confirmed: false,
};

function setup() {
  let now = 1_000_000;
  const queue = new QueueStore(':memory:', () => now);
  const alice = queue.createUser('alice', 'password-alice-123').id;
  const bob = queue.createUser('bob', 'password-bob-123').id;
  const records = new InterviewStore(queue.db, () => now);
  return {
    queue,
    records,
    alice,
    bob,
    tick: (milliseconds: number) => (now += milliseconds),
  };
}

void test('records are account scoped, revision checked and mutation idempotent', () => {
  const { queue, records, alice, bob } = setup();
  try {
    const created = records.put(
      alice,
      baseRecord.id,
      0,
      'mutation-create-123',
      baseRecord,
      'periodic-edit',
    );
    assert.equal(created.revision, 1);
    assert.equal(created.record.candidate, '测试候选人');
    assert.equal(
      records.put(
        alice,
        baseRecord.id,
        0,
        'mutation-create-123',
        baseRecord,
        'periodic-edit',
      ).revision,
      1,
    );
    assert.throws(() => records.get(bob, baseRecord.id), InterviewStoreError);
    assert.deepEqual(records.list(bob), []);
    assert.throws(
      () =>
        records.put(
          alice,
          baseRecord.id,
          0,
          'mutation-stale-123',
          { ...baseRecord, candidate: '错误覆盖' },
          'periodic-edit',
        ),
      RevisionConflict,
    );
    const updated = records.put(
      alice,
      baseRecord.id,
      1,
      'mutation-update-123',
      { ...baseRecord, candidate: '更新后的候选人', updatedAt: 200 },
      'resume-read',
    );
    assert.equal(updated.revision, 2);
    assert.equal(records.get(alice, baseRecord.id).record.candidate, '更新后的候选人');
  } finally {
    queue.close();
  }
});

void test('key versions persist while periodic snapshots are throttled', () => {
  const { queue, records, alice, tick } = setup();
  try {
    let current = records.put(
      alice,
      baseRecord.id,
      0,
      'mutation-version-0',
      baseRecord,
      'periodic-edit',
    );
    tick(60_000);
    current = records.put(
      alice,
      baseRecord.id,
      current.revision,
      'mutation-version-1',
      { ...baseRecord, updatedAt: 101, transcript: '一分钟后的编辑' },
      'periodic-edit',
    );
    tick(60_000);
    current = records.put(
      alice,
      baseRecord.id,
      current.revision,
      'mutation-version-2',
      { ...baseRecord, updatedAt: 102, transcript: '关键节点内容' },
      'transcript-imported',
    );
    assert.deepEqual(
      records.versions(alice, baseRecord.id).map(({ reason }) => reason),
      ['transcript-imported', 'periodic-edit'],
    );
    assert.equal(
      records.version(alice, baseRecord.id, current.revision).record.transcript,
      '关键节点内容',
    );
    const restored = records.restoreVersion(
      alice,
      baseRecord.id,
      current.revision,
      current.revision,
      'mutation-restore-123',
    );
    assert.equal(restored.revision, current.revision + 1);
    assert.equal(records.versions(alice, baseRecord.id)[0].reason, 'restored');
  } finally {
    queue.close();
  }
});

void test('soft deletion restores during retention and purge removes related data', () => {
  const { queue, records, alice, tick } = setup();
  try {
    const created = records.put(
      alice,
      baseRecord.id,
      0,
      'mutation-delete-create',
      baseRecord,
      'resume-read',
    );
    const deleted = records.remove(
      alice,
      baseRecord.id,
      created.revision,
      'mutation-delete-123',
    );
    assert.ok(deleted.deletedAt);
    assert.deepEqual(records.list(alice), []);
    assert.equal(records.list(alice, true).length, 1);
    const restored = records.restoreDeleted(
      alice,
      baseRecord.id,
      deleted.revision,
      'mutation-undelete-123',
    );
    assert.equal(restored.deletedAt, null);
    const removedAgain = records.remove(
      alice,
      baseRecord.id,
      restored.revision,
      'mutation-delete-again',
    );
    tick(30 * 86_400_000 + 1);
    records.sweep();
    assert.throws(() => records.get(alice, baseRecord.id, true), /不存在/);
    assert.equal(removedAgain.deletedAt! < Date.now(), true);
  } finally {
    queue.close();
  }
});

void test('workspace and pending results remain private to the account', () => {
  const { queue, records, alice, bob } = setup();
  try {
    records.put(
      alice,
      baseRecord.id,
      0,
      'mutation-pending-create',
      baseRecord,
      'periodic-edit',
    );
    const workspace = records.putWorkspace(alice, 0, 'workspace-mutation-1', {
      groups: [{ id: 'group-12345678', name: '待复试', createdAt: 1, order: 0 }],
      sortMode: 'manual',
      manualOrder: [baseRecord.id],
      collapsedGroupIds: [],
    });
    assert.equal(workspace.revision, 1);
    assert.deepEqual(records.workspace(alice), workspace);
    assert.equal(records.workspace(bob).revision, 0);

    records.savePendingResult(
      alice,
      baseRecord.id,
      'job-12345678',
      'interview',
      1,
      { summary: '待确认结果' },
    );
    assert.equal(records.pendingResults(alice, baseRecord.id).length, 1);
    assert.equal(records.pendingResults(bob, baseRecord.id).length, 0);
    records.discardPendingResult(alice, baseRecord.id, 'job-12345678');
    assert.equal(records.pendingResults(alice, baseRecord.id)[0].state, 'discarded');
  } finally {
    queue.close();
  }
});
