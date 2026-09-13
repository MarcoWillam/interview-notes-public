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
import {
  validateWorkSampleAnalysisResult,
  validateWorkSampleInput,
  validateWorkSampleReference,
  type WorkSampleAssessment,
  type WorkSampleAnalysisResult,
  type WorkSampleAnalysisV2,
  type WorkSampleInput,
  type WorkSampleInputV1,
  type WorkSampleInputV2,
  type WorkSampleReference,
} from './work-sample.ts';
import {
  validateOutlineRegenerationInput,
  validateOutlineRegenerationResult,
  type OutlineRegenerationInput,
  type OutlineRegenerationResult,
} from './outline-regeneration.ts';
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
  kind?: 'interview' | 'resume' | 'written-test' | 'work-sample' | 'outline';
  id: string;
  label: string;
  state: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  created: number;
  updated: number;
  queuedAt?: number;
  startedAt?: number | null;
  position?: number | null;
  report?: T | null;
  error?: string | null;
  artifactId?: string | null;
  targetDeviceName?: string | null;
  waitingForDevice?: boolean;
  requiredProtocol?: number;
};
export type RemoteArtifact = WorkSampleReference & {
  deviceName: string;
  available: boolean;
  syncedAt: number;
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
  input:
    | InterviewInput
    | ResumeInput
    | WrittenTestSupplementInput
    | WorkSampleInput
    | OutlineRegenerationInput,
  kind: 'interview' | 'resume' | 'written-test' | 'work-sample' | 'outline',
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

export async function listRemoteArtifacts(
  fetcher: typeof fetch = fetch,
): Promise<RemoteArtifact[]> {
  const result = await remoteRequest<{ artifacts: unknown[] }>(
    '/api/artifacts',
    {},
    fetcher,
  );
  if (!Array.isArray(result.artifacts) || result.artifacts.length > 100)
    throw new Error('作品清单格式无效。');
  return result.artifacts.map((value) => {
    if (!value || typeof value !== 'object')
      throw new Error('作品清单格式无效。');
    const item = value as Record<string, unknown>;
    const allowed = new Set([
      'id',
      'deviceId',
      'name',
      'sha256',
      'bytes',
      'modifiedAt',
      'deviceName',
      'available',
      'syncedAt',
    ]);
    if (Object.keys(item).some((key) => !allowed.has(key)))
      throw new Error('作品清单格式无效。');
    const reference = validateWorkSampleReference(item);
    if (
      typeof item.deviceName !== 'string' ||
      !item.deviceName.trim() ||
      item.deviceName.length > 80 ||
      typeof item.available !== 'boolean' ||
      !Number.isSafeInteger(item.syncedAt) ||
      Number(item.syncedAt) < 0
    )
      throw new Error('作品清单格式无效。');
    return {
      ...reference,
      deviceName: item.deviceName.trim(),
      available: item.available,
      syncedAt: Number(item.syncedAt),
    };
  });
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
    (value) =>
      validateResumeReading(value, normalized, { conciseQuestions: true }),
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
  dependencies: {
    fetcher: typeof fetch;
    pollMs: number;
    scope?: string;
  } = { fetcher: fetch, pollMs: 2000 },
): Promise<WrittenTestSupplementResult> {
  const normalized = validateWrittenTestSupplementInput(input);
  return submitRemoteTask(
    normalized,
    'written-test',
    (value) =>
      validateWrittenTestSupplement(value, normalized, {
        conciseQuestions: true,
      }),
    label,
    signal,
    onProgress,
    dependencies,
  );
}

export function submitRemoteWorkSample(
  input: WorkSampleInputV1,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<WorkSampleAssessment>) => void,
  dependencies?: {
    fetcher: typeof fetch;
    pollMs: number;
    scope?: string;
  },
): Promise<WorkSampleAssessment>;
export function submitRemoteWorkSample(
  input: WorkSampleInputV2,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<WorkSampleAnalysisV2>) => void,
  dependencies?: {
    fetcher: typeof fetch;
    pollMs: number;
    scope?: string;
  },
): Promise<WorkSampleAnalysisV2>;
export function submitRemoteWorkSample(
  input: WorkSampleInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<never>) => void,
  dependencies: {
    fetcher: typeof fetch;
    pollMs: number;
    scope?: string;
  } = { fetcher: fetch, pollMs: 2000 },
): Promise<WorkSampleAnalysisResult> {
  const normalized = validateWorkSampleInput(input);
  return submitRemoteTask(
    normalized,
    'work-sample',
    (value) =>
      validateWorkSampleAnalysisResult(value, normalized, {
        conciseQuestions: true,
      }),
    label,
    signal,
    onProgress as (job: RemoteJob<WorkSampleAnalysisResult>) => void,
    dependencies,
  );
}

export function submitRemoteOutline(
  input: OutlineRegenerationInput,
  label: string,
  signal: AbortSignal,
  onProgress: (job: RemoteJob<OutlineRegenerationResult>) => void,
  dependencies: {
    fetcher: typeof fetch;
    pollMs: number;
    scope?: string;
  } = { fetcher: fetch, pollMs: 2000 },
): Promise<OutlineRegenerationResult> {
  const normalized = validateOutlineRegenerationInput(input);
  return submitRemoteTask(
    normalized,
    'outline',
    (value) => validateOutlineRegenerationResult(value, normalized),
    label,
    signal,
    onProgress,
    dependencies,
  );
}
