import { followUpGroupFixture } from './fixtures/follow-up-outline.ts';
import { changedInterviewSections } from '../lib/interview-history.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalStore, type SavedInterview } from '../lib/local/store.ts';
import {
  InterviewSyncConflict,
  cloudVersionReason,
  migrateAndSyncInterviews,
  pullCloudInterviews,
  syncInterviewOutbox,
  type InterviewSyncTransport,
} from '../lib/interview-sync.ts';

const record: SavedInterview = {
  id: 'sync-record-12345',
  createdAt: 100,
  updatedAt: 100,
  candidate: '同步候选人',
  role: 'AI 产品经理（校招）',
  requirements: '理解用户并推动方案',
  dimensionText: '自驱力、学习力、产品思维',
  focus: '成长潜力',
  resumeText: '姓名：同步候选人。',
  resumeName: '简历.pdf',
  resumeReading: null,
  transcript: '',
  reviewed: false,
  report: null,
  conclusion: '',
  confirmed: false,
};

function transport(initial: Array<{ record: SavedInterview; revision: number }> = []) {
  const records = new Map(
    initial.map((item) => [item.record.id, { ...item, deletedAt: null as number | null }]),
  );
  const calls: string[] = [];
  const value: InterviewSyncTransport = {
    async list() {
      return [...records.values()]
        .filter(({ deletedAt }) => deletedAt === null)
        .map(({ record, revision, deletedAt }) => ({
          id: record.id,
          candidate: record.candidate,
          role: record.role,
          status: 'preparing' as const,
          groupId: record.groupId || null,
          revision,
          createdAt: record.createdAt || record.updatedAt,
          updatedAt: record.updatedAt,
          deletedAt,
        }));
    },
    async get(id) {
      const found = records.get(id);
      if (!found) throw new Error('missing');
      return found;
    },
    async put(id, baseRevision, mutationId, next, reason) {
      calls.push(`put:${id}:${baseRevision}:${mutationId}:${reason}`);
      const found = records.get(id);
      const currentRevision = found?.revision || 0;
      if (currentRevision !== baseRevision)
        throw new InterviewSyncConflict({
          id,
          candidate: found!.record.candidate,
          role: found!.record.role,
          status: 'preparing',
          groupId: found!.record.groupId || null,
          revision: currentRevision,
          createdAt: found!.record.createdAt || found!.record.updatedAt,
          updatedAt: found!.record.updatedAt,
          deletedAt: null,
        });
      const saved = { record: next, revision: currentRevision + 1, deletedAt: null };
      records.set(id, saved);
      return saved;
    },
    async remove(id, baseRevision, mutationId) {
      calls.push(`delete:${id}:${baseRevision}:${mutationId}`);
      const found = records.get(id);
      if (!found) throw new Error('missing');
      if (found.revision !== baseRevision)
        throw new InterviewSyncConflict({
          id,
          candidate: found.record.candidate,
          role: found.record.role,
          status: 'preparing',
          groupId: found.record.groupId || null,
          revision: found.revision,
          createdAt: found.record.createdAt || found.record.updatedAt,
          updatedAt: found.record.updatedAt,
          deletedAt: found.deletedAt,
        });
      const saved = { ...found, revision: found.revision + 1, deletedAt: Date.now() };
      records.set(id, saved);
      return saved;
    },
  };
  return { value, records, calls };
}

void test('local sync outbox coalesces edits and stores the confirmed revision', async () => {
  const store = createLocalStore(new IDBFactory(), 'sync-success');
  await store.saveInterview(record);
  await store.queueInterviewSync(record, 'periodic-edit');
  await store.queueInterviewSync(
    { ...record, candidate: '最新候选人', updatedAt: 200 },
    'resume-read',
  );
  assert.equal((await store.listPendingSync()).length, 1);
  assert.equal((await store.listPendingSync())[0].record?.candidate, '最新候选人');
  assert.equal((await store.listPendingSync())[0].reason, 'resume-read');

  const remote = transport();
  await syncInterviewOutbox(store, remote.value);
  assert.equal((await store.listPendingSync()).length, 0);
  assert.equal((await store.getSyncMeta(record.id))?.revision, 1);
  assert.equal(remote.records.get(record.id)?.record.candidate, '最新候选人');
  assert.equal(remote.calls.length, 1);
});

