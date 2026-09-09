import { validateInput } from '../../lib/interview.ts';
import {
  validateResumeInput,
  validateResumeReading,
} from '../../lib/resume-reading.ts';
import {
  validateWrittenTestSupplement,
  validateWrittenTestSupplementInput,
} from '../../lib/written-test-supplement.ts';
import {
  analyzeWithCodex,
  codexStatus,
  generateWrittenTestSupplementWithCodex,
  readResumeWithCodex,
} from '../codex.ts';
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
export async function runConnector(
  credentials: Credentials,
  signal: AbortSignal,
  dependencies: {
    analyze: typeof analyzeWithCodex;
    status: typeof codexStatus;
    readResume?: typeof readResumeWithCodex;
    writeTest?: typeof generateWrittenTestSupplementWithCodex;
  } = { analyze: analyzeWithCodex, status: codexStatus },
  timings = { pollMs: 3000, heartbeatMs: 5000 },
) {
  const server = validateServer(credentials.server);
  let ready = false,
    lastCheck = 0,
    reportedOffline = false;
  while (!signal.aborted) {
    try {
      if (Date.now() - lastCheck > 30000) {
        ready = (await dependencies.status()).analysis;
        lastCheck = Date.now();
      }
      const response = await connectorRequest(
        server,
        '/api/worker/claim',
        { ready, kinds: ['interview', 'resume', 'written-test'] },
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
        input: unknown;
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
            { id: job.id, lease: job.lease },
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
          let report: unknown,
            failed = false;
          try {
            if (job.kind === 'resume') {
              const input = validateResumeInput(job.input);
              const reading = await (
                dependencies.readResume || readResumeWithCodex
              )(input, taskSignal);
              report = validateResumeReading(reading, input);
            } else if (job.kind === 'written-test') {
              const input = validateWrittenTestSupplementInput(job.input);
              const supplement = await (
                dependencies.writeTest ||
                generateWrittenTestSupplementWithCodex
              )(input, taskSignal);
              report = validateWrittenTestSupplement(supplement, input);
            } else {
              report = await dependencies.analyze(
                validateInput(job.input),
                taskSignal,
              );
            }
          } catch {
            failed = true;
          }
          if (!taskSignal.aborted) {
            for (
              let attempt = 0;
              attempt < 4 && !taskSignal.aborted;
              attempt++
            ) {
              try {
                await connectorRequest(
                  server,
                  '/api/worker/finish',
                  { id: job.id, lease: job.lease, report, failed },
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
