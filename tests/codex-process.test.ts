import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runCommand,
  codexEnvironment,
  codexArgs,
  codexCommandCandidates,
  findReadyCodexCommand,
} from '../server/codex.ts';
void test('Codex environment never inherits API keys or application secrets', () => {
  assert.deepEqual(
    codexEnvironment({
      HOME: '/tmp/test',
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'private',
      CODEX_API_KEY: 'private',
      ASR_API_KEY: 'private',
    }),
    { NODE_ENV: 'production', HOME: '/tmp/test', PATH: '/usr/bin' },
  );
  const args = codexArgs('/tmp/fixture');
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ephemeral'));
  assert.ok(args.includes('read-only'));
  assert.ok(args.includes('forced_login_method="chatgpt"'));
});
void test('process accepts literal stdin without shell interpolation and captures final output', async () => {
  const input = '$(echo unsafe) `echo unsafe`\n面试正文';
  const result = await runCommand(
    process.execPath,
    ['-e', 'process.stdin.pipe(process.stdout)'],
    { input },
  );
  assert.equal(result.stdout, input);
  assert.equal(result.code, 0);
});
void test('timeout and cancellation stop a running process', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      timeoutMs: 30,
    }),
    /超时/,
  );
  const controller = new AbortController();
  const running = runCommand(
    process.execPath,
    ['-e', 'setInterval(()=>{},1000)'],
    { signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(running, /取消/);
});
void test('excessive output and missing executable produce safe errors', async () => {
  await assert.rejects(
    runCommand(process.execPath, [
      '-e',
      'process.stdout.write("x".repeat(600000))',
    ]),
    /超过限制/,
  );
  await assert.rejects(runCommand('/missing-interview-codex', []), /无法启动/);
});

void test('macOS connector falls back to an app-bundled Codex CLI', async () => {
  const candidates = codexCommandCandidates({}, 'darwin');
  assert.deepEqual(candidates, [
    'codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
  ]);
  const attempts: string[] = [];
  const result = await findReadyCodexCommand(
    {},
    'darwin',
    async (command) => {
      attempts.push(command);
      if (command === 'codex') throw new Error('missing from PATH');
      return {
        stdout: 'Logged in using ChatGPT\n',
        stderr: '',
        code: 0,
      };
    },
  );
  assert.equal(
    result.command,
    '/Applications/ChatGPT.app/Contents/Resources/codex',
  );
  assert.equal(result.analysis, true);
  assert.deepEqual(attempts, [
    'codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
  ]);
});

void test('explicit Codex binary remains authoritative', () => {
  assert.deepEqual(
    codexCommandCandidates(
      { INTERVIEW_CODEX_BIN: '/opt/company/codex' },
      'darwin',
    ),
    ['/opt/company/codex'],
  );
});
