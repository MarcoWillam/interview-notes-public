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
  let code = '';
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      code = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(code, `${name} must exist`);
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
  const handler = await loadPageHandler('openInterviewFromTaskCenter', {
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
      open: async (id: string) => {
        opened.push(id);
        await wait;
      },
    },
    busyRef,
  });

  const opening = handler('interview-two');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(opened, ['interview-two']);
  assert.equal(state.pending, 'interview-two');
  assert.equal(state.tab, 'resume');
  assert.equal(state.view, 'workbench');
  assert.equal(busyRef.current, true);
  release();
  await opening;
  assert.equal(state.pending, null);
});

void test('task center navigation exposes open failures and releases pending state', async () => {
  const state: Record<string, unknown> = {};
  const navigation = { current: false };
  const handler = await loadPageHandler('openInterviewFromTaskCenter', {
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
      open: async () => {
        throw new Error('记录已不存在');
      },
    },
  });

  await handler('missing-interview');
  assert.equal(state.tab, 'resume');
  assert.equal(state.view, 'workbench');
  assert.equal(state.pending, null);
  assert.equal(navigation.current, false);
  assert.match(String(state.error), /记录已不存在/);
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
