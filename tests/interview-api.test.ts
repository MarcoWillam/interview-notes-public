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

void test('handoff account discovery returns active accounts except the caller', async () => {
  const { store, alice, call } = setup();
  try {
    store.setUserActive('bob', false);
    const response = await call(alice, '/api/handoff-accounts');
    assert.equal(response.status, 200);
    assert.deepEqual(await responseJson(response), {
      accounts: [{ username: 'owner' }],
    });
  } finally {
    store.close();
  }
});

void test('owner hands off one clean initial interview snapshot', async () => {
  const { store, alice, owner, call } = setup();
  try {
    const prepared = {
      ...record,
      id: 'owner-source-12345',
      hasWrittenTest: true,
      writtenTestConfirmed: true,
      resumeReading: {
        candidateName: '接口候选人',
        summary: '已阅读',
        sections: [],
        followUps: [],
      },
      transcript: '旧面试记录',
      reviewed: true,
      report: null,
      conclusion: '旧结论',
      confirmed: true,
    } satisfies CloudInterview;
    await call(owner, `/api/interviews/${prepared.id}`, 'PUT', {
      baseRevision: 0,
      mutationId: 'handoff-source-create-1',
      record: prepared,
    });

    const response = await call(
      owner,
      `/api/interviews/${prepared.id}/handoff`,
      'POST',
      {
        targetUsername: 'alice',
        stage: 'initial',
        sourceRevision: 1,
        mutationId: 'handoff-initial-12345',
      },
    );
    assert.equal(response.status, 201);
    const result = await responseJson<{
      handoff: {
        stage: string;
        targetUsername: string;
        targetInterviewId: string;
      };
    }>(response);
    assert.equal(result.handoff.stage, 'initial');
    assert.equal(result.handoff.targetUsername, 'alice');

    const target = await responseJson<{ record: CloudInterview }>(
      await call(
        alice,
        `/api/interviews/${result.handoff.targetInterviewId}`,
      ),
    );
    assert.equal(target.record.candidate, prepared.candidate);
    assert.equal(target.record.resumeText, prepared.resumeText);
    assert.equal(target.record.hasWrittenTest, true);
    assert.equal(target.record.resumeReading, null);
    assert.equal(target.record.transcript, '');
    assert.equal(target.record.confirmed, false);
    assert.equal(
      (await call(owner, `/api/interviews/${result.handoff.targetInterviewId}`))
        .status,
      404,
    );
    assert.equal(
      (
        await responseJson<{ record: CloudInterview }>(
          await call(owner, `/api/interviews/${prepared.id}`),
        )
      ).record.conclusion,
      '旧结论',
    );

    const listed = await responseJson<{
      handoffs: Array<{ targetUsername: string; targetInterviewId: string }>;
    }>(await call(owner, `/api/interviews/${prepared.id}/handoffs`));
    assert.deepEqual(listed.handoffs, [result.handoff]);

    const duplicate = await call(
      owner,
      `/api/interviews/${prepared.id}/handoff`,
      'POST',
      {
        targetUsername: 'alice',
        stage: 'initial',
        sourceRevision: 1,
        mutationId: 'handoff-initial-other',
      },
    );
    assert.equal(duplicate.status, 409);
  } finally {
    store.close();
  }
});

void test('confirmed initial interview owner hands off an independent second round', async () => {
  const { store, alice, bob, call } = setup();
  try {
    const completed = {
      ...record,
      id: 'completed-source-12345',
      transcript: '候选人：我主动发起了校园项目。',
      transcriptName: '初试记录.md',
      conclusion: '建议进入复试。',
      confirmed: true,
    } satisfies CloudInterview;
    await call(alice, `/api/interviews/${completed.id}`, 'PUT', {
      baseRevision: 0,
      mutationId: 'handoff-source-create-2',
      record: completed,
    });
    const response = await call(
      alice,
      `/api/interviews/${completed.id}/handoff`,
      'POST',
      {
        targetUsername: 'bob',
        stage: 'second',
        sourceRevision: 1,
        mutationId: 'handoff-second-12345',
      },
    );
    assert.equal(response.status, 201);
    const result = await responseJson<{
      handoff: { targetInterviewId: string; targetUsername: string };
    }>(response);
    const target = await responseJson<{ record: CloudInterview }>(
      await call(bob, `/api/interviews/${result.handoff.targetInterviewId}`),
    );
    assert.equal(target.record.interviewStage, 'second');
    assert.equal(target.record.priorRoundSource, 'bole-markdown');
    assert.match(target.record.priorRoundText || '', /建议进入复试/);
    assert.equal(target.record.transcript, '');
    assert.equal(target.record.confirmed, false);
  } finally {
    store.close();
  }
});