void test('network failure retains the latest local outbox entry', async () => {
  const store = createLocalStore(new IDBFactory(), 'sync-offline');
  await store.saveInterview(record);
  await store.queueInterviewSync(record, 'periodic-edit');
  const remote = transport().value;
  remote.put = async () => {
    throw new TypeError('offline');
  };
  await assert.rejects(syncInterviewOutbox(store, remote), /offline/);
  assert.equal((await store.listPendingSync()).length, 1);
  assert.equal(await store.getSyncMeta(record.id), undefined);
});

void test('a stale cloud delete rebases once and still moves the server record to trash', async () => {
  const store = createLocalStore(new IDBFactory(), 'sync-delete-conflict');
  await store.saveRemoteInterview(record, 1);
  await store.queueInterviewDelete(record);
  const remoteRecord = {
    ...record,
    updatedAt: 200,
    conclusion: '另一页面刚保存的备注',
  };
  const remote = transport([{ record: remoteRecord, revision: 2 }]);

  await syncInterviewOutbox(store, remote.value);

  assert.ok(remote.records.get(record.id)?.deletedAt);
  assert.equal(remote.calls.length, 2);
  assert.match(remote.calls[0], /delete:sync-record-12345:1:/);
  assert.match(remote.calls[1], /delete:sync-record-12345:2:/);
  assert.equal((await store.listPendingSync()).length, 0);
  assert.equal((await store.getSyncMeta(record.id))?.revision, 3);
  assert.equal((await store.listInterviewConflicts()).length, 0);
});

void test('atomic conflict save preserves a coalesced outbox with the same mutation id', async () => {
  const store = createLocalStore(new IDBFactory(), 'sync-conflict-coalesced');
  await store.saveInterview(record);
  await store.setSyncMeta(record.id, 5);
  await store.queueInterviewSync(record, 'periodic-edit');
  const captured = (await store.listPendingSync())[0];
  await new Promise((resolve) => setTimeout(resolve, 2));
  await store.queueInterviewSync(
    { ...record, focus: '等待期间的新修改', updatedAt: 200 },
    'periodic-edit',
  );
  const coalesced = (await store.listPendingSync())[0];
  assert.equal(coalesced.mutationId, captured.mutationId);
  assert.ok(coalesced.queuedAt > captured.queuedAt);

  await store.saveInterviewConflictAndDropPending(
    { ...record, transcript: '本页冲突' },
    { ...record, transcript: '云端冲突' },
    'conflict-coalesced',
    captured,
  );
  assert.equal((await store.listInterviewConflicts())[0].id, 'conflict-coalesced');
  assert.equal(
    (await store.listPendingSync())[0].record?.focus,
    '等待期间的新修改',
  );
});

void test('atomic conflict save deletes only an exactly matching captured outbox', async () => {
  const store = createLocalStore(new IDBFactory(), 'sync-conflict-exact');
  await store.saveInterview(record);
  await store.setSyncMeta(record.id, 5);
  await store.queueInterviewSync(record, 'periodic-edit');
  const captured = (await store.listPendingSync())[0];

  await store.saveInterviewConflictAndDropPending(
    { ...record, transcript: '本页冲突' },
    { ...record, transcript: '云端冲突' },
    'conflict-exact',
    captured,
  );
  assert.equal((await store.listPendingSync()).length, 0);
  assert.equal((await store.listInterviewConflicts())[0].id, 'conflict-exact');
});

