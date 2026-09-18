import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const launcherSource = resolve('scripts/connector-launcher.command');

type LauncherFixture = {
  root: string;
  launcher: string;
  log: string;
  bin: string;
  zdotdir: string;
};

async function launcherFixture(savedCredentials: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'interview-connector-launcher-'));
  const bin = join(root, 'bin');
  const zdotdir = join(root, 'zdotdir');
  const launcher = join(root, '连接云端面试工作台.command');
  const log = join(root, 'node-invocation.txt');
  await mkdir(join(root, 'server'), { recursive: true });
  await mkdir(bin);
  await mkdir(zdotdir);
  await copyFile(launcherSource, launcher);
  await writeFile(join(root, 'server/connector.ts'), '');
  const fakeNode = join(bin, 'node');
  await writeFile(
    fakeNode,
    `#!/bin/sh
if [ "$1" = "-p" ]; then
  printf '24.1.0\\n'
  exit 0
fi
printf '%s\\n' "$PWD" > "$FAKE_NODE_LOG"
printf '%s\\n' "$@" >> "$FAKE_NODE_LOG"
`,
  );
  await chmod(fakeNode, 0o755);
  if (savedCredentials) {
    await mkdir(join(root, '.local'));
    await writeFile(
      join(root, '.local/connector.json'),
      JSON.stringify({ server: 'https://example.test', token: 't', id: 'd' }),
    );
  }
  return { root, launcher, log, bin, zdotdir } satisfies LauncherFixture;
}

function runLauncher(fixture: LauncherFixture, input: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolveRun, reject) => {
      const child = spawn('/bin/zsh', [fixture.launcher], {
        cwd: '/',
        env: {
          ...process.env,
          PATH: `${fixture.bin}:/usr/bin:/bin`,
          ZDOTDIR: fixture.zdotdir,
          FAKE_NODE_LOG: fixture.log,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => resolveRun({ code, stdout, stderr }));
      child.stdin.end(input);
    },
  );
}

async function invocation(fixture: LauncherFixture) {
  const [cwd, ...args] = (await readFile(fixture.log, 'utf8'))
    .trimEnd()
    .split('\n');
  return { cwd, args };
}

void test('launcher starts from its own directory with saved credentials', async (t) => {
  const fixture = await launcherFixture(true);
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await runLauncher(fixture, '\n');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await invocation(fixture), {
    cwd: await realpath(fixture.root),
    args: ['--experimental-strip-types', 'server/connector.ts'],
  });
});

void test('launcher asks only for a pair code on first run', async (t) => {
  const fixture = await launcherFixture(false);
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await runLauncher(fixture, 'pair-code-123\n\n');

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /配对码/);
  assert.deepEqual(await invocation(fixture), {
    cwd: await realpath(fixture.root),
    args: [
      '--experimental-strip-types',
      'server/connector.ts',
      '--server',
      'https://your-server-ip',
      '--pair',
      'pair-code-123',
    ],
  });
});

void test('launcher refuses an empty first-time pair code', async (t) => {
  const fixture = await launcherFixture(false);
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await runLauncher(fixture, '\n\n');

  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /未输入配对码/);
  await assert.rejects(readFile(fixture.log), { code: 'ENOENT' });
});
