import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueueStore } from '../server/queue/store.ts';
import { queueApi } from '../server/queue/api.ts';
import type { CloudInterview } from '../lib/cloud-interview.ts';

const origin = 'https://interview.example';
const responseJson = <T>(response: Response) => response.json() as Promise<T>;
const record: CloudInterview = {
  id: 'record-api-12345',
  createdAt: 100,
  updatedAt: 100,
  candidate: '接口候选人',
  role: '产品运营（校招）',
  requirements: '用户运营与数据增长',
  dimensionText: '自驱力、学习力、用户运营',
  focus: '成长潜力',
  resumeText: '姓名：接口候选人。组织过校园活动。',
  resumeName: '简历.docx',
  resumeReading: null,
  transcript: '',
  reviewed: false,
  report: null,
  conclusion: '',
  confirmed: false,
};

function setup() {
  const store = new QueueStore(':memory:');
  const alice = store.createUser('alice', 'password-alice-123').id;
  const bob = store.createUser('bob', 'password-bob-123').id;
  const owner = store.createUser('owner', 'password-owner-123').id;
  const api = queueApi(store, { origin });
  const tokens = new Map([
    [alice, store.newSession(alice)],
    [bob, store.newSession(bob)],
    [owner, store.newSession(owner)],
  ]);
  const call = (
    user: string,
    path: string,
    method = 'GET',
    body?: unknown,
  ) =>
    api(
      new Request(origin + path, {
        method,
        headers: {
          Origin: origin,
          Cookie: `interview_session=${tokens.get(user)}`,
          'X-Interview-Account': user,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { store, alice, bob, owner, call };
}

void test('record API creates, lists and isolates the same id per account', async () => {
  const { store, alice, bob, owner, call } = setup();
  try {
    const created = await call(alice, `/api/interviews/${record.id}`, 'PUT', {
      baseRevision: 0,
      mutationId: 'mutation-api-create-a',
      reason: 'periodic-edit',
      record,
    });
    assert.equal(created.status, 201);
    assert.equal((await responseJson<{ revision: number }>(created)).revision, 1);

    const bobRecord = { ...record, candidate: 'Bob 的候选人' };
    assert.equal(
      (
        await call(bob, `/api/interviews/${record.id}`, 'PUT', {
          baseRevision: 0,
          mutationId: 'mutation-api-create-b',
          reason: 'periodic-edit',
          record: bobRecord,
        })
      ).status,
      201,
    );
    const list = await responseJson<{
      interviews: Array<{ candidate: string; content?: unknown }>;
    }>(await call(alice, '/api/interviews'));
    assert.equal(list.interviews.length, 1);
    assert.equal(list.interviews[0].candidate, '接口候选人');
    assert.equal(Object.hasOwn(list.interviews[0], 'content'), false);
    assert.equal(
      (await call(owner, `/api/interviews/${record.id}`)).status,
      404,
    );
    assert.equal(
      (
        await responseJson<{ record: CloudInterview }>(
          await call(bob, `/api/interviews/${record.id}`),
        )
      ).record.candidate,
      'Bob 的候选人',
    );
  } finally {
    store.close();
  }
});

void test('record API returns a current summary for stale revisions', async () => {
  const { store, alice, call } = setup();
  try {
    await call(alice, `/api/interviews/${record.id}`, 'PUT', {
      baseRevision: 0,
      mutationId: 'mutation-api-conflict-1',
      record,
    });
    const conflict = await call(alice, `/api/interviews/${record.id}`, 'PUT', {
      baseRevision: 0,
      mutationId: 'mutation-api-conflict-2',
      record: { ...record, candidate: '不能覆盖' },
    });
    assert.equal(conflict.status, 409);
    const body = await responseJson<{
      error: string;
      current: { revision: number; candidate: string };
    }>(conflict);
    assert.match(body.error, /其他页面更新/);
    assert.equal(body.current.revision, 1);
    assert.equal(body.current.candidate, '接口候选人');
  } finally {
    store.close();
  }
});

void test('record API restores history and soft-deleted records', async () => {
  const { store, alice, call } = setup();
  try {
    await call(alice, `/api/interviews/${record.id}`, 'PUT', {
      baseRevision: 0,
      mutationId: 'mutation-api-history-1',
      reason: 'resume-read',
      record,
    });
    await call(alice, `/api/interviews/${record.id}`, 'PUT', {
      baseRevision: 1,
      mutationId: 'mutation-api-history-2',
      reason: 'transcript-imported',
      record: { ...record, transcript: '候选人：更新后的内容。', updatedAt: 200 },
    });
    const versions = await responseJson<{
      versions: Array<{ revision: number }>;
    }>(await call(alice, `/api/interviews/${record.id}/versions`));
    assert.deepEqual(
      versions.versions.map((item: { revision: number }) => item.revision),
      [2, 1],
    );
    const restored = await call(
      alice,
      `/api/interviews/${record.id}/versions/1/restore`,
      'POST',
      { baseRevision: 2, mutationId: 'mutation-api-history-restore' },
    );
    assert.equal(
      (await responseJson<{ revision: number }>(restored)).revision,
      3,
    );
    const removed = await call(alice, `/api/interviews/${record.id}`, 'DELETE', {
      baseRevision: 3,
      mutationId: 'mutation-api-delete-1',
    });
    assert.equal(removed.status, 200);
    assert.equal((await call(alice, '/api/interviews')).status, 200);
    assert.equal(
      (
        await responseJson<{ interviews: unknown[] }>(
          await call(alice, '/api/interviews'),
        )
      ).interviews.length,
      0,
    );
    const trash = await responseJson<{ interviews: unknown[] }>(
      await call(alice, '/api/interviews?trash=1'),
    );
    assert.equal(trash.interviews.length, 1);
    const recovered = await call(
      alice,
      `/api/interviews/${record.id}/restore`,
      'POST',
      { baseRevision: 4, mutationId: 'mutation-api-delete-restore' },
    );
    assert.equal(
      (await responseJson<{ revision: number }>(recovered)).revision,
      5,
    );
  } finally {
    store.close();
  }
});

void test('workspace and pending result APIs stay account scoped', async () => {
  const { store, alice, bob, call } = setup();
  try {
    await call(alice, `/api/interviews/${record.id}`, 'PUT', {
      baseRevision: 0,
      mutationId: 'mutation-api-pending-create',
      record,
    });
    const workspace = {
      groups: [{ id: 'group-api-12345', name: '复试', createdAt: 1, order: 0 }],
      sortMode: 'manual',
      manualOrder: [record.id],
      collapsedGroupIds: [],
    };
    assert.equal(
      (
        await call(alice, '/api/interview-workspace', 'PUT', {
          baseRevision: 0,
          mutationId: 'mutation-api-workspace',
          workspace,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await responseJson<{ revision: number }>(
          await call(alice, '/api/interview-workspace'),
        )
      ).revision,
      1,
    );
    assert.equal(
      (
        await responseJson<{ revision: number }>(
          await call(bob, '/api/interview-workspace'),
        )
      ).revision,
      0,
    );
    store.interviews.savePendingResult(
      alice,
      record.id,
      'job-api-12345',
      'interview',
      1,
      { summary: '待确认' },
    );
    assert.equal(
      (
        await responseJson<{ results: unknown[] }>(
          await call(alice, `/api/interviews/${record.id}/pending-results`),
        )
      ).results.length,
      1,
    );
    assert.equal(
      (
        await responseJson<{ results: unknown[] }>(
          await call(bob, `/api/interviews/${record.id}/pending-results`),
        )
      ).results.length,
      0,
    );
    assert.equal(
      (
        await call(
          alice,
          `/api/interviews/${record.id}/pending-results/job-api-12345/discard`,
          'POST',
          {},
        )
      ).status,
      200,
    );
  } finally {
    store.close();
  }
});
