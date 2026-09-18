import {
  followUpInputFixture,
  followUpResultFixture,
  followUpGroupFixture,
} from './fixtures/follow-up-outline.ts';
import { interviewJobSource, assertInterviewJobInputMatches } from '../lib/interview-job-binding.ts';
import { validateFollowUpOutlineInput } from '../lib/follow-up-outline.ts';
import { validateResumeReading } from '../lib/resume-reading.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { QueueStore } from '../server/queue/store.ts';
import type { CloudInterview } from '../lib/cloud-interview.ts';

const input = {
  role: '产品经理',
  requirements: '用户研究与需求分析',
  dimensionText: '需求分析、沟通协作',
  focus: '主动发现问题并推进解决',
  scoringGuidance: '根据具体行动和结果判断证据充分性',
  reportRequirements: '列明待核实内容',
  resumeText: '姓名：张三。示例大学毕业。我访谈了五位用户。',
  hasWrittenTest: false,
};

const reading = {
  candidateName: '张三',
  candidateNameEvidence: '姓名：张三。',
  summary: '简历自述，待面试核实。',
  sections: ['教育背景', '工作经历', '项目经验', '技能'].map((name) => ({
    name,
    items:
      name === '教育背景'
        ? [{ text: '示例大学毕业', evidence: '示例大学毕业。' }]
        : [],
  })),
  interviewQuestions: Array.from({ length: 6 }, (_, index) => ({
    question: `请说说第${index + 1}次主动推进问题的经历。`,
    dimensions: [index % 2 ? '沟通协作' : '需求分析'],
    reason: '核实具体行动与结果。',
    resumeEvidence: index === 5 ? null : '我访谈了五位用户。',
    questionSource: index === 5 ? ('role' as const) : ('resume' as const),
    listenFor: ['个人行动', '结果与反思'],
    probes: ['你如何验证效果？'],
  })),
  followUps: ['请补充项目时间范围。'],
};

function cloudRecord(id: string): CloudInterview {
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    candidate: '',
    ...input,
    resumeName: 'resume.txt',
    resumeReading: null,
    transcript: '',
    reviewed: false,
    report: null,
    conclusion: '',
    confirmed: false,
    outlineVersion: 1,
    writtenTestConfirmed: true,
  };
}

function setup() {
  let now = 1_000_000;
  const store = new QueueStore(':memory:', () => ++now);
  const user = store.createUser('alice', 'password-alice-123').id;
  const device = store.redeem(store.pairing(user).code, '测试电脑', {
    version: '0.1.16',
    protocol: 4,
  });
  return {
    store,
    user,
    secret: device.token,
    tick: (duration: number) => {
      now += duration;
    },
  };
}

void test('bound Codex result is applied when relevant record sources are unchanged', () => {
  const { store, user, secret } = setup();
  try {
    const record = cloudRecord('record-binding-apply');
    store.interviews.put(user, record.id, 0, 'mutation-create-binding', record);
    store.submit(
      user,
      'client-binding-apply',
      '读取简历',
      input,
      'resume',
      record.id,
      { interviewId: record.id, interviewRevision: 1 },
    );
    const claimed = store.claim(secret, true, ['resume'], { version: '0.1.16', protocol: 4 })!;
    assert.equal(store.finish(secret, claimed.id, claimed.lease, reading).accepted, true);
    const saved = store.interviews.get(user, record.id);
    assert.equal(saved.revision, 2);
    assert.equal(saved.record.candidate, '张三');
    assert.equal(saved.record.resumeReading?.summary, reading.summary);
    assert.equal(store.get(user, claimed.id).resultDisposition, 'applied');
  } finally {
    store.close();
  }
});

