export const SERVER_DRIVEN_EXECUTION_PROTOCOL = 5;
export const MAX_CONTRACT_INSTRUCTIONS_BYTES = 64 * 1024;
export const MAX_CONTRACT_SCHEMA_BYTES = 256 * 1024;
export const MAX_CONTRACT_PAYLOAD_BYTES = 512 * 1024;
export const MAX_CONTRACT_RESULT_BYTES = 512 * 1024;
export const MAX_CONTRACT_ATTEMPTS = 2;
export const MAX_CONTRACT_ARTIFACT_BYTES = 50 * 1024 * 1024;

export type CodexExecutionRunner =
  | 'structured-text'
  | 'structured-work-sample';

export type CodexExecutionArtifact = {
  id: string;
  sha256: string;
  bytes: number;
  coveragePointer: string;
  evidencePointer: string;
};

export type CodexExecutionContract = {
  contractVersion: 1;
  runner: CodexExecutionRunner;
  instructions: string;
  schema: Record<string, unknown>;
  payload: unknown;
  artifact?: CodexExecutionArtifact;
  attempt: number;
  maxAttempts: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label}包含未知字段：${extras.join('、')}`);
}

function serializedBytes(value: unknown, label: string, max: number) {
  let source: string | undefined;
  try {
    source = JSON.stringify(value);
  } catch {
    throw new Error(`${label}不是有效 JSON。`);
  }
  if (source === undefined) throw new Error(`${label}不是有效 JSON。`);
  if (new TextEncoder().encode(source).byteLength > max)
    throw new Error(`${label}超过限制。`);
}

function validateJsonDepth(value: unknown, depth = 0) {
  if (depth > 24) throw new Error('输出结构嵌套超过限制。');
  if (Array.isArray(value)) {
    for (const item of value) validateJsonDepth(item, depth + 1);
    return;
  }
  if (record(value))
    for (const item of Object.values(value)) validateJsonDepth(item, depth + 1);
}

function jsonPointer(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length < 2 ||
    value.length > 160 ||
    !/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*$/.test(value)
  )
    throw new Error('作品执行合同 JSON 指针无效。');
  return value;
}

function validateArtifact(value: unknown): CodexExecutionArtifact {
  if (!record(value)) throw new Error('作品执行合同缺少附件。');
  exactKeys(
    value,
    ['id', 'sha256', 'bytes', 'coveragePointer', 'evidencePointer'],
    '附件合同',
  );
  if (
    typeof value.id !== 'string' ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(value.id)
  )
    throw new Error('附件标识无效。');
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))
    throw new Error('附件哈希无效。');
  if (
    !Number.isSafeInteger(value.bytes) ||
    Number(value.bytes) < 1 ||
    Number(value.bytes) > MAX_CONTRACT_ARTIFACT_BYTES
  )
    throw new Error('附件大小无效。');
  return {
    id: value.id,
    sha256: value.sha256,
    bytes: Number(value.bytes),
    coveragePointer: jsonPointer(value.coveragePointer),
    evidencePointer: jsonPointer(value.evidencePointer),
  };
}

export function validateCodexExecutionContract(
  value: unknown,
): CodexExecutionContract {
  if (!record(value)) throw new Error('Codex 执行合同格式不正确。');
  exactKeys(
    value,
    [
      'contractVersion',
      'runner',
      'instructions',
      'schema',
      'payload',
      'artifact',
      'attempt',
      'maxAttempts',
    ],
    'Codex 执行合同',
  );
  if (value.contractVersion !== 1) throw new Error('Codex 执行合同版本无效。');
  if (
    value.runner !== 'structured-text' &&
    value.runner !== 'structured-work-sample'
  )
    throw new Error('Codex 执行器类型无效。');
  if (typeof value.instructions !== 'string' || !value.instructions.trim())
    throw new Error('Codex 任务说明不能为空。');
  if (
    new TextEncoder().encode(value.instructions).byteLength >
    MAX_CONTRACT_INSTRUCTIONS_BYTES
  )
    throw new Error('Codex 任务说明超过限制。');
  if (!record(value.schema)) throw new Error('Codex 输出结构格式不正确。');
  validateJsonDepth(value.schema);
  serializedBytes(value.schema, 'Codex 输出结构', MAX_CONTRACT_SCHEMA_BYTES);
  serializedBytes(value.payload, 'Codex 任务资料', MAX_CONTRACT_PAYLOAD_BYTES);
  if (
    !Number.isSafeInteger(value.maxAttempts) ||
    Number(value.maxAttempts) < 1 ||
    Number(value.maxAttempts) > MAX_CONTRACT_ATTEMPTS
  )
    throw new Error('Codex 合同重试次数无效。');
  if (
    !Number.isSafeInteger(value.attempt) ||
    Number(value.attempt) < 1 ||
    Number(value.attempt) > Number(value.maxAttempts)
  )
    throw new Error('Codex 合同执行次数无效。');
  const artifact =
    value.artifact === undefined ? undefined : validateArtifact(value.artifact);
  if (value.runner === 'structured-work-sample' && !artifact)
    throw new Error('作品执行合同缺少附件。');
  if (value.runner === 'structured-text' && artifact)
    throw new Error('文本执行合同不能包含附件。');
  return {
    contractVersion: 1,
    runner: value.runner,
    instructions: value.instructions.trim(),
    schema: value.schema,
    payload: value.payload,
    ...(artifact ? { artifact } : {}),
    attempt: Number(value.attempt),
    maxAttempts: Number(value.maxAttempts),
  };
}

export function validateCodexExecutionResult(value: unknown) {
  serializedBytes(value, 'Codex 执行结果', MAX_CONTRACT_RESULT_BYTES);
  if (!record(value)) throw new Error('Codex 执行结果格式不正确。');
  return value;
}