void test('standalone second-round preparation can be handed off as an independent second round', async () => {
  const { store, alice, bob, call } = setup();
  try {
    const prepared = {
      ...record,
      id: 'standalone-second-source-12345',
      interviewStage: 'second',
      priorRoundSource: 'external',
      priorRoundText: '# 外部初试记录\n\n候选人完成了初试。',
      priorRoundName: '外部初试记录.txt',
      priorRoundDigest: null,
      secondRoundOutline: {
        version: 1,
        recommendedMinutes: { min: 45, max: 60 },
        summary: '继续验证候选人的判断与取舍。',
        requiredQuestions: [
          {
            id: 'required-1',
            question: '如果重新做一次，你会先改变哪个关键决定？',
            dimensions: ['自驱力'],
            goal: '验证复盘深度。',
            priorEvidence: '候选人已介绍原方案。',
            resumeEvidence: null,
            relatedInitialQuestion: '你当时为什么这样设计？',
            difference: '从复述方案转为验证反事实思考。',
            listenFor: ['能说明调整依据。'],
            riskSignals: ['只给笼统结论。'],
            probes: ['什么信息会让你改变答案？'],
          },
        ],
        reserveQuestions: [],
      },
      transcript: '不应派发的旧复试记录',
      conclusion: '不应派发的旧复试结论',
    } satisfies CloudInterview;
    await call(alice, `/api/interviews/${prepared.id}`, 'PUT', {
      baseRevision: 0,
      mutationId: 'handoff-standalone-source-create',
      record: prepared,
    });

    const response = await call(
      alice,
      `/api/interviews/${prepared.id}/handoff`,
      'POST',
      {
        targetUsername: 'bob',
        stage: 'second',
        sourceRevision: 1,
        mutationId: 'handoff-standalone-second',
      },
    );

    assert.equal(response.status, 201);
    const result = await responseJson<{
      handoff: { targetInterviewId: string; targetUsername: string };
    }>(response);
    const target = await responseJson<{ record: CloudInterview }>(
      await call(bob, `/api/interviews/${result.handoff.targetInterviewId}`),
    );
    assert.equal(target.record.interviewStage, 'second');
    assert.equal(target.record.priorRoundSource, 'external');
    assert.equal(target.record.priorRoundText, prepared.priorRoundText);
    assert.equal(target.record.priorRoundName, prepared.priorRoundName);
    assert.deepEqual(
      target.record.secondRoundOutline,
      prepared.secondRoundOutline,
    );
    assert.equal(target.record.transcript, '');
    assert.equal(target.record.conclusion, '');
    assert.equal(target.record.confirmed, false);
  } finally {
    store.close();
  }
});

void test('handoff rejects unauthorized initial, incomplete second and invalid targets', async () => {
  const { store, alice, call } = setup();
  try {
    await call(alice, `/api/interviews/${record.id}`, 'PUT', {
      baseRevision: 0,
      mutationId: 'handoff-source-create-3',
      record,
    });
    const send = (targetUsername: string, stage: 'initial' | 'second') =>
      call(alice, `/api/interviews/${record.id}/handoff`, 'POST', {
        targetUsername,
        stage,
        sourceRevision: 1,
        mutationId: `handoff-denied-${targetUsername}-${stage}`,
      });
    assert.equal((await send('bob', 'initial')).status, 403);
    assert.equal((await send('bob', 'second')).status, 409);
    assert.equal((await send('alice', 'second')).status, 400);
    store.setUserActive('bob', false);
    assert.equal((await send('bob', 'second')).status, 409);
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
