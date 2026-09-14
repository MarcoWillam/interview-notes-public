import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalStore, type SavedInterview } from '../lib/local/store.ts';
import {
  InterviewSyncConflict,
  migrateAndSyncInterviews,
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
      if (!found || found.revision !== baseRevision) throw new Error('stale');
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
