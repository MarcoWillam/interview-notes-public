import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCodexContract } from '../server/contract-executor.ts';

const contract = {
  contractVersion: 1,
  runner: 'structured-text',
  instructions: '只返回 JSON。',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  payload: { resumeText: '候选人资料' },
  attempt: 1,
  maxAttempts: 2,
} as const;

void test('generic contract executor passes only server instructions, schema and payload', async () => {
  const seen: unknown[] = [];
  const result = await executeCodexContract(
    contract,
    new AbortController().signal,
    {},
    {
      text: async (...args) => {
        seen.push(...args.slice(0, 1), args[2], args[3]);
        return { summary: '完成' };
      },
    },
  );
  assert.deepEqual(result, { summary: '完成' });
  assert.deepEqual(seen, [
    contract.payload,
    contract.instructions,
    contract.schema,
  ]);
});

void test('generic contract executor refuses unknown runners and missing local artifacts', async () => {
  await assert.rejects(
    () =>
      executeCodexContract(
        { ...contract, runner: 'shell' },
        new AbortController().signal,
      ),
    /执行器类型/,
  );
  await assert.rejects(
    () =>
      executeCodexContract(
        {
          ...contract,
          runner: 'structured-work-sample',
          artifact: {
            id: 'artifact-12345678',
            sha256: 'a'.repeat(64),
            bytes: 1024,
            coveragePointer: '/coverage',
            evidencePointer: '/questions',
          },
        },
        new AbortController().signal,
      ),
    /本地作品不存在/,
  );
});
