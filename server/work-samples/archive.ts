import { readFile, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { MAX_CONTRACT_ARTIFACT_BYTES } from '../../lib/codex-execution-contract.ts';

const MAX_EXPANDED_BYTES = 300 * 1024 * 1024;
const MAX_FILES = 3000;
const MAX_DEPTH = 20;
const MAX_RATIO = 1000;

export type WorkSampleManifest = {
  readable: string[];
  excluded: string[];
  unsupported: string[];
};

type ZipEntry = {
  name: string;
  compressed: number;
  original: number;
  flags: number;
  method: number;
  external: number;
};

function inspectZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset--
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP 格式无效或已损坏。');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (count > MAX_FILES) throw new Error('ZIP 文件数量超过 3,000 个。');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (
      offset + 46 > bytes.length ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw new Error('ZIP 目录结构无效。');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const end = offset + 46 + nameLength;
    if (end > bytes.length) throw new Error('ZIP 文件名无效。');
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(offset + 46, end));
    } catch {
      throw new Error('ZIP 文件名必须使用 UTF-8。');
    }
    entries.push({
      name,
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      compressed: view.getUint32(offset + 20, true),
      original: view.getUint32(offset + 24, true),
      external: view.getUint32(offset + 38, true),
    });
    offset = end + extraLength + commentLength;
  }
  return entries;
}

function safePath(name: string) {
  const path = name.replaceAll('\\', '/').replace(/\/$/, '');
  const parts = path.split('/');
  if (
    !path ||
    path.startsWith('/') ||
    /^[a-z]:\//i.test(path) ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    parts.length > MAX_DEPTH
  )
    throw new Error('ZIP 包含不安全或过深的文件路径。');
  return path;
}

function excludedPath(path: string) {
  const lower = path.toLowerCase();
  const parts = lower.split('/');
  const base = parts.at(-1)!;
  return (
    parts.includes('__macosx') ||
    base.startsWith('._') ||
    parts.some((part) =>
      [
        '.git',
        'node_modules',
        'dist',
        'build',
        'coverage',
        '.next',
        '.cache',
      ].includes(part),
    ) ||
    base === '.env' ||
    base.startsWith('.env.') ||
    /(?:^|[._-])(credentials?|secrets?|tokens?)(?:[._-]|$)/i.test(base) ||
    /\.(?:pem|key|p12|pfx)$/i.test(base) ||
    /^(?:id_rsa|id_ed25519)(?:\.pub)?$/i.test(base)
  );
}

function decodedUnzipPath(name: string) {
  for (let index = 0; index < name.length; index++)
    if (name.charCodeAt(index) > 255) return name;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from({ length: name.length }, (_, index) =>
        name.charCodeAt(index),
      ),
    );
  } catch {
    return name;
  }
}

function supportedPath(path: string) {
  const base = path.split('/').at(-1)!;
  return (
    /^(?:readme|license|dockerfile|makefile)$/i.test(base) ||
    /\.(?:md|mdx|txt|text|js|jsx|mjs|cjs|ts|tsx|vue|svelte|html|css|scss|less|json|jsonc|ya?ml|toml|xml|csv|sql|py|java|go|rs|rb|php|sh|graphql|gql|proto|pdf|doc|docx|png|jpe?g|webp|svg)$/i.test(
      base,
    )
  );
}

function nestedArchive(path: string) {
  return /\.(?:zip|rar|7z|tar|tgz|gz|bz2|xz)$/i.test(path);
}

export async function extractWorkSample(
  zipPath: string,
  outputDirectory: string,
): Promise<WorkSampleManifest> {
  const bytes = new Uint8Array(await readFile(zipPath));
  if (!bytes.length || bytes.length > MAX_CONTRACT_ARTIFACT_BYTES)
    throw new Error('笔试作品 ZIP 不能为空且不能超过 50 MB。');
  const entries = inspectZip(bytes);
  let expanded = 0;
  const names = new Map<string, string>();
  const readable: string[] = [];
  const excluded: string[] = [];
  const unsupported: string[] = [];
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    const path = safePath(entry.name);
    const key = path.toLowerCase();
    if (names.has(key)) throw new Error('ZIP 包含重复文件路径。');
    names.set(key, path);
    if (entry.flags & 1) throw new Error('不支持加密 ZIP。');
    const unixType = (entry.external >>> 16) & 0o170000;
    if (unixType === 0o120000) throw new Error('ZIP 不能包含链接。');
    if (![0, 8].includes(entry.method))
      throw new Error('ZIP 使用了不支持的压缩方式。');
    expanded += entry.original;
    if (expanded > MAX_EXPANDED_BYTES)
      throw new Error('ZIP 解压后不能超过 300 MB。');
    if (
      entry.original > 1024 * 1024 &&
      (!entry.compressed || entry.original / entry.compressed > MAX_RATIO)
    )
      throw new Error('ZIP 压缩比异常，已停止读取。');
    if (nestedArchive(path)) throw new Error('ZIP 不能包含嵌套压缩包。');
    if (excludedPath(path)) excluded.push(path);
    else if (!supportedPath(path)) unsupported.push(path);
    else readable.push(path);
  }
  if (!readable.length) throw new Error('ZIP 中没有可读取的作品文件。');
  const allowed = new Set(readable);
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes, {
      filter: (entry) => allowed.has(safePath(decodedUnzipPath(entry.name))),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && /不安全|过深/.test(error.message)
        ? error.message
        : 'ZIP 解压失败或文件已损坏。',
    );
  }
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  for (const [originalName, data] of Object.entries(unpacked)) {
    if (originalName.endsWith('/')) continue;
    const path = safePath(decodedUnzipPath(originalName));
    if (!allowed.has(path)) continue;
    const destination = resolve(outputDirectory, ...path.split('/'));
    if (!destination.startsWith(resolve(outputDirectory) + '/'))
      throw new Error('ZIP 文件路径越界。');
    await mkdir(resolve(destination, '..'), { recursive: true, mode: 0o700 });
    await writeFile(destination, data, { mode: 0o600 });
  }
  return { readable, excluded, unsupported };
}

export async function cleanupStaleWorkSampleDirectories(
  root = tmpdir(),
  olderThan = Date.now() - 24 * 60 * 60 * 1000,
) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith('interview-work-sample-')
    )
      continue;
    const path = join(root, entry.name);
    const info = await import('node:fs/promises').then(({ stat }) =>
      stat(path),
    );
    if (info.mtimeMs < olderThan)
      await rm(path, { recursive: true, force: true });
  }
}
