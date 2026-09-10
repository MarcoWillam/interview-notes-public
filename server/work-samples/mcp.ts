import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { extname, resolve, sep } from 'node:path';
import { safeWorkSamplePath } from '../../lib/interview-questions.ts';

type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | {
      type: 'resource';
      resource: { uri: string; mimeType: string; blob: string };
    };

export type McpToolResult = { content: McpContent[]; isError?: boolean };

const TEXT_EXTENSIONS = new Set([
  '',
  '.md',
  '.mdx',
  '.txt',
  '.text',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.vue',
  '.svelte',
  '.html',
  '.css',
  '.scss',
  '.less',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.sql',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sh',
  '.graphql',
  '.gql',
  '.proto',
  '.svg',
]);
const DOCUMENT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function text(value: unknown, maximum: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new Error('作品读取参数无效。');
  return value;
}

export function createWorkSampleMcp(options: {
  root: string;
  readable: string[];
  maximumBytes?: number;
}) {
  const root = resolve(options.root);
  const canonicalRoot = realpath(root);
  const readable = new Set(options.readable.map(safeWorkSamplePath));
  const maximumBytes = options.maximumBytes ?? 32 * 1024 * 1024;
  let consumed = 0;

  async function allowedFile(relative: unknown, limit: number) {
    let path: string;
    try {
      path = safeWorkSamplePath(relative);
    } catch {
      throw new Error('无法读取该作品文件。');
    }
    if (!readable.has(path)) throw new Error('无法读取该作品文件。');
    const target = resolve(root, ...path.split('/'));
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
        throw new Error();
      const canonical = await realpath(target);
      const confinedRoot = await canonicalRoot;
      if (
        canonical !== confinedRoot &&
        !canonical.startsWith(confinedRoot + sep)
      )
        throw new Error();
      return { path, target: canonical, bytes: info.size };
    } catch {
      throw new Error('无法读取该作品文件。');
    }
  }

  function consume(bytes: number) {
    if (consumed + bytes > maximumBytes)
      throw new Error('本次作品读取量已达到限制。');
    consumed += bytes;
  }

  async function readText(relative: unknown) {
    const file = await allowedFile(relative, 2 * 1024 * 1024);
    if (!TEXT_EXTENSIONS.has(extname(file.path).toLowerCase()))
      throw new Error('该文件需要使用对应的文档或图片读取工具。');
    consume(file.bytes);
    const data = await readFile(file.target);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (source.includes(String.fromCharCode(0)))
      throw new Error('无法将二进制文件作为文字读取。');
    return { path: file.path, source };
  }

  const toolNames = () => [
    'list_files',
    'search_files',
    'read_text',
    'read_document',
    'read_image',
  ];

  const toolDefinitions = () => [
    {
      name: 'list_files',
      description: '列出本次笔试作品中允许读取的相对文件路径。',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'search_files',
      description: '在允许读取的文字文件中搜索一段连续文字。',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 1, maxLength: 200 } },
        required: ['query'],
        additionalProperties: false,
      },
    },
    ...(['read_text', 'read_document', 'read_image'] as const).map((name) => ({
      name,
      description:
        name === 'read_text'
          ? '读取一个允许的 UTF-8 文字或源码文件。'
          : name === 'read_document'
            ? '读取一个允许的 PDF、DOC 或 DOCX 文档资源。'
            : '读取一个允许的 PNG、JPEG 或 WebP 图片。',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', minLength: 1, maxLength: 500 } },
        required: ['path'],
        additionalProperties: false,
      },
    })),
  ];

  async function call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    if (name === 'list_files') {
      const files = await Promise.all(
        [...readable].sort().map(async (path) => {
          const file = await allowedFile(path, 10 * 1024 * 1024);
          return { path: file.path, bytes: (await stat(file.target)).size };
        }),
      );
      return { content: [{ type: 'text', text: JSON.stringify(files) }] };
    }
    if (name === 'search_files') {
      const query = text(args.query, 200);
      const matches: { path: string; line: number; text: string }[] = [];
      for (const path of [...readable].sort()) {
        if (
          matches.length >= 50 ||
          !TEXT_EXTENSIONS.has(extname(path).toLowerCase())
        )
          continue;
        let file: { path: string; source: string };
        try {
          file = await readText(path);
        } catch {
          continue;
        }
        for (const [index, line] of file.source.split(/\r?\n/).entries()) {
          if (line.includes(query))
            matches.push({ path, line: index + 1, text: line.slice(0, 1000) });
          if (matches.length >= 50) break;
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(matches) }] };
    }
    if (name === 'read_text') {
      const file = await readText(args.path);
      return {
        content: [
          { type: 'text', text: `文件：${file.path}\n\n${file.source}` },
        ],
      };
    }
    if (name === 'read_document') {
      const file = await allowedFile(args.path, 10 * 1024 * 1024);
      const mimeType = DOCUMENT_MIME[extname(file.path).toLowerCase()];
      if (!mimeType) throw new Error('该文件不是支持的文档格式。');
      consume(file.bytes);
      return {
        content: [
          {
            type: 'resource',
            resource: {
              uri: `work-sample:///${encodeURIComponent(file.path)}`,
              mimeType,
              blob: Buffer.from(await readFile(file.target)).toString('base64'),
            },
          },
        ],
      };
    }
    if (name === 'read_image') {
      const file = await allowedFile(args.path, 5 * 1024 * 1024);
      const mimeType = IMAGE_MIME[extname(file.path).toLowerCase()];
      if (!mimeType) throw new Error('该文件不是支持的图片格式。');
      consume(file.bytes);
      return {
        content: [
          {
            type: 'image',
            mimeType,
            data: Buffer.from(await readFile(file.target)).toString('base64'),
          },
        ],
      };
    }
    throw new Error('不支持该作品读取操作。');
  }

  return { toolNames, toolDefinitions, call };
}
