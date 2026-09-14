import {
  validateCodexExecutionContract,
  validateCodexExecutionResult,
  type CodexExecutionContract,
} from '../lib/codex-execution-contract.ts';
import { runStructuredCodex } from './codex-runtime.ts';
import { executeWorkSampleContract } from './work-samples/runtime.ts';

export type ContractExecutionDependencies = {
  text?: (
    payload: unknown,
    signal: AbortSignal,
    instructions: string,
    schema: object,
  ) => Promise<unknown>;
  workSample?: (
    contract: CodexExecutionContract,
    path: string,
    signal: AbortSignal,
  ) => Promise<unknown>;
};

export async function executeCodexContract(
  value: unknown,
  signal: AbortSignal,
  context: { artifactPath?: string } = {},
  dependencies: ContractExecutionDependencies = {},
) {
  const contract = validateCodexExecutionContract(value);
  if (contract.runner === 'structured-work-sample') {
    if (!context.artifactPath) throw new Error('本地作品不存在。');
    return validateCodexExecutionResult(
      await (dependencies.workSample || executeWorkSampleContract)(
        contract,
        context.artifactPath,
        signal,
      ),
    );
  }
  return validateCodexExecutionResult(
    await (dependencies.text || runStructuredCodex)(
      contract.payload,
      signal,
      contract.instructions,
      contract.schema,
    ),
  );
}
