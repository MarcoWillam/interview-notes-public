import { createInterface } from 'node:readline';
import { readFile, rm } from 'node:fs/promises';
import { createWorkSampleMcp } from './mcp.ts';

type Request = {
  jsonrpc?: unknown;
  id?: string | number;
  method?: unknown;
  params?: Record<string, unknown>;
};

const configPath = process.argv[2];
if (!configPath) throw new Error('缺少作品读取配置。');
const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  root: string;
  readable: string[];
};
await rm(configPath, { force: true });
const mcp = createWorkSampleMcp(config);

function send(value: unknown) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let request: Request;
  try {
    request = JSON.parse(line) as Request;
  } catch {
    continue;
  }
  if (request.id === undefined) continue;
  try {
    if (request.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'interview-work-sample', version: '1.0.0' },
        },
      });
    } else if (request.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: { tools: mcp.toolDefinitions() },
      });
    } else if (request.method === 'tools/call') {
      const params = request.params || {};
      const name = typeof params.name === 'string' ? params.name : '';
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      send({ jsonrpc: '2.0', id: request.id, result: await mcp.call(name, args) });
    } else {
      throw new Error('接口不存在。');
    }
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        isError: true,
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : '作品读取失败。',
          },
        ],
      },
    });
  }
}
