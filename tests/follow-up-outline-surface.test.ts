import { compileFunction } from 'node:vm';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeRequestedFocus } from '../lib/follow-up-outline.ts';

void test('follow-up focus counts emoji by Unicode code point', () => {
  const focus = '😀'.repeat(101);
  assert.equal(Array.from(normalizeRequestedFocus(focus)).length, 101);
  assert.throws(() => normalizeRequestedFocus('😀'.repeat(201)));
});

void test('follow-up outline surface exposes an accessible focused-generation dialog', async () => {
  const source = await readFile(
    new URL(
      '../components/interview/follow-up-outline-view.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /补充追问/);
  assert.match(source, /需要补问的维度或关注点/);
  assert.doesNotMatch(source, /maxLength=\{200\}/);
  assert.match(source, /Array\.from\(value\)\.length/);
  assert.match(source, /normalizeRequestedFocus/);
  assert.match(source, /2 道/);
  assert.match(source, /简历[\s\S]*现有面试提纲/);
  assert.match(source, /不.*修改.*原/);
  assert.match(source, /DialogTitle/);
  assert.match(source, /DialogFooter/);
});

void test('follow-up groups retain their own question details and deletion confirmation', async () => {
  const source = await readFile(
    new URL(
      '../components/interview/follow-up-outline-view.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /left\.createdAt\s*-\s*right\.createdAt/);
  assert.match(source, /requestedFocus/);
  assert.match(source, /createdAt/);
  assert.match(source, /group\.questions\.map/);
  assert.match(source, /<details>/);
  assert.match(source, /riskSignals/);
  assert.match(source, /probe\.condition/);
  assert.match(source, /删除本组/);
  assert.match(source, /AlertDialogTitle/);
  assert.match(source, /不会修改原面试提纲/);
});

void test('resume reading places follow-up groups after either outline and before actions', async () => {
  const source = await readFile(
    new URL('../components/interview/resume-reading-view.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /groups\?: readonly FollowUpOutlineGroup\[\]/);
  assert.match(source, /busy\?: boolean/);
  assert.match(source, /draft\?: string/);
  assert.match(source, /onGenerate\?:/);
  assert.match(source, /onDelete\?:/);
  const mainOutline = source.indexOf(
    '<InterviewOutlineV2View outline={value.outline} />',
  );
  const legacyOutline = source.indexOf('!value.outline && !!questions.length');
  const followUps = source.indexOf('<FollowUpOutlineView');
  const writtenAction = source.indexOf('written-test-supplement-action');
  assert.ok(mainOutline >= 0 && followUps > mainOutline);
  assert.ok(legacyOutline >= 0 && followUps > legacyOutline);
  assert.match(source, /value\.outline \|\| !!questions\.length/);
  assert.ok(writtenAction < 0 || followUps < writtenAction);
});

void test('follow-up surface styles fit groups and stacked dialog actions on narrow screens', async () => {
  const css = await readFile(
    new URL('../app/globals.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /\.follow-up-outline/);
  assert.match(css, /\.follow-up-outline-group/);
  assert.match(css, /\.follow-up-outline-dialog/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  const followUpStylesStart = css.indexOf('.follow-up-outline {');
  const stylesAt760Start = css.indexOf(
    '@media (max-width: 760px)',
    followUpStylesStart,
  );
  const stylesAt760 = css.slice(
    stylesAt760Start,
    css.indexOf('@media (max-width: 480px)', stylesAt760Start),
  );
  assert.match(
    stylesAt760,
    /follow-up-outline-dialog \[data-slot='dialog-footer'\][\s\S]*flex-direction:\s*column-reverse/,
  );
  assert.match(
    stylesAt760,
    /follow-up-outline-delete-dialog \[data-slot='alert-dialog-footer'\][\s\S]*width:\s*100%/,
  );
  assert.match(
    css,
    /follow-up-outline-dialog[\s\S]*\[data-slot='dialog-footer'\]/,
  );
});

void test('follow-up dialogs keep their actions reachable in a short viewport', async () => {
  const css = await readFile(
    new URL('../app/globals.css', import.meta.url),
    'utf8',
  );
  assert.match(
    css,
    /\.follow-up-outline-dialog,[\s\S]*\.follow-up-outline-delete-dialog[\s\S]*max-height:\s*min\(calc\(100dvh - 2rem\),/,
  );
  assert.match(css, /\.follow-up-outline-dialog,[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.follow-up-outline-field textarea[\s\S]*resize:\s*none/);
  assert.match(
    css,
    /\.follow-up-outline-delete-description[\s\S]*overflow-wrap:\s*anywhere/,
  );
});

void test('follow-up detail lists accept duplicate text and refocus after async generation settles', async () => {
  const source = await readFile(
    new URL(
      '../components/interview/follow-up-outline-view.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /listenFor\.map\(\(point, index\)/);
  assert.match(source, /riskSignals\.map\(\(signal, index\)/);
  assert.match(source, /probes\.map\(\(probe, index\)/);
  assert.match(source, /key=\{`\$\{point\}-\$\{index\}`\}/);
  assert.match(source, /key=\{`\$\{signal\}-\$\{index\}`\}/);
  assert.match(
    source,
    /key=\{`\$\{probe\.condition\}-\$\{probe\.question\}-\$\{index\}`\}/,
  );
  assert.match(
    source,
    /setSubmitting\(false\);[\s\S]*requestAnimationFrame\(\(\) => textareaRef\.current\?\.focus\(\)\)/,
  );
});

void test('opening a closed follow-up dialog refreshes its record-aware draft', async () => {
  const source = await readFile(
    new URL(
      '../components/interview/follow-up-outline-view.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /setRequestedFocus\(draft\);[\s\S]*setOpen\(true\);/);
});

void test('workbench persists, restores and clears record-scoped follow-up state', async () => {
  const page = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  for (const field of ['outlineSupplements', 'followUpOutlineJobId']) {
    const draft = page.slice(
      page.indexOf('const library = useInterviewLibrary('),
      page.indexOf('async (saved) =>'),
    );
    assert.match(draft, new RegExp(`\\b${field},`));
  }
  assert.match(
    page,
    /setOutlineSupplements\(saved\.outlineSupplements \|\| \[\]\)/,
  );
  assert.match(page, /setFollowUpOutlineJobId\(saved\.followUpOutlineJobId\)/);
  assert.match(
    page,
    /if \(!sameFollowUpRecord\) setFollowUpOutlineDraft\(''\)/,
  );
  for (const name of ['editResume', 'reset']) {
    const body = page.slice(
      page.indexOf(`function ${name}(`),
      page.indexOf('\n  }', page.indexOf(`function ${name}(`)),
    );
    assert.match(body, /setOutlineSupplements\(\[\]\)/);
    assert.match(body, /setFollowUpOutlineJobId\(undefined\)/);
    assert.match(body, /setFollowUpOutlineDraft\(''\)/);
  }
  assert.match(page, /groups=\{outlineSupplements\}/);
  assert.match(page, /draft=\{followUpOutlineDraft\}/);
  assert.match(page, /onGenerate=\{runFollowUpOutline\}/);
  assert.match(page, /onDelete=\{deleteFollowUpOutline\}/);
});

void test('workbench builds bound follow-up requests and refreshes without double append', async () => {
  const page = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const handler = page.slice(
    page.indexOf('async function runFollowUpOutline('),
    page.indexOf('async function deleteFollowUpOutline('),
  );
  assert.match(handler, /Promise<boolean>/);
  assert.match(handler, /normalizeRequestedFocus/);
  assert.match(handler, /validateFollowUpOutlineInput/);
  for (const field of [
    'role',
    'requirements',
    'dimensionText',
    'focus',
    'scoringGuidance',
    'reportRequirements',
    'resumeText',
    'resumeReading',
    'outlineVersion',
  ])
    assert.match(handler, new RegExp(`\\b${field},`));
  assert.match(handler, /existingSupplements: outlineSupplements/);
  assert.match(handler, /!queuedCodex \|\| !library\.cloud/);
  assert.match(handler, /await library\.flushForTask\(/);
  assert.match(handler, /if \(!recordBinding\)/);
  assert.match(handler, /scope: recordId/);
  assert.match(handler, /\.\.\.recordBinding/);
  assert.match(handler, /await submitRemoteFollowUpOutline\(/);
  assert.match(handler, /refreshFromCloud\(recordId\)/);
  assert.doesNotMatch(
    handler,
    /applyFollowUpOutlineResult|setOutlineSupplements/,
  );
  assert.match(handler, /return true/);
  assert.match(handler, /return false/);
});

void test('follow-up recovery handles server dispositions and retries without resubmission', async () => {
  const page = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const recovery = page.slice(
    page.indexOf('// Recover only the saved follow-up task'),
    page.indexOf('async function localAction'),
  );
  assert.match(recovery, /followUpOutlineJobId/);
  assert.match(recovery, /job\.resultDisposition === 'applied'/);
  assert.match(recovery, /job\.resultDisposition === 'pending'/);
  assert.match(
    recovery,
    /job\.state === 'failed' \|\| job\.state === 'cancelled'/,
  );
  assert.match(recovery, /status === 404/);
  assert.match(recovery, /setTimeout\(.*recover\(\), 5000\)/);
  assert.match(recovery, /记录管理/);
  assert.match(recovery, /controller\.abort\(\)/);
  assert.doesNotMatch(recovery, /submitRemoteFollowUpOutline|method: 'DELETE'/);
});

void test('group deletion waits for accepted save and preserves the main reading and report', async () => {
  const page = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const handler = page.slice(
    page.indexOf('async function deleteFollowUpOutline('),
    page.indexOf('async function runOutlineRegeneration('),
  );
  assert.match(handler, /Promise<boolean>/);
  assert.match(handler, /outlineSupplements\.filter\(/);
  assert.match(
    handler,
    /await library\.flush\(\{ outlineSupplements: next \}\)/,
  );
  assert.ok(
    handler.indexOf('await library.flush') <
      handler.indexOf('setOutlineSupplements(next)'),
  );
  assert.doesNotMatch(handler, /setResumeReading|setReport|setConfirmed/);
  assert.match(handler, /return false/);
  assert.match(handler, /return true/);
});

// Execute the actual page handlers with their browser/React boundary injected.
// This keeps async acceptance and record-switch races testable without a DOM.
async function workbenchHandler(
  name: string,
  environment: Record<string, unknown>,
) {
  const ts = await import('typescript');
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
  const visit = (node: import('typescript').Node) => {
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
  )(...Object.values(environment)) as (value: string) => Promise<boolean>;
}

async function followUpEnvironment() {
  const domain = await import('../lib/follow-up-outline.ts');
  const fixtures = await import('./fixtures/follow-up-outline.ts');
  const input = fixtures.followUpInputFixture();
  const state: Record<string, unknown> = {};
  const submissions: unknown[][] = [];
  const saves: unknown[] = [];
  const refreshes: string[] = [];
  const group = fixtures.followUpGroupFixture();
  const library = {
    id: 'record-one',
    cloud: true,
    ready: true,
    flush: async (value: unknown) => {
      saves.push(value);
    },
    flushForTask: async (): Promise<
      { interviewId: string; interviewRevision: number } | undefined
    > => ({ interviewId: 'record-one', interviewRevision: 7 }),
    refreshFromCloud: async (id: string) => {
      refreshes.push(id);
      state.outlineSupplements = [group];
    },
  };
  const environment: Record<string, unknown> = {
    ...input,
    busy: null,
    busyRef: { current: false },
    followUpBusy: false,
    queuedCodex: true,
    library,
    libraryRef: { current: library },
    followUpController: { current: null },
    followUpRecordId: { current: 'record-one' },
    outlineSupplements: [],
    normalizeRequestedFocus: domain.normalizeRequestedFocus,
    validateFollowUpOutlineInput: domain.validateFollowUpOutlineInput,
    submitRemoteFollowUpOutline: async (...args: unknown[]) => {
      submissions.push(args);
      const progress = args[2] as (value: unknown) => void;
      progress({ id: group.jobId, state: 'queued', report: null });
      progress({
        id: group.jobId,
        state: 'completed',
        resultDisposition: 'applied',
        report: fixtures.followUpResultFixture(),
      });
      return fixtures.followUpResultFixture();
    },
  };
  for (const name of [
    'FollowUpOutlineDraft',
    'FollowUpOutlineJobId',
    'Busy',
    'Error',
    'Notice',
    'RemoteJob',
    'Tab',
    'OutlineSupplements',
  ]) {
    environment[`set${name}`] = (value: unknown) => {
      state[name[0].toLowerCase() + name.slice(1)] = value;
    };
  }
  return { environment, state, submissions, saves, refreshes, group, library };
}

void test('generation uses the bound current payload and only the server appends its completed group', async () => {
  const { environment, state, submissions, saves, refreshes, group } =
    await followUpEnvironment();
  const generate = await workbenchHandler('runFollowUpOutline', environment);
  assert.equal(await generate('  自驱力  '), true);
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0][0], {
    ...(await import('./fixtures/follow-up-outline.ts')).followUpInputFixture(),
    requestedFocus: '自驱力',
  });
  assert.deepEqual(submissions[0][3], {
    fetcher: fetch,
    pollMs: 2000,
    scope: 'record-one',
    interviewId: 'record-one',
    interviewRevision: 7,
  });
  assert.deepEqual(saves, [{ followUpOutlineJobId: group.jobId }]);
  assert.deepEqual(refreshes, ['record-one']);
  assert.deepEqual(state.outlineSupplements, [group]);
  assert.equal(state.followUpOutlineDraft, '');
  assert.equal(state.followUpOutlineJobId, undefined);
  assert.equal(state.tab, 'resume');
});

void test('generation rejects preview, missing binding, missing outline and concurrent work without submitting', async () => {
  for (const variant of ['preview', 'binding', 'outline', 'busy']) {
    const { environment, library, submissions } = await followUpEnvironment();
    if (variant === 'preview') library.cloud = false;
    if (variant === 'binding') library.flushForTask = async () => undefined;
    if (variant === 'outline') environment.resumeReading = null;
    if (variant === 'busy') environment.followUpBusy = true;
    const generate = await workbenchHandler('runFollowUpOutline', environment);
    assert.equal(await generate('自驱力'), false, variant);
    assert.equal(submissions.length, 0, variant);
  }
});

void test('transient submission polling failure retains its saved task and focus for recovery', async () => {
  const { environment, state, group } = await followUpEnvironment();
  environment.submitRemoteFollowUpOutline = async (
    _input: unknown,
    _signal: unknown,
    progress: (job: unknown) => void,
  ) => {
    progress({ id: group.jobId, state: 'queued', report: null });
    throw new Error('任务已提交，但暂时无法获取进度。');
  };
  const generate = await workbenchHandler('runFollowUpOutline', environment);
  assert.equal(await generate('自驱力'), false);
  assert.equal(state.followUpOutlineDraft, '自驱力');
  assert.equal(state.followUpOutlineJobId, group.jobId);
  assert.match(String(state.error), /无需重复提交/);
});

void test('switching records while binding is saved prevents stale submission', async () => {
  const { environment, library, submissions } = await followUpEnvironment();
  library.flushForTask = async () => {
    (environment.followUpRecordId as { current: string }).current =
      'record-two';
    return { interviewId: 'record-one', interviewRevision: 7 };
  };
  const generate = await workbenchHandler('runFollowUpOutline', environment);
  assert.equal(await generate('自驱力'), false);
  assert.equal(submissions.length, 0);
});

void test('deletion changes only the selected group after accepted save, and leaves failed saves visible', async () => {
  for (const rejected of [false, true]) {
    const { environment, library, state, group } = await followUpEnvironment();
    const other = { ...group, id: 'another-group' };
    environment.outlineSupplements = [group, other];
    library.flush = async (value) => {
      assert.equal(state.outlineSupplements, undefined);
      assert.deepEqual(value, { outlineSupplements: [other] });
      if (rejected) throw new Error('本地保存失败');
    };
    const remove = await workbenchHandler('deleteFollowUpOutline', environment);
    assert.equal(await remove(group.id), !rejected);
    assert.deepEqual(state.outlineSupplements, rejected ? undefined : [other]);
    assert.equal(state.report, undefined);
    assert.equal(state.resumeReading, undefined);
  }
});

async function startRecovery(
  job: unknown,
  requestFailure?: { status?: number },
) {
  const { environment, state, refreshes } = await followUpEnvironment();
  const ts = await import('typescript');
  const source = await readFile(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const code = source.slice(
    source.indexOf('// Recover only the saved follow-up task'),
    source.indexOf('async function localAction'),
  );
  const timers: { action: () => void; delay: number }[] = [];
  let cleanup = () => {};
  let requests = 0;
  environment.followUpOutlineJobId = 'saved-follow-up-job';
  environment.followUpOutlineDraft = '保留关注点';
  environment.remoteRequest = async () => {
    requests++;
    if (requestFailure) throw requestFailure;
    return job;
  };
  environment.useEffect = (effect: () => () => void) => {
    cleanup = effect();
  };
  environment.setTimeout = (action: () => void, delay: number) => {
    timers.push({ action, delay });
    return timers.length;
  };
  environment.clearTimeout = () => {};
  compileFunction(
    ts.transpile(code, { target: ts.ScriptTarget.ES2022 }),
    Object.keys(environment),
  )(...Object.values(environment));
  await new Promise<void>((resolve) => setImmediate(resolve));
  return {
    state,
    refreshes,
    timers,
    cleanup,
    environment,
    requests: () => requests,
  };
}

void test('saved-task recovery refreshes applied and pending results with distinct draft handling', async () => {
  for (const resultDisposition of ['applied', 'pending']) {
    const { state, refreshes, cleanup } = await startRecovery({
      state: 'completed',
      resultDisposition,
    });
    assert.deepEqual(refreshes, ['record-one']);
    assert.equal(state.followUpOutlineJobId, undefined);
    assert.equal(
      state.followUpOutlineDraft,
      resultDisposition === 'applied' ? '' : '保留关注点',
    );
    if (resultDisposition === 'pending')
      assert.match(String(state.error), /记录管理/);
    cleanup();
  }
});

void test('saved-task recovery clears failed, cancelled and expired IDs without resetting the draft', async () => {
  for (const kind of ['failed', 'cancelled', '404']) {
    const { state, cleanup } = await startRecovery(
      { state: kind },
      kind === '404' ? { status: 404 } : undefined,
    );
    assert.ok(Object.hasOwn(state, 'followUpOutlineJobId'));
    assert.equal(state.followUpOutlineJobId, undefined);
    assert.equal(Object.hasOwn(state, 'followUpOutlineDraft'), false);
    assert.match(String(state.error), /重试/);
    cleanup();
  }
});

void test('transient recovery failures poll the same task and cleanup prevents later UI changes', async () => {
  const { state, timers, cleanup, requests } = await startRecovery(null, {
    status: 503,
  });
  assert.equal(Object.hasOwn(state, 'followUpOutlineJobId'), false);
  assert.equal(timers[0].delay, 5000);
  timers[0].action();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests(), 2);
  const previous = { ...state };
  cleanup();
  timers[1].action();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(state, previous);
  assert.equal(requests(), 2);
});
