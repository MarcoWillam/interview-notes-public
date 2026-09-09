import {
  validateResumeInput,
  validateResumeReading,
  type ResumeInput,
  type ResumeReading,
} from './resume-reading.ts';
import {
  validateInput,
  validateReport,
  type InterviewInput,
  type Report,
} from './interview.ts';
import {
  validateWrittenTestSupplement,
  validateWrittenTestSupplementInput,
  type WrittenTestSupplementInput,
  type WrittenTestSupplementResult,
} from './written-test-supplement.ts';
let account: string | null = null;
export function configureRemoteAccount(value: string) {
  account = value;
}
const pendingSubmissions = new Map<string, string>();
class RemoteError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export type RemoteJob<T = Report> = {
  kind?: 'interview' | 'resume' | 'written-test';
  id: string;
  label: string;
  state:
    | 'queued'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled';
  created: number;
  updated: number;
  queuedAt?: number;
  startedAt?: number | null;
  position?: number | null;
  report?: T | null;
  error?: string | null;
};
export async function remoteRequest<T>(
  path: string,
  options: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (account) headers.set('X-Interview-Account', account);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const response = await fetcher(path, {
    ...options,
    headers,
    signal: AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new RemoteError(
      response.status === 401
        ? '登录已过期，请刷新网页重新登录。'
        : data.error || '请求失败，请稍后重试。',
      response.status,
    );
  return data;
}
export function controlRemoteJob(
  id: string,
  action: 'pause' | 'resume' | 'stop',
  fetcher: typeof fetch = fetch,
) {
  return remoteRequest<RemoteJob>(
    '/api/jobs/' + encodeURIComponent(id) + '/action',
    { method: 'POST', body: JSON.stringify({ action }) },
    fetcher,
  );
}
async function submitRemoteTask<T>(
  input: InterviewInput | ResumeInput | WrittenTestSupplementInput,
  kind: 'interview' | 'resume' | 'written-test',
  validateResult: (value: unknown) => T,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<T>) => void,
  dependencies: {
    fetcher: typeof fetch;
    pollMs: number;
    scope?: string;
  } = { fetcher: fetch, pollMs: 2000 },
): Promise<T> {
  const scope = dependencies.scope?.trim() || '';
  const payload = JSON.stringify({
    ...(kind === 'interview' ? {} : { kind }),
    label,
    input,
    ...(scope ? { scope } : {}),
  });
  const fingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)),
    ),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('');
  const storageKey = `interview-pending-submit:${account || 'local'}:${fingerprint}`;
  let client = pendingSubmissions.get(storageKey);
  try {
    client ||= localStorage.getItem(storageKey) || undefined;
  } catch {
    /* Memory fallback if localStorage is unavailable. */
  }
  client ||= crypto.randomUUID();
  pendingSubmissions.set(storageKey, client);
  try {
    localStorage.setItem(storageKey, client);
  } catch {
    /* Same-tab retries still preserve their identifier. */
  }
  let job: RemoteJob<T>;
  try {
    job = await remoteRequest<RemoteJob<T>>(
      '/api/jobs',
      {
        method: 'POST',
        body: JSON.stringify({
          client,
          label,
          input,
          kind,
          ...(scope ? { scope } : {}),
        }),
        signal,
      },
      dependencies.fetcher,
    );
  } catch (e) {
    if (signal.aborted || e instanceof RemoteError) throw e;
    throw new Error(
      '提交结果尚未确认，请先在“评估任务”中查看。再次提交相同材料会沿用原任务标识，避免重复分析。',
    );
  }
  pendingSubmissions.delete(storageKey);
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* Optional retry persistence. */
  }
  while (true) {
    onProgress(job);
    signal.throwIfAborted();
    if (job.state === 'completed') return validateResult(job.report);
    if (job.state === 'failed' || job.state === 'cancelled')
      throw new Error(job.error || '任务已取消。');
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, dependencies.pollMs);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      job = await remoteRequest<RemoteJob<T>>(
        '/api/jobs/' + encodeURIComponent(job.id),
        { signal },
        dependencies.fetcher,
      );
    } catch (e) {
      if (signal.aborted) throw e;
      throw new Error(
        '任务已提交，但暂时无法获取进度。请在“评估任务”中查看结果；无需重复提交。',
      );
    }
  }
}

export function submitRemoteAnalysis(
  input: InterviewInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob) => void,
  dependencies = { fetcher: fetch, pollMs: 2000 },
): Promise<Report> {
  return submitRemoteTask(
    validateInput(input),
    'interview',
    (value) => validateReport(value, input),
    label,
    signal,
    onProgress,
    dependencies,
  );
}
export function submitRemoteResume(
  input: ResumeInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<ResumeReading>) => void,
  dependencies: {
    fetcher: typeof fetch;
    pollMs: number;
    scope?: string;
  } = { fetcher: fetch, pollMs: 2000 },
): Promise<ResumeReading> {
  const normalized = validateResumeInput(input);
  return submitRemoteTask(
    normalized,
    'resume',
    (value) => validateResumeReading(value, normalized),
    label,
    signal,
    onProgress,
    dependencies,
  );
}

export function submitRemoteWrittenTest(
  input: WrittenTestSupplementInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<WrittenTestSupplementResult>) => void,
  dependencies = { fetcher: fetch, pollMs: 2000 },
): Promise<WrittenTestSupplementResult> {
  const normalized = validateWrittenTestSupplementInput(input);
  return submitRemoteTask(
    normalized,
    'written-test',
    (value) => validateWrittenTestSupplement(value, normalized),
    label,
    signal,
    onProgress,
    dependencies,
  );
}