void test('bound outline regeneration completes and removes its transient job field', () => {
  const { store, user, secret } = setup();
  try {
    const preparedReading = validateResumeReading(reading, input);
    const record = {
      ...cloudRecord('record-binding-outline'),
      resumeReading: preparedReading,
      outlineRegenerationJobId: 'previous-outline-job',
    };
    const saved = store.interviews.put(
      user,
      record.id,
      0,
      'mutation-create-outline',
      record,
    );
    const outlineInput = {
      role: input.role,
      requirements: input.requirements,
      dimensionText: input.dimensionText,
      focus: input.focus,
      scoringGuidance: input.scoringGuidance,
      reportRequirements: input.reportRequirements,
      resumeText: input.resumeText,
      revision: 'outline-binding-revision',
      interviewQuestions: preparedReading.interviewQuestions,
      writtenTestSupplement: null,
      workSample: null,
    };
    const job = store.submit(
      user,
      'client-binding-outline',
      '重新生成提纲',
      outlineInput,
      'outline',
      record.id,
      { interviewId: record.id, interviewRevision: saved.revision },
    );
    const claimed = store.claim(secret, true, ['outline'], {
      version: '0.1.16',
      protocol: 4,
    })!;
    assert.equal(claimed.id, job.id);
    assert.equal(
      store.finish(secret, claimed.id, claimed.lease, {
        revision: outlineInput.revision,
        interviewQuestions: preparedReading.interviewQuestions,
        writtenTestSupplement: null,
        workSampleQuestions: null,
      }).accepted,
      true,
    );
    assert.equal(store.get(user, job.id).state, 'completed');
    const result = store.interviews.get(user, record.id);
    assert.equal(result.revision, saved.revision + 1);
    assert.equal('outlineRegenerationJobId' in result.record, false);
    assert.equal(result.record.resumeReading?.interviewQuestions?.length, 6);
  } finally {
    store.close();
  }
});

void test('bound task input must match the server record snapshot', () => {
  const { store, user } = setup();
  try {
    const record = cloudRecord('record-binding-mismatch');
    store.interviews.put(user, record.id, 0, 'mutation-create-mismatch', record);
    assert.throws(
      () =>
        store.submit(
          user,
          'client-binding-mismatch',
          '读取其他简历',
          { ...input, resumeText: '姓名：其他候选人。' },
          'resume',
          record.id,
          { interviewId: record.id, interviewRevision: 1 },
        ),
      /任务简历与云端面试记录不一致/,
    );
  } finally {
    store.close();
  }
});

void test('bound interview assessment matches the record dimension array', () => {
  const { store, user } = setup();
  try {
    const record = {
      ...cloudRecord('record-binding-interview'),
      transcript: '候选人：我先访谈用户，再根据反馈调整方案。\n\n  ',
      reviewed: true,
    };
    store.interviews.put(
      user,
      record.id,
      0,
      'mutation-create-interview',
      record,
    );
    assert.doesNotThrow(() =>
      store.submit(
        user,
        'client-binding-interview',
        '生成辅助评估',
        {
          role: record.role,
          requirements: record.requirements,
          transcript: record.transcript.trim(),
          dimensions: ['需求分析', '沟通协作'],
          resumeText: record.resumeText,
          focus: record.focus,
          scoringGuidance: record.scoringGuidance,
          reportRequirements: record.reportRequirements,
        },
        'interview',
        '',
        { interviewId: record.id, interviewRevision: 1 },
      ),
    );
  } finally {
    store.close();
  }
});

void test('relevant edits retain a completed result for confirmation', () => {
  const { store, user, secret } = setup();
  try {
    const record = cloudRecord('record-binding-pending');
    store.interviews.put(user, record.id, 0, 'mutation-create-pending', record);
    store.submit(
      user,
      'client-binding-pending',
      '读取简历',
      input,
      'resume',
      record.id,
      { interviewId: record.id, interviewRevision: 1 },
    );
    const claimed = store.claim(secret, true, ['resume'], { version: '0.1.16', protocol: 4 })!;
    store.interviews.put(
      user,
      record.id,
      1,
      'mutation-change-resume',
      { ...record, resumeText: record.resumeText + '新增经历。', updatedAt: 2 },
    );
    store.finish(secret, claimed.id, claimed.lease, reading);
    assert.equal(store.interviews.get(user, record.id).record.resumeReading, null);
    assert.equal(store.interviews.pendingResults(user, record.id)[0].state, 'pending');
    assert.equal(store.get(user, claimed.id).resultDisposition, 'pending');
    const applied = store.interviews.applyPendingResult(
      user,
      record.id,
      claimed.id,
      2,
      'mutation-apply-pending-result',
    );
    assert.equal(applied.record.resumeReading?.summary, reading.summary);
    assert.equal(store.interviews.pendingResults(user, record.id)[0].state, 'applied');
  } finally {
    store.close();
  }
});

