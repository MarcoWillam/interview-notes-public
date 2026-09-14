import {
  validateCodexExecutionContract,
  type CodexExecutionContract,
} from '../../lib/codex-execution-contract.ts';
import { codexStatus } from '../codex-runtime.ts';
import { executeCodexContract } from '../contract-executor.ts';
import { connectorRelease } from '../../lib/connector-release.ts';
import type { LocalWorkSampleReference } from '../work-samples/inventory.ts';
export type Credentials = { server: string; token: string; id: string };
export function validateServer(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  )
    throw new Error('连接地址必须是 HTTPS 网站根地址；HTTP 仅允许 localhost。');
  return url.origin;
}
export async function connectorRequest(
  server: string,
  path: string,
  body: unknown,
  token?: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch(validateServer(server) + path, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 403 && path === '/api/pair/redeem')
      throw new Error(
        '配对码可能已失效、已使用或被替换，请在网页重新生成，并确认连接地址与网页一致。',
      );
    if (response.status === 429)
      throw new Error('请求过于频繁，请一分钟后重试。');
    if (response.status === 404)
      throw new Error('未找到连接接口，请确认服务地址与工作台版本。');
    throw new Error(
      response.status === 401
        ? '连接授权失效，请重新配对。'
        : `服务器暂时不可用（HTTP ${response.status}）。`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('服务器响应无效。');
  const decoder = new TextDecoder();
  let text = '',
    size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 600000) {
        await reader.cancel();
        throw new Error('服务器返回内容超限。');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('服务器响应格式无效。');
  }
}
const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
export function workFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/发生变化|哈希/.test(message)) return 'artifact-changed';
  if (/不存在|未找到|已移除/.test(message)) return 'artifact-missing';
  if (/ZIP|压缩|加密|链接|路径|文件数量|读取范围/.test(message))
    return 'artifact-invalid';
  if (/引用|结构|格式|问题|维度|文件依据|复盘题/.test(message))
    return 'validation';
  if (/超时/.test(message)) return 'timeout';
  if (/网络|连接中断/.test(message)) return 'network';
  if (/登录/.test(message)) return 'login';
  if (/额度|请求受限/.test(message)) return 'quota';
  return 'codex';
}
export async function runConnector(
  credentials: Credentials,
  signal: AbortSignal,
  dependencies: {
    status: typeof codexStatus;
    execute?: (
      contract: CodexExecutionContract,
      signal: AbortSignal,
      context: { artifactPath?: string },
    ) => Promise<unknown>;
    workSamples?: () => Promise<{
      artifacts: LocalWorkSampleReference[];
      files: Map<string, string>;
    }>;
  } = { status: codexStatus },
  timings = { pollMs: 3000, heartbeatMs: 5000 },
) {
  const server = validateServer(credentials.server);
  let ready = false,
    lastCheck = 0,
    reportedOffline = false,
    inventory:
      | { artifacts: LocalWorkSampleReference[]; files: Map<string, string> }
      | undefined;
  while (!signal.aborted) {
    try {
      if (Date.now() - lastCheck > 30000) {
        ready = (await dependencies.status()).analysis;
        lastCheck = Date.now();
      }
      if (dependencies.workSamples) {
        try {
          inventory = await dependencies.workSamples();
        } catch {
          // Keep the prior server inventory when a local scan is interrupted.
        }
      }
      const response = await connectorRequest(
        server,
        '/api/worker/claim',
        {
          ready,
          connector: connectorRelease,
          kinds: [
            'interview',
            'resume',
            'written-test',
            'outline',
            ...(dependencies.workSamples ? ['work-sample'] : []),
          ],
          ...(dependencies.workSamples
            ? { capabilities: ['work-sample'] }
            : {}),
          ...(inventory ? { artifacts: inventory.artifacts } : {}),
        },
        credentials.token,
        signal,
      );
      if (reportedOffline) {
        console.log('已恢复与工作台连接。');
        reportedOffline = false;
      }
      const job = response.job as {
        id: string;
        lease: string;
        kind?: string;
        artifactId?: string | null;
        execution: unknown;
      } | null;
      if (job) {
        const task = new AbortController(),
          cancel = () => task.abort();
        signal.addEventListener('abort', cancel, { once: true });
        const taskSignal = AbortSignal.any([signal, task.signal]);
        let lastHeartbeat = Date.now(),
          checking = false;
        const timer = setInterval(() => {
          if (checking) return;
          checking = true;
          void connectorRequest(
            server,
            '/api/worker/heartbeat',
            { id: job.id, lease: job.lease, connector: connectorRelease },
            credentials.token,
            taskSignal,
          )
            .then((result) => {
              lastHeartbeat = Date.now();
              if (result.active !== true) task.abort();
            })
            .catch(() => {
              if (Date.now() - lastHeartbeat > 40000) task.abort();
            })
            .finally(() => {
              checking = false;
            });
        }, timings.heartbeatMs);
        try {
          let execution = validateCodexExecutionContract(job.execution);
          while (!taskSignal.aborted) {
            let report: unknown,
              failed = false,
              failure: string | undefined;
            try {
              const artifactPath = execution.artifact
                ? inventory?.files.get(execution.artifact.id)
                : undefined;
              report = await (dependencies.execute || executeCodexContract)(
                execution,
                taskSignal,
                { artifactPath },
              );
            } catch (error) {
              failed = true;
              failure = workFailure(error);
            }
            let finished: Record<string, unknown> | undefined;
            for (
              let attempt = 0;
              attempt < 4 && !taskSignal.aborted;
              attempt++
            ) {
              try {
                finished = await connectorRequest(
                  server,
                  '/api/worker/finish',
                  { id: job.id, lease: job.lease, report, failed, failure },
                  credentials.token,
                  taskSignal,
                );
                break;
              } catch {
                if (attempt === 3)
                  console.error('结果回传未确认，请在网页查看任务状态。');
                else await delay(3000, taskSignal);
              }
            }
            if (!finished || failed) break;
            const retry = finished.retry;
            if (!retry || typeof retry !== 'object') break;
            execution = validateCodexExecutionContract(
              (retry as Record<string, unknown>).execution,
            );
          }
        } finally {
          clearInterval(timer);
          signal.removeEventListener('abort', cancel);
          task.abort();
        }
      }
    } catch {
      if (!signal.aborted && !reportedOffline) {
        console.error('连接暂不可用，正在重连；若已解除配对，请重新配对。');
        reportedOffline = true;
      }
    }
    await delay(timings.pollMs, signal);
  }
}