void test('a write queued after atomic conflict cleanup remains pending', async () => {
  const store = createLocalStore(new IDBFactory(), 'sync-conflict-later-write');
  await store.saveInterview(record);
  await store.setSyncMeta(record.id, 5);
  await store.queueInterviewSync(record, 'periodic-edit');
  const captured = (await store.listPendingSync())[0];
  await store.saveInterviewConflictAndDropPending(
    { ...record, transcript: '本页冲突' },
    { ...record, transcript: '云端冲突' },
    'conflict-before-later-write',
    captured,
  );

  await store.queueInterviewSync(
    { ...record, focus: '事务完成后的新修改', updatedAt: 300 },
    'periodic-edit',
  );
  const pending = await store.listPendingSync();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].record?.focus, '事务完成后的新修改');
});

void test('revision conflict preserves local content and installs the cloud record', async () => {
  const store = createLocalStore(new IDBFactory(), 'sync-conflict');
  const cloud = { ...record, candidate: '云端候选人', updatedAt: 300 };
  await store.saveInterview(record);
  await store.setSyncMeta(record.id, 1);
  await store.queueInterviewSync(
    { ...record, candidate: '本地候选人', updatedAt: 400 },
    'periodic-edit',
  );
  const remote = transport([{ record: cloud, revision: 2 }]);
  await syncInterviewOutbox(store, remote.value);
  assert.equal((await store.listPendingSync()).length, 0);
  assert.equal((await store.getInterview(record.id))?.candidate, '云端候选人');
  assert.equal((await store.getSyncMeta(record.id))?.revision, 2);
  const conflicts = await store.listInterviewConflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].local.candidate, '本地候选人');
  assert.equal(conflicts[0].remote.candidate, '云端候选人');
});

void test('first migration uploads local records and then pulls cloud-only records', async () => {
  const store = createLocalStore(new IDBFactory(), 'sync-migration');
  const cloudOnly = { ...record, id: 'cloud-only-12345', candidate: '云端已有记录' };
  await store.saveInterview(record);
  const remote = transport([{ record: cloudOnly, revision: 4 }]);
  await migrateAndSyncInterviews(store, remote.value);
  assert.equal(await store.isCloudMigrationComplete(), true);
  assert.equal(remote.records.get(record.id)?.revision, 1);
  assert.equal((await store.getInterview(cloudOnly.id))?.candidate, '云端已有记录');

  await migrateAndSyncInterviews(store, remote.value);
  assert.equal(remote.calls.filter((call) => call.startsWith('put:')).length, 1);
});

void test('a remotely deleted record is removed from the local active list', async () => {
  const store = createLocalStore(new IDBFactory(), 'sync-remote-delete');
  const remote = transport([{ record, revision: 1 }]);
  await store.saveRemoteInterview(record, 1);
  remote.records.delete(record.id);
  await pullCloudInterviews(store, remote.value);
  assert.equal(await store.getInterview(record.id), undefined);
  assert.equal((await store.getSyncMeta(record.id))?.revision, 1);
});

void test('business milestones choose durable version reasons', () => {
  assert.equal(
    cloudVersionReason(record, { ...record, confirmed: true }),
    'manually-confirmed',
  );
  assert.equal(
    cloudVersionReason(record, {
      ...record,
      transcript: '新导入记录',
      transcriptName: '记录.txt',
    }),
    'transcript-imported',
  );
  assert.equal(
    cloudVersionReason(record, { ...record, candidate: '普通编辑' }),
    'periodic-edit',
  );
});

void test('follow-up group deletion has a history reason and belongs to outline changes', () => {
  const previous = { ...record, outlineSupplements: [followUpGroupFixture()] };
  assert.equal(
    cloudVersionReason(previous, record),
    'follow-up-outline-deleted',
  );
  assert.equal(
    cloudVersionReason(record, { ...record, outlineSupplements: [] }),
    'periodic-edit',
  );
  assert.deepEqual(changedInterviewSections(record, previous), [
    '简历阅读与提纲',
  ]);
  assert.deepEqual(
    changedInterviewSections(record, {
      ...previous,
      resumeReading: { summary: 'changed' } as SavedInterview['resumeReading'],
    }),
    ['简历阅读与提纲'],
  );
});