void test('pending result survives the short-lived task queue', () => {
  const { store, user, secret, tick } = setup();
  try {
    const record = cloudRecord('record-binding-retained');
    store.interviews.put(user, record.id, 0, 'mutation-create-retained', record);
    store.submit(
      user,
      'client-binding-retained',
      '读取简历',
      input,
      'resume',
      record.id,
      { interviewId: record.id, interviewRevision: 1 },
    );
    const claimed = store.claim(secret, true, ['resume'], { version: '0.1.16', protocol: 4 })!;
    store.interviews.put(
      user,
      record.id,
      1,
      'mutation-change-retained',
      { ...record, resumeText: record.resumeText + '后来新增。', updatedAt: 3 },
    );
    store.finish(secret, claimed.id, claimed.lease, reading);
    tick(8 * 86_400_000);
    store.sweep();
    assert.throws(() => store.get(user, claimed.id), /任务不存在/);
    assert.equal(store.interviews.pendingResults(user, record.id)[0].state, 'pending');
  } finally {
    store.close();
  }
});

void test('deleting a record during analysis retains the result without restoring it', () => {
  const { store, user, secret } = setup();
  try {
    const record = cloudRecord('record-binding-deleted');
    store.interviews.put(user, record.id, 0, 'mutation-create-deleted', record);
    store.submit(
      user,
      'client-binding-deleted',
      '读取简历',
      input,
      'resume',
      record.id,
      { interviewId: record.id, interviewRevision: 1 },
    );
    const claimed = store.claim(secret, true, ['resume'], { version: '0.1.16', protocol: 4 })!;
    store.interviews.remove(user, record.id, 1, 'mutation-delete-running');
    store.finish(secret, claimed.id, claimed.lease, reading);
    assert.notEqual(store.interviews.get(user, record.id, true).deletedAt, null);
    assert.equal(store.interviews.pendingResults(user, record.id)[0].state, 'pending');
  } finally {
    store.close();
  }
});

void test('unrelated conclusion edits still allow the bound result to apply', () => {
  const { store, user, secret } = setup();
  try {
    const record = cloudRecord('record-binding-unrelated');
    store.interviews.put(user, record.id, 0, 'mutation-create-unrelated', record);
    store.submit(
      user,
      'client-binding-unrelated',
      '读取简历',
      input,
      'resume',
      record.id,
      { interviewId: record.id, interviewRevision: 1 },
    );
    const claimed = store.claim(secret, true, ['resume'], { version: '0.1.16', protocol: 4 })!;
    store.interviews.put(
      user,
      record.id,
      1,
      'mutation-change-conclusion',
      { ...record, conclusion: '面试官备注', updatedAt: 2 },
    );
    store.finish(secret, claimed.id, claimed.lease, reading);
    const saved = store.interviews.get(user, record.id);
    assert.equal(saved.record.conclusion, '面试官备注');
    assert.equal(saved.record.resumeReading?.summary, reading.summary);
  } finally {
    store.close();
  }
});

function followUpRecord(): CloudInterview {
  const {
    requestedFocus: _focus,
    existingSupplements: _groups,
    ...source
  } = followUpInputFixture();
  return {
    ...cloudRecord('record-follow-up-binding'),
    ...structuredClone(source),
    confirmed: true,
    report: { summary: '原有评估' } as unknown as CloudInterview['report'],
  };
}

