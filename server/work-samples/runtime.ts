import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import {
  validateCodexExecutionContract,
  validateCodexExecutionResult,
  type CodexExecutionContract,
} from '../../lib/codex-execution-contract.ts';
import { AnalysisError } from '../analysis-error.ts';
import { runStructuredCodexWithWorkSample } from '../codex-runtime.ts';
import {
  extractWorkSampleBytes,
  type WorkSampleManifest,
} from './archive.ts';
import { safeLocalWorkSamplePath } from './path.ts';

type RunStructured = typeof runStructuredCodexWithWorkSample;

type Dependencies = {
  runStructured?: RunStructured;
  createDirectory?: () => Promise<string>;
};

async function verifiedArchiveBytes(
  path: string,
  contract: CodexExecutionContract,
) {
  const artifact = contract.artifact;
  if (!artifact) throw new AnalysisError('作品执行合同缺少附件。', 409);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size !== artifact.bytes) throw new Error();
    const bytes = new Uint8Array(await handle.readFile());
    if (
      bytes.byteLength !== artifact.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
    )
      throw new Error();
    return bytes;
  } catch {
    throw new AnalysisError(
      '本地笔试作品已移除或发生变化，请刷新后重新选择。',
      409,
    );
  } finally {
    await handle?.close();
  }
}

function actualCoverage(manifest: WorkSampleManifest) {
  return {
    analyzed: manifest.readable,
    excluded: manifest.excluded,
    unsupported: manifest.unsupported,
    truncated: false,
  };
}

function pointerParts(pointer: string) {
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function atPointer(value: unknown, pointer: string): unknown {
  let current = value;
  for (const part of pointerParts(pointer)) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function replaceAtPointer(value: unknown, pointer: string, replacement: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('作品结果格式不正确。');
  const root = structuredClone(value) as Record<string, unknown>;
  const parts = pointerParts(pointer);
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    const next = parent[part];
    if (!next || typeof next !== 'object' || Array.isArray(next))
      throw new Error('作品结果缺少覆盖范围。');
    parent = next as Record<string, unknown>;
  }
  parent[parts.at(-1)!] = replacement;
  return root;
}

async function verifyEvidence(
  result: unknown,
  rules: NonNullable<CodexExecutionContract['artifact']>['evidenceRules'],
  root: string,
  readable: string[],
) {
  const evidenceItems: Array<{ path: unknown; excerpt: unknown }> = [];
  for (const rule of rules) {
    const collection = atPointer(result, rule.collectionPointer);
    if (!Array.isArray(collection))
      throw new Error('作品结果缺少文件依据。');
    for (const item of collection) {
      const evidence = rule.evidencePointer
        ? atPointer(item, rule.evidencePointer)
        : item;
      const entries = rule.evidenceArray
        ? Array.isArray(evidence)
          ? evidence
          : []
        : evidence === undefined || evidence === null
          ? []
          : [evidence];
      if (rule.required && !entries.length)
        throw new Error('作品结果缺少文件依据。');
      for (const entry of entries)
        evidenceItems.push({
          path: atPointer(entry, rule.pathPointer),
          excerpt: atPointer(entry, rule.excerptPointer),
        });
    }
  }
  const allowed = new Set(readable);
  const cache = new Map<string, string>();
  for (const item of evidenceItems) {
    const path = safeLocalWorkSamplePath(item.path);
    if (!allowed.has(path)) throw new Error('作品证据文件不在允许范围内。');
    if (typeof item.excerpt !== 'string' || !item.excerpt.trim())
      throw new Error('作品证据引用为空。');
    let source = cache.get(path);
    if (source === undefined) {
      const extension = extname(path).toLowerCase();
      if (
        ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp'].includes(
          extension,
        )
      )
        throw new Error('作品证据文件不支持逐字核验。');
      const target = resolve(root, ...path.split('/'));
      const bytes = await readFile(target);
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (source.includes(String.fromCharCode(0)))
        throw new Error('作品证据文件不是文本。');
      cache.set(path, source);
    }
    if (!source.includes(item.excerpt))
      throw new Error('作品证据引用无法在文件中找到。');
  }
}

export async function executeWorkSampleContract(
  value: CodexExecutionContract,
  zipPath: string,
  signal: AbortSignal,
  dependencies: Dependencies = {},
) {
  const contract = validateCodexExecutionContract(value);
  if (contract.runner !== 'structured-work-sample' || !contract.artifact)
    throw new Error('作品执行器收到错误合同。');
  signal.throwIfAborted();
  const archiveBytes = await verifiedArchiveBytes(zipPath, contract);
  const directory = await (
    dependencies.createDirectory ||
    (() => mkdtemp(join(tmpdir(), 'interview-work-sample-')))
  )();
  try {
    const manifest = await extractWorkSampleBytes(archiveBytes, directory);
    signal.throwIfAborted();
    if (
      !contract.payload ||
      typeof contract.payload !== 'object' ||
      Array.isArray(contract.payload)
    )
      throw new Error('作品执行资料格式不正确。');
    const coverage = actualCoverage(manifest);
    const raw = await (
      dependencies.runStructured || runStructuredCodexWithWorkSample
    )(
      { ...contract.payload, workSampleCoverage: coverage },
      signal,
      contract.instructions,
      contract.schema,
      { root: directory, readable: manifest.readable },
    );
    const result = replaceAtPointer(
      validateCodexExecutionResult(raw),
      contract.artifact.coveragePointer,
      coverage,
    );
    await verifyEvidence(
      result,
      contract.artifact.evidenceRules,
      directory,
      manifest.readable,
    );
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
