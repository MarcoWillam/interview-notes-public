import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileFunction } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

async function loadView() {
  const viewUrl = new URL(
    '../components/interview/task-center-view.tsx',
    import.meta.url,
  );
  const source = await readFile(viewUrl, 'utf8');
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      /from (["'])([^"']+)\1/g,
      (_match, quote: string, specifier: string) =>
        `from ${quote}${import.meta.resolve(specifier)}${quote}`,
    );
  return import(
    'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
  );
}

async function loadPageHandler(
  name: string,
  environment: Record<string, unknown>,
  dependencies: string[] = [],
) {
  const source = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const file = ts.createSourceFile(
    'page.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const functions = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name)
      functions.set(node.name.text, node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(functions.has(name), `${name} must exist`);
  for (const dependency of dependencies)
    assert.ok(functions.has(dependency), `${dependency} must exist`);
  const code = [...dependencies, name]
    .map((functionName) => functions.get(functionName))
    .join('\n');
  const output = ts.transpile(code, { target: ts.ScriptTarget.ES2022 });
  return compileFunction(
    `${output}; return ${name};`,
    Object.keys(environment),
  )(...Object.values(environment)) as (id: string) => Promise<void>;
}

const now = Date.UTC(2026, 8, 9, 12, 0, 0);
const jobs = [
  {
    id: 'running',
    kind: 'interview',
    label: '张三',
    state: 'running',
    created: now - 120_000,
    updated: now,
    queuedAt: now - 120_000,
    startedAt: now - 60_000,
    position: null,
  },
  {
    id: 'queued',
    kind: 'resume',
    label: '李四',
    state: 'queued',
    created: now - 90_000,
    updated: now,
    queuedAt: now - 90_000,
    startedAt: null,
    position: 1,
  },
  {
    id: 'paused',
    kind: 'interview',
    label: '王五',
    state: 'paused',
    created: now - 80_000,
    updated: now,
    queuedAt: now - 80_000,
    startedAt: now - 40_000,
    position: null,
  },
  {
    id: 'completed',
    kind: 'interview',
    label: '赵六',
    state: 'completed',
    created: now - 200_000,
    updated: now - 10_000,
    queuedAt: now - 200_000,
    startedAt: now - 180_000,
    position: null,
  },
] as const;

void test('task center view summarizes tasks and exposes only legal actions', async () => {
  const { TaskCenterView } = await loadView();
  const html = renderToStaticMarkup(
    createElement(TaskCenterView, {
      jobs,
      now,
      pendingId: null,
      onAction() {},
      onResult() {},
    }),
  );

  assert.ok(html.includes('运行中 1'));
  assert.ok(html.includes('等待中 1'));
  assert.ok(html.includes('已暂停 1'));
  assert.ok(html.includes('准备优先'));
  assert.match(html, /data-job-id="running"[\s\S]*暂停[\s\S]*停止/);
  assert.match(html, /data-job-id="queued"[\s\S]*暂停[\s\S]*停止/);
  assert.match(html, /data-job-id="paused"[\s\S]*恢复[\s\S]*停止/);
  assert.match(html, /data-job-id="completed"[\s\S]*查看结果/);
  assert.ok(html.includes('排队第 1 位'));
  assert.ok(html.includes('已运行 1 分钟'));
});

void test('task confirmations describe restart cost and irreversible deletion', async () => {
  const { taskActionPrompt } = await loadView();
  const pause = taskActionPrompt('pause', 'running');
  const stop = taskActionPrompt('stop', 'queued');

  assert.ok(pause.includes('恢复后将从头重新执行'));
  assert.ok(pause.includes('已消耗的 Codex 用量不会退回'));
  assert.ok(stop.includes('服务器上的简历、岗位要求和面试记录'));
  assert.ok(stop.includes('无法恢复'));
});

void test('task center labels written-test supplement work explicitly', async () => {
  const { TaskCenterView } = await loadView();
  const html = renderToStaticMarkup(
    createElement(TaskCenterView, {
      jobs: [
        {
          id: 'written-test',
          kind: 'written-test',
          label: '张三 · 笔试复盘补充',
          state: 'queued',
          created: now,
          updated: now,
          queuedAt: now,
          position: 1,
        },
      ],
      now,
      pendingId: null,
      onAction() {},
      onResult() {},
    }),
  );
  assert.ok(html.includes('笔试复盘补充'));
  assert.ok(html.includes('准备优先'));
});

void test('task center labels follow-up outline work as preparation priority', async () => {
  const { TaskCenterView } = await loadView();
  const html = renderToStaticMarkup(
    createElement(TaskCenterView, {
      jobs: [
        {
          id: 'follow-up-outline',
          kind: 'follow-up-outline',
          label: '张三 · 自驱力',
          state: 'queued',
          created: now,
          updated: now,
          queuedAt: now,
          position: 1,
          interviewId: 'interview-one',
        },
      ],
      now,
      pendingId: null,
      onAction() {},
      onResult() {},
    }),
  );

  assert.ok(html.includes('补充追问'));
  assert.ok(html.includes('准备优先'));
});

void test('task center previews follow-up questions and opens only a bound interview', async () => {
  const source = await readFile(
    new URL('../components/interview/task-center.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /FollowUpOutlineResult/);
  assert.match(source, /job\.kind === 'follow-up-outline'/);
  assert.match(source, /value\.requestedFocus/);
  assert.match(source, /value\.questions\.map/);
  assert.match(source, /打开面试记录/);
  assert.match(source, /job\.interviewId &&/);
  assert.match(
    source,
    /setDetail\(null\);[\s\S]*setOpen\(false\);[\s\S]*onOpenInterview\?\.\(job\.interviewId\)/,
  );
  assert.doesNotMatch(source, /applyFollowUpOutlineResult/);
});

void test('task center opens the bound interview in the workbench outline tab', async () => {
  const source = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /<TaskCenter[\s\S]*onOpenInterview=\{\(id\)[\s\S]*openInterviewFromTaskCenter\(id\)/,
  );
  assert.match(
    source,
    /async function openInterview\(id: string\)[\s\S]*library\.open\(id\);[\s\S]*setTab\('resume'\);[\s\S]*setView\('workbench'\)/,
  );
});

void test('task center navigation opens a record while analysis is busy', async () => {
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const opened: string[] = [];
  const state: Record<string, unknown> = {};
  const busyRef = { current: true };
  const analysis = new AbortController();
  const followUp = new AbortController();
  const remoteWaitRef = {
    current: {
      controller: analysis,
      jobId: 'server-job',
      kind: 'analyze',
      recordId: 'interview-one',
    },
  };
  const handler = await loadPageHandler(
    'openInterviewFromTaskCenter',
    {
      taskCenterNavigationRef: { current: false },
      setTaskCenterOpeningId: (value: unknown) => {
        state.pending = value;
      },
      setError: (value: unknown) => {
        state.error = value;
      },
      setTab: (value: unknown) => {
        state.tab = value;
      },
      setView: (value: unknown) => {
        state.view = value;
      },
      library: {
        id: 'interview-one',
        open: async (id: string) => {
          opened.push(id);
          await wait;
        },
      },
      busyRef,
      busy: 'analyze',
      queuedCodex: true,
      remoteJob: { id: 'server-job', state: 'running' },
      remoteWaitRef,
      analysisController: { current: analysis },
      followUpController: { current: followUp },
      cancelledRemotely: { current: false },
      setBusy: (value: unknown) => {
        state.busy = value;
      },
      setRemoteJob: (value: unknown) => {
        state.remoteJob = value;
      },
      setCancelling: (value: unknown) => {
        state.cancelling = value;
      },
    },
    ['releaseRecordTaskWaits'],
  );

  const opening = handler('interview-two');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(opened, ['interview-two']);
  assert.equal(state.pending, 'interview-two');
  assert.equal(state.tab, 'resume');
  assert.equal(state.view, 'workbench');
  assert.equal(busyRef.current, false);
  assert.equal(analysis.signal.aborted, true);
  assert.equal(followUp.signal.aborted, true);
  assert.equal(state.busy, null);
  assert.equal(state.remoteJob, null);
  assert.equal(remoteWaitRef.current, null);
  release();
  await opening;
  assert.equal(state.pending, null);
});

void test('task center navigation blocks local or unidentified work', async () => {
  for (const boundary of ['local', 'unidentified'] as const) {
    const state: Record<string, unknown> = {};
    const analysis = new AbortController();
    let opens = 0;
    const handler = await loadPageHandler(
      'openInterviewFromTaskCenter',
      {
        taskCenterNavigationRef: { current: false },
        setTaskCenterOpeningId: (value: unknown) => {
          state.pending = value;
        },
        setError: (value: unknown) => {
          state.error = value;
        },
        setTab: (value: unknown) => {
          state.tab = value;
        },
        setView: (value: unknown) => {
          state.view = value;
        },
        library: {
          id: 'interview-one',
          open: async () => {
            opens++;
          },
        },
        busyRef: { current: true },
        busy: boundary === 'local' ? 'analyze' : 'resume-read',
        queuedCodex: boundary === 'unidentified',
        remoteJob: null,
        remoteWaitRef: { current: null },
        analysisController: { current: analysis },
        followUpController: { current: null },
        cancelledRemotely: { current: false },
        setBusy() {},
        setRemoteJob() {},
        setCancelling() {},
      },
      ['releaseRecordTaskWaits'],
    );

    await handler('interview-two');
    assert.equal(opens, 0, boundary);
    assert.equal(analysis.signal.aborted, false, boundary);
    assert.equal(state.pending, undefined, boundary);
    assert.equal(state.view, 'workbench', boundary);
    assert.match(String(state.error), /完成|取消|任务中心/, boundary);
  }
});

void test('task center navigation does not detach an import with a stale remote job', async () => {
  const state: Record<string, unknown> = {};
  const controller = new AbortController();
  let opens = 0;
  const handler = await loadPageHandler(
    'openInterviewFromTaskCenter',
    {
      taskCenterNavigationRef: { current: false },
      setTaskCenterOpeningId() {},
      setError: (value: unknown) => {
        state.error = value;
      },
      setTab() {},
      setView() {},
      library: {
        id: 'interview-one',
        open: async () => {
          opens++;
        },
      },
      busyRef: { current: true },
      busy: 'import',
      queuedCodex: true,
      remoteJob: { id: 'old-server-job', state: 'running' },
      remoteWaitRef: {
        current: {
          controller,
          jobId: 'old-server-job',
          kind: 'analyze',
          recordId: 'interview-one',
        },
      },
      analysisController: { current: controller },
      followUpController: { current: null },
      cancelledRemotely: { current: false },
      setBusy() {},
      setRemoteJob() {},
      setCancelling() {},
    },
    ['releaseRecordTaskWaits'],
  );

  await handler('interview-two');
  assert.equal(opens, 0);
  assert.equal(controller.signal.aborted, false);
  assert.match(String(state.error), /导入|当前任务|完成/);
});

void test('task center navigation requires controller and job ownership', async () => {
  for (const mismatch of ['controller', 'job'] as const) {
    const state: Record<string, unknown> = {};
    const controller = new AbortController();
    const boundController =
      mismatch === 'controller' ? new AbortController() : controller;
    let opens = 0;
    const handler = await loadPageHandler(
      'openInterviewFromTaskCenter',
      {
        taskCenterNavigationRef: { current: false },
        setTaskCenterOpeningId() {},
        setError: (value: unknown) => {
          state.error = value;
        },
        setTab() {},
        setView() {},
        library: {
          id: 'interview-one',
          open: async () => {
            opens++;
          },
        },
        busyRef: { current: true },
        busy: 'analyze',
        queuedCodex: true,
        remoteJob: {
          id: mismatch === 'job' ? 'different-job' : 'server-job',
          state: 'running',
        },
        remoteWaitRef: {
          current: {
            controller: boundController,
            jobId: 'server-job',
            kind: 'analyze',
            recordId: 'interview-one',
          },
        },
        analysisController: { current: controller },
        followUpController: { current: null },
        cancelledRemotely: { current: false },
        setBusy() {},
        setRemoteJob() {},
        setCancelling() {},
      },
      ['releaseRecordTaskWaits'],
    );

    await handler('interview-two');
    assert.equal(opens, 0, mismatch);
    assert.equal(controller.signal.aborted, false, mismatch);
    assert.match(String(state.error), /任务中心|完成/, mismatch);
  }
});

void test('remote wait binding only tracks the current active analysis controller', async () => {
  const currentController = new AbortController();
  const otherController = new AbortController();
  const remoteWaitRef = { current: null as Record<string, unknown> | null };
  const jobs: unknown[] = [];
  const track = await loadPageHandler('trackRemoteWait', {
    analysisController: { current: currentController },
    remoteWaitRef,
    setRemoteJob: (job: unknown) => jobs.push(job),
  });
  const activeJob = {
    id: 'current-job',
    label: '当前任务',
    state: 'running',
    created: now,
    updated: now,
  };
  const call = track as unknown as (
    controller: AbortController,
    job: typeof activeJob,
    kind: string,
    recordId: string,
  ) => void;

  call(otherController, activeJob, 'analyze', 'record-one');
  assert.equal(remoteWaitRef.current, null);
  assert.equal(jobs.length, 0);

  call(currentController, activeJob, 'analyze', 'record-one');
  assert.deepEqual(remoteWaitRef.current, {
    controller: currentController,
    jobId: 'current-job',
    kind: 'analyze',
    recordId: 'record-one',
  });
  assert.equal(jobs.length, 1);

  call(
    currentController,
    { ...activeJob, state: 'completed' },
    'analyze',
    'record-one',
  );
  assert.equal(remoteWaitRef.current, null);
  assert.equal(jobs.length, 2);
});

void test('clearing stale remote display does not abort local work', async () => {
  const controller = new AbortController();
  const state: Record<string, unknown> = {};
  const remoteWaitRef = {
    current: {
      controller,
      jobId: 'old-job',
      kind: 'analyze',
      recordId: 'old-record',
    },
  };
  const clear = await loadPageHandler('clearRemoteTaskDisplay', {
    remoteWaitRef,
    setRemoteJob: (value: unknown) => {
      state.remoteJob = value;
    },
    setCancelling: (value: unknown) => {
      state.cancelling = value;
    },
    cancelledRemotely: { current: true },
  });

  (clear as unknown as () => void)();
  assert.equal(remoteWaitRef.current, null);
  assert.equal(state.remoteJob, null);
  assert.equal(state.cancelling, false);
  assert.equal(controller.signal.aborted, false);
});

void test('task center navigation exposes open failures and releases pending state', async () => {
  const state: Record<string, unknown> = {};
  const navigation = { current: false };
  const handler = await loadPageHandler(
    'openInterviewFromTaskCenter',
    {
      taskCenterNavigationRef: navigation,
      setTaskCenterOpeningId: (value: unknown) => {
        state.pending = value;
      },
      setError: (value: unknown) => {
        state.error = value;
      },
      setTab: (value: unknown) => {
        state.tab = value;
      },
      setView: (value: unknown) => {
        state.view = value;
      },
      library: {
        id: 'interview-one',
        open: async () => {
          throw new Error('记录已不存在');
        },
      },
      busyRef: { current: false },
      busy: null,
      queuedCodex: true,
      remoteJob: null,
      remoteWaitRef: { current: null },
      analysisController: { current: null },
      followUpController: { current: null },
      cancelledRemotely: { current: false },
      setBusy() {},
      setRemoteJob() {},
      setCancelling() {},
    },
    ['releaseRecordTaskWaits'],
  );

  await handler('missing-interview');
  assert.equal(state.tab, 'resume');
  assert.equal(state.view, 'workbench');
  assert.equal(state.pending, null);
  assert.equal(navigation.current, false);
  assert.match(String(state.error), /记录已不存在/);
});

function lifecycleEnvironment() {
  const state: Record<string, unknown> = {};
  const analysisController = new AbortController();
  const environment: Record<string, unknown> = {
    followUpRecordId: { current: 'record-one' },
    busyRef: { current: true },
    analysisController: { current: analysisController },
    remoteWaitRef: {
      current: {
        controller: analysisController,
        jobId: 'server-job',
        kind: 'analyze',
        recordId: 'record-one',
      },
    },
    followUpController: { current: new AbortController() },
    cancelledRemotely: { current: true },
    outlineVersionForStandards: () => 2,
  };
  for (const name of [
    'Busy',
    'RemoteJob',
    'Cancelling',
    'Error',
    'PendingCandidateName',
    'PendingResume',
    'PendingResumeOutline',
    'PendingWrittenTestSupplement',
    'PendingOutlineRegeneration',
    'LateWorkSampleOpen',
    'LateWorkSampleArtifact',
    'Candidate',
    'Role',
    'Requirements',
    'DimensionText',
    'Focus',
    'ScoringGuidance',
    'ReportRequirements',
    'SourceTemplateId',
    'TemplateModified',
    'OutlineVersion',
    'HasWrittenTest',
    'WrittenTestConfirmed',
    'ResumeText',
    'ResumeName',
    'ResumeReading',
    'OutlineSupplements',
    'FollowUpOutlineJobId',
    'FollowUpOutlineDraft',
    'WorkSample',
    'WorkSampleJobId',
    'WrittenTestJobId',
    'OutlineRegeneratedAt',
    'OutlineRegenerationJobId',
    'OutlineRevision',
    'ResumeBodyOpen',
    'Transcript',
    'TranscriptName',
    'Reviewed',
    'Report',
    'Conclusion',
    'Confirmed',
    'Tab',
    'Notice',
    'Standards',
    'PendingImport',
    'ResetOpen',
  ]) {
    environment[`set${name}`] = (value: unknown) => {
      state[name[0].toLowerCase() + name.slice(1)] = value;
    };
  }
  return { environment, state };
}

void test('restore and reset execute the shared record task cleanup', async () => {
  for (const lifecycle of ['restoreInterview', 'reset'] as const) {
    const { environment, state } = lifecycleEnvironment();
    const analysis = (
      environment.analysisController as { current: AbortController }
    ).current;
    const followUp = (
      environment.followUpController as { current: AbortController }
    ).current;
    const handler = await loadPageHandler(lifecycle, environment, [
      'releaseRecordTaskWaits',
    ]);
    if (lifecycle === 'restoreInterview') {
      await (
        handler as unknown as (saved: Record<string, unknown>) => Promise<void>
      )({
        id: 'record-two',
        candidate: '李四',
        role: 'AI 产品经理',
        requirements: '岗位要求',
        dimensionText: '自驱力',
        resumeText: '简历',
        transcript: '',
        reviewed: false,
        report: null,
        conclusion: '',
        confirmed: false,
        outlineSupplements: [],
        followUpOutlineJobId: 'target-follow-up-job',
      });
      assert.equal(state.followUpOutlineJobId, 'target-follow-up-job');
    } else {
      (handler as unknown as (seed: Record<string, unknown>) => void)({
        standards: {
          role: 'AI 产品经理',
          requirements: '岗位要求',
          dimensionText: '自驱力',
          focus: '',
          scoringGuidance: '',
          reportRequirements: '',
        },
        sourceTemplateId: 'ai-product-manager',
      });
    }
    assert.equal(analysis.signal.aborted, true, lifecycle);
    assert.equal(followUp.signal.aborted, true, lifecycle);
    assert.equal(
      (environment.analysisController as { current: unknown }).current,
      null,
      lifecycle,
    );
    assert.equal(
      (environment.followUpController as { current: unknown }).current,
      null,
      lifecycle,
    );
    assert.equal(
      (environment.busyRef as { current: boolean }).current,
      false,
      lifecycle,
    );
    assert.equal(state.busy, null, lifecycle);
    assert.equal(state.remoteJob, null, lifecycle);
    assert.equal(
      (environment.remoteWaitRef as { current: unknown }).current,
      null,
      lifecycle,
    );
  }
});

void test('an old async completion cannot release a new record task', async () => {
  const state: Record<string, unknown> = {};
  const oldController = new AbortController();
  const newController = new AbortController();
  const analysisController = { current: newController };
  const busyRef = { current: true };
  const remoteWaitRef = {
    current: {
      controller: newController,
      jobId: 'new-job',
      kind: 'analyze',
      recordId: 'new-record',
    },
  };
  const finish = await loadPageHandler('finishAnalysisWait', {
    analysisController,
    busyRef,
    remoteWaitRef,
    setBusy: (value: unknown) => {
      state.busy = value;
    },
    setRemoteJob: (value: unknown) => {
      state.remoteJob = value;
    },
    setCancelling: (value: unknown) => {
      state.cancelling = value;
    },
    cancelledRemotely: { current: false },
  });

  (finish as unknown as (controller: AbortController) => void)(oldController);
  assert.equal(analysisController.current, newController);
  assert.equal(busyRef.current, true);
  assert.equal(state.busy, undefined);
  assert.equal(remoteWaitRef.current?.jobId, 'new-job');
  assert.equal(state.remoteJob, undefined);
  const source = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const analyze = source.slice(
    source.indexOf('async function analyze()'),
    source.indexOf('async function cancelAnalysis()'),
  );
  assert.match(analyze, /finally\s*\{[\s\S]*finishAnalysisWait\(controller\)/);
});

void test('a cloud refresh from an old record cannot continue on the new record', async () => {
  const oldController = new AbortController();
  const newController = new AbortController();
  const analysisController = { current: oldController };
  const refresh = await loadPageHandler('refreshCurrentAnalysisRecord', {
    analysisController,
    library: {
      refreshFromCloud: async () => {
        analysisController.current = newController;
      },
    },
  });

  assert.equal(
    await (
      refresh as unknown as (controller: AbortController) => Promise<boolean>
    )(oldController),
    false,
  );
  assert.equal(analysisController.current, newController);
});

void test('task center labels work samples and names the offline target computer', async () => {
  const { TaskCenterView } = await loadView();
  const html = renderToStaticMarkup(
    createElement(TaskCenterView, {
      jobs: [
        {
          id: 'work-sample',
          kind: 'work-sample',
          label: '张三 · 笔试作品',
          state: 'queued',
          created: now,
          updated: now,
          queuedAt: now,
          waitingForDevice: true,
          targetDeviceName: '张三的 MacBook',
        },
      ],
      now,
      pendingId: null,
      onAction() {},
      onResult() {},
    }),
  );
  assert.ok(html.includes('笔试作品评估'));
  assert.ok(html.includes('等待作品所在电脑 · 张三的 MacBook'));
  assert.ok(html.includes('准备优先'));
});

void test('task center drawer clears dialog translation and keeps the list in a flexible viewport', async () => {
  const [source, css] = await Promise.all([
    readFile(
      new URL('../components/interview/task-center.tsx', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  ]);
  const drawer = css.match(/\.task-center-drawer\s*\{([\s\S]*?)\}/)?.[1] || '';
  const list = css.match(/\.task-list\s*\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(source, /task-center-drawer translate-x-0 translate-y-0/);
  assert.match(drawer, /display:\s*flex/);
  assert.match(drawer, /flex-direction:\s*column/);
  assert.match(list, /flex:\s*1 1 auto/);
});

void test('interview preparation shows the supplemented written-test status', async () => {
  const source = await readFile(
    new URL(
      '../components/interview/interview-preparation.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /writtenTestSupplemented/);
  assert.match(source, /已补充复盘题/);
});

void test('task center flags queued V2 work when online connectors are too old', async () => {
  const { TaskCenterView } = await loadView();
  const html = renderToStaticMarkup(
    createElement(TaskCenterView, {
      jobs: [
        {
          id: 'v2-resume',
          kind: 'resume',
          label: '张三',
          state: 'queued',
          created: now,
          updated: now,
          queuedAt: now,
          requiredProtocol: 3,
        },
      ],
      now,
      pendingId: null,
      maximumOnlineProtocol: 2,
      onAction() {},
      onResult() {},
    }),
  );
  assert.match(html, /需要升级连接器/);
});

void test('task center V2 regeneration uses the shared markdown exporter', async () => {
  const source = await readFile(
    new URL('../components/interview/task-center.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /exportInterviewOutlineV2/);
  assert.match(source, /downloadOutline/);
  assert.match(source, /'outline' in value/);
  assert.match(source, /下载提纲 Markdown/);
});

void test('task center renders V2 written-test and work-sample supplements', async () => {
  const source = await readFile(
    new URL('../components/interview/task-center.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /OutlineV2SupplementTaskResult/);
  assert.match(source, /job\.report\.outlineSupplement/);
  assert.match(source, /已更新对应面试记录的候选区/);
});

void test('completed interview tasks separate work-sample verification in results and exports', async () => {
  const source = await readFile(
    new URL('../components/interview/task-center.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /作品表现（归属与过程待核实）/);
  assert.match(source, /workSampleReview/);
  assert.match(source, /transcriptEvidence/);
  assert.match(source, /workSampleRubricLabel/);
  assert.match(source, /groupAssessmentDimensions/);
});