void test('follow-up binding checks normalized standards, reading, version and supplements', () => {
  const { store, user } = setup();
  try {
    const record = followUpRecord();
    store.interviews.put(user, record.id, 0, 'mutation-follow-up-create', {
      ...record,
      role: ` ${record.role} `,
    });
    const submit = (
      value: ReturnType<typeof followUpInputFixture>,
      client: string,
    ) =>
      store.submit(
        user,
        client,
        '补充追问',
        value,
        'follow-up-outline',
        record.id,
        { interviewId: record.id, interviewRevision: 1 },
      );
    for (const [index, patch] of [
      { role: '其他岗位' },
      { requirements: '另一套岗位要求' },
      { resumeText: record.resumeText + '另有经历。' },
      { resumeReading: { ...record.resumeReading!, summary: '其他阅读摘要' } },
      { existingSupplements: [followUpGroupFixture()] },
    ].entries()) {
      assert.throws(
        () =>
          submit(
            { ...followUpInputFixture(), ...patch },
            `client-follow-up-bad-${index}`,
          ),
        /云端面试记录不一致/,
      );
    }
    assert.throws(() => assertInterviewJobInputMatches(record, 'follow-up-outline', {
      ...validateFollowUpOutlineInput(followUpInputFixture()),
      outlineVersion: 2,
    }), /云端面试记录不一致/);
    assert.doesNotThrow(() =>
      submit(followUpInputFixture(), 'client-follow-up-match'),
    );
  } finally {
    store.close();
  }
});

void test('follow-up source ignores unrelated edits and job status but detects preparation changes', () => {
  const record = followUpRecord();
  const source = interviewJobSource(record, 'follow-up-outline');
  assert.deepEqual(
    interviewJobSource(
      {
        ...record,
        conclusion: '备注',
        transcript: '新转写',
        followUpOutlineJobId: 'running-job-12345',
        role: ` ${record.role} `,
      },
      'follow-up-outline',
    ),
    source,
  );
  for (const patch of [
    { role: '另一岗位' },
    { requirements: '新要求' },
    { dimensionText: '新维度' },
    { focus: '新重点' },
    { scoringGuidance: '新评分说明' },
    { reportRequirements: '新报告要求' },
    { outlineVersion: 2 as const },
    { resumeText: '新简历' },
    { resumeReading: { ...record.resumeReading!, summary: '新摘要' } },
    { outlineSupplements: [followUpGroupFixture()] },
  ])
    assert.notDeepEqual(
      interviewJobSource({ ...record, ...patch }, 'follow-up-outline'),
      source,
    );
});

