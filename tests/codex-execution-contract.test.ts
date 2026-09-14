import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateCodexExecutionContract,
  type CodexExecutionContract,
} from '../lib/codex-execution-contract.ts';

const textContract = {
  contractVersion: 1,
  runner: 'structured-text',
  instructions: '只返回符合结构的 JSON。',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary'],
    properties: { summary: { type: 'string' } },
  },
  payload: { transcript: '候选人回答' },
  attempt: 1,
  maxAttempts: 2,
} satisfies CodexExecutionContract;

void test('execution contract accepts a closed structured-text task', () => {
  assert.deepEqual(validateCodexExecutionContract(textContract), textContract);
});

void test('work-sample execution requires bounded artifact verification pointers', () => {
  const contract = validateCodexExecutionContract({
    ...textContract,
    runner: 'structured-work-sample',
    artifact: {
      id: 'artifact-12345678',
      sha256: 'a'.repeat(64),
      bytes: 4096,
      coveragePointer: '/workSample/coverage',
      evidenceRules: [
        {
          collectionPointer: '/workSample/questions',
          evidencePointer: '/workSampleEvidence',
          evidenceArray: false,
          required: true,
          pathPointer: '/path',
          excerptPointer: '/excerpt',
        },
      ],
    },
  });
  assert.equal(contract.artifact?.coveragePointer, '/workSample/coverage');
  assert.throws(
    () =>
      validateCodexExecutionContract({
        ...textContract,
        runner: 'structured-work-sample',
      }),
    /作品执行合同缺少附件/,
  );
  assert.throws(
    () => validateCodexExecutionContract({ ...textContract, artifact: contract.artifact }),
    /文本执行合同不能包含附件/,
  );
});

void test('execution contract rejects unknown executable fields and excessive content', () => {
  assert.throws(
    () => validateCodexExecutionContract({ ...textContract, command: 'sh' }),
    /未知字段/,
  );
  assert.throws(
    () =>
      validateCodexExecutionContract({
        ...textContract,
        instructions: 'x'.repeat(65 * 1024),
      }),
    /任务说明超过限制/,
  );
  assert.throws(
    () => validateCodexExecutionContract({ ...textContract, maxAttempts: 3 }),
    /重试次数/,
  );
});

void test('execution contract rejects unsafe schemas and invalid JSON pointers', () => {
  assert.throws(
    () => validateCodexExecutionContract({ ...textContract, schema: [] }),
    /输出结构/,
  );
  assert.throws(
    () =>
      validateCodexExecutionContract({
        ...textContract,
        runner: 'structured-work-sample',
        artifact: {
          id: 'artifact-12345678',
          sha256: 'a'.repeat(64),
          bytes: 4096,
          coveragePointer: '../coverage',
          evidenceRules: [
            {
              collectionPointer: '/questions',
              evidenceArray: false,
              required: true,
              pathPointer: '/path',
              excerptPointer: '/excerpt',
            },
          ],
        },
      }),
    /JSON 指针/,
  );
  assert.throws(
    () =>
      validateCodexExecutionContract({
        ...textContract,
        runner: 'structured-work-sample',
        artifact: {
          id: 'artifact-12345678',
          sha256: 'a'.repeat(64),
          bytes: 4096,
          coveragePointer: '/__proto__/coverage',
          evidenceRules: [
            {
              collectionPointer: '/questions',
              evidenceArray: false,
              required: true,
              pathPointer: '/path',
              excerptPointer: '/excerpt',
            },
          ],
        },
      }),
    /JSON 指针/,
  );
  assert.throws(
    () =>
      validateCodexExecutionContract({
        ...textContract,
        runner: 'structured-work-sample',
        artifact: {
          id: 'artifact-12345678',
          sha256: 'a'.repeat(64),
          bytes: 4096,
          coveragePointer: '/coverage',
          evidenceRules: [
            {
              collectionPointer: '/citations',
              evidencePointer: '/constructor',
              evidenceArray: false,
              required: true,
              pathPointer: '/path',
              excerptPointer: '/excerpt',
            },
          ],
        },
      }),
    /JSON 指针/,
  );
});

void test('execution contract stays below the connector response limit', () => {
  assert.throws(
    () =>
      validateCodexExecutionContract({
        ...textContract,
        schema: {
          type: 'object',
          description: 'y'.repeat(180 * 1024),
        },
        payload: { text: 'x'.repeat(400 * 1024) },
      }),
    /执行合同超过限制/,
  );
});
