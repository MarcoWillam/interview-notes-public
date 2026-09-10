import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { WorkSampleReference } from '../../lib/work-sample.ts';

async function fileSha256(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function ensureWorkSampleInbox(baseDirectory = process.cwd()) {
  const path = resolve(baseDirectory, 'works');
  await mkdir(path, { recursive: true, mode: 0o700 });
  return path;
}

export async function scanWorkSampleInbox(
  inbox: string,
  deviceId: string,
  options: {
    cachePath?: string;
    hashFile?: (path: string) => Promise<string>;
  } = {},
): Promise<{
  artifacts: WorkSampleReference[];
  files: Map<string, string>;
}> {
  const artifacts: WorkSampleReference[] = [];
  const files = new Map<string, string>();
  const cachePath =
    options.cachePath || resolve(inbox, '..', '.local', 'work-index.json');
  type CacheEntry = { bytes: number; modifiedAt: number; sha256: string };
  let cache: Record<string, CacheEntry> = {};
  try {
    cache = JSON.parse(await readFile(cachePath, 'utf8')) as Record<
      string,
      CacheEntry
    >;
  } catch {
    // The cache is optional and recreated after a missing or invalid file.
  }
  const nextCache: Record<string, CacheEntry> = {};
  for (const entry of await readdir(inbox, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.zip$/i.test(entry.name)) continue;
    const path = join(inbox, entry.name);
    const info = await stat(path);
    if (!info.size || info.size > 50 * 1024 * 1024) continue;
    const modifiedAt = Math.round(info.mtimeMs);
    const cached = cache[entry.name];
    const sha256 =
      cached?.bytes === info.size && cached.modifiedAt === modifiedAt
        ? cached.sha256
        : await (options.hashFile || fileSha256)(path);
    nextCache[entry.name] = { bytes: info.size, modifiedAt, sha256 };
    const id =
      'artifact-' +
      createHash('sha256')
        .update(deviceId + '\n' + sha256)
        .digest('hex')
        .slice(0, 24);
    const artifact: WorkSampleReference = {
      id,
      deviceId,
      name: basename(entry.name),
      sha256,
      bytes: info.size,
      modifiedAt,
    };
    artifacts.push(artifact);
    files.set(id, path);
  }
  await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
  await writeFile(cachePath, JSON.stringify(nextCache), { mode: 0o600 });
  artifacts.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return { artifacts, files };
}