for (const change of ['none', 'unrelated', 'relevant', 'deleted'] as const) {
  void test(`follow-up result handles ${change} edits and preserves main outline/report`, () => {
    const { store, user } = setup();
    try {
      const record = followUpRecord();
      const release = { version: '0.1.18', protocol: 5 };
      const device = store.redeem(
        store.pairing(user).code,
        '协议五电脑',
        release,
      );
      store.interviews.put(
        user,
        record.id,
        0,
        'mutation-follow-up-created',
        record,
      );
      store.submit(
        user,
        'client-follow-up-apply',
        '补充追问',
        followUpInputFixture(),
        'follow-up-outline',
        record.id,
        { interviewId: record.id, interviewRevision: 1 },
      );
      const claimed = store.claim(
        device.token,
        true,
        ['follow-up-outline'],
        release,
      )!;
      if (change === 'deleted')
        store.interviews.remove(
          user,
          record.id,
          1,
          'mutation-follow-up-delete',
        );
      else if (change !== 'none')
        store.interviews.put(user, record.id, 1, 'mutation-follow-up-edit', {
          ...record,
          ...(change === 'relevant'
            ? { role: '其他岗位' }
            : { conclusion: '备注', transcript: '新转写' }),
          followUpOutlineJobId: claimed.id,
        });
      assert.equal(
        store.finish(
          device.token,
          claimed.id,
          claimed.lease,
          followUpResultFixture(),
          false,
          undefined,
          1,
        ).accepted,
        true,
      );
      let saved = store.interviews.get(user, record.id, true);
      if (change === 'deleted' || change === 'relevant') {
        assert.equal(saved.record.outlineSupplements, undefined);
        assert.equal(store.get(user, claimed.id).resultDisposition, 'pending');
        if (change === 'deleted') {
          assert.notEqual(saved.deletedAt, null);
          return;
        }
        saved = store.interviews.applyPendingResult(
          user,
          record.id,
          claimed.id,
          saved.revision,
          'mutation-follow-up-confirm',
        );
        assert.equal(
          store.interviews.pendingResults(user, record.id)[0].state,
          'applied',
        );
      } else {
        assert.equal(store.get(user, claimed.id).resultDisposition, 'applied');
        store.finish(
          device.token,
          claimed.id,
          claimed.lease,
          followUpResultFixture(),
          false,
          undefined,
          1,
        );
        assert.equal(
          store.interviews.get(user, record.id).revision,
          saved.revision,
        );
      }
      assert.equal(saved.record.outlineSupplements?.length, 1);
      assert.equal(saved.record.outlineSupplements?.[0].jobId, claimed.id);
      assert.equal(saved.record.followUpOutlineJobId, undefined);
      assert.deepEqual(saved.record.resumeReading, record.resumeReading);
      assert.deepEqual(saved.record.report, record.report);
      assert.equal(saved.record.confirmed, true);
      assert.equal(
        store.interviews.versions(user, record.id)[0].reason,
        'follow-up-outline-generated',
      );
    } finally {
      store.close();
    }
  });
}

for (const count of [49, 50]) {
  void test(`follow-up generation at ${count} existing groups respects persisted capacity`, () => {
    const { store, user } = setup();
    try {
      const outlineSupplements = Array.from({ length: count }, (_, index) => {
        const group = followUpGroupFixture();
        return {
          ...group,
          id: `capacity-group-${index}`,
          jobId: `capacity-job-${index}`,
          questions: group.questions.map((question, questionIndex) => ({
            ...question,
            id: `capacity-question-${index}-${questionIndex}`,
            question: `第${index + 1}次项目里你怎样推进第${questionIndex + 1}项工作？`,
          })) as typeof group.questions,
        };
      });
      const record = { ...followUpRecord(), outlineSupplements };
      const release = { version: '0.1.18', protocol: 5 };
      const device = store.redeem(store.pairing(user).code, '容量测试电脑', release);
      store.interviews.put(user, record.id, 0, 'mutation-capacity-create', record);
      assert.equal(store.interviews.get(user, record.id).record.outlineSupplements?.length, count);
      const submit = () => store.submit(
        user, 'client-follow-up-capacity', '补充追问',
        { ...followUpInputFixture(), existingSupplements: outlineSupplements },
        'follow-up-outline', record.id,
        { interviewId: record.id, interviewRevision: 1 },
      );
      if (count === 50) {
        assert.throws(submit, /补充追问.*50.*上限/);
        assert.equal(store.db.prepare('SELECT count(*) AS count FROM jobs WHERE user=?').get(user)?.count, 0);
        assert.equal(store.claim(device.token, true, ['follow-up-outline'], release), null);
        return;
      }
      const submitted = submit();
      const claimed = store.claim(device.token, true, ['follow-up-outline'], release)!;
      assert.equal(claimed.id, submitted.id);
      assert.equal(store.finish(device.token, claimed.id, claimed.lease, followUpResultFixture(), false, undefined, 1).accepted, true);
      const saved = store.interviews.get(user, record.id);
      assert.equal(saved.record.outlineSupplements?.length, 50);
      assert.equal(saved.record.outlineSupplements?.at(-1)?.jobId, claimed.id);
      assert.equal(store.get(user, claimed.id).resultDisposition, 'applied');
    } finally {
      store.close();
    }
  });
}
