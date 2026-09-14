import {
  validateCodexExecutionContract,
  type CodexExecutionContract,
  type CodexExecutionKind,
} from '../lib/codex-execution-contract.ts';
import { assessmentInstructions, reportSchema } from '../lib/assessment.ts';
import { validateInput } from '../lib/interview.ts';
import {
  outlineRegenerationInstructionsFor,
  outlineRegenerationOutputSchema,
  validateOutlineRegenerationInput,
} from '../lib/outline-regeneration.ts';
import {
  resumeInstructionsFor,
  resumeOutputSchema,
  validateResumeInput,
} from '../lib/resume-reading.ts';
import { aiPmWorkSampleRubricContext } from '../lib/work-sample-rubric.ts';
import {
  validateWorkSampleInput,
  workSampleAssessmentV3Schema,
  workSampleEmbeddedInstructionsFor,
  workSampleInstructionsFor,
  workSampleOutputSchema,
  workSampleSchema,
  type WorkSampleReference,
} from '../lib/work-sample.ts';
import {
  validateWrittenTestSupplementInput,
  writtenTestSupplementInstructionsFor,
  writtenTestSupplementOutputSchema,
} from '../lib/written-test-supplement.ts';

function artifactContract(
  reference: WorkSampleReference,
  nested: boolean,
): NonNullable<CodexExecutionContract['artifact']> {
  return {
    id: reference.id,
    sha256: reference.sha256,
    bytes: reference.bytes,
    coveragePointer: nested ? '/workSample/coverage' : '/coverage',
    evidenceRules: [
      {
        collectionPointer: nested ? '/workSample/questions' : '/questions',
        evidencePointer: '/workSampleEvidence',
        evidenceArray: false,
        required: true,
        pathPointer: '/path',
        excerptPointer: '/excerpt',
      },
      {
        collectionPointer: nested ? '/workSample/dimensions' : '/dimensions',
        evidencePointer: '/evidence',
        evidenceArray: true,
        required: false,
        pathPointer: '/path',
        excerptPointer: '/excerpt',
      },
    ],
  };
}

function retryInstructions(instructions: string, feedback?: string) {
  if (!feedback) return instructions;
  const safe = feedback.replaceAll(/[\r\n]+/g, ' ').slice(0, 1000);
  return `${instructions}\n上一次结果未通过服务器校验：${safe}。请修正后重新返回完整 JSON。`;
}

function resumeWorkSampleDefinition(input: ReturnType<typeof validateResumeInput>) {
  const version = input.outlineVersion ?? 1;
  const resumeSchema = resumeOutputSchema(version);
  return {
    runner: 'structured-work-sample' as const,
    instructions: `${resumeInstructionsFor(version)}\n只使用 work_sample 工具读取笔试作品。必须返回 workSample。${version === 3 ? 'outline 的第 5–6 道必问题必须与 workSample.questions 的问题文本、文件路径和逐字引用完全一致，source=work-sample；workSample.questions 恰好两道，主问题自然、亲和且为 12–30 字' : version === 2 ? 'outline 的第 2–4 道必问题必须与 workSample.questions 的问题文本、文件路径和逐字引用完全一致，source=work-sample' : '第 2–4 题必须与 workSample.questions 完全一致，questionSource=work-sample'}；引用只能来自 UTF-8 文本或源码。\n${workSampleEmbeddedInstructionsFor(version)}`,
    schema: {
      ...resumeSchema,
      required: [...resumeSchema.required, 'workSample'],
      properties: {
        ...resumeSchema.properties,
        workSample:
          version === 3 ? workSampleAssessmentV3Schema : workSampleSchema,
      },
    },
    payload: {
      ...input,
      workSampleRubric: aiPmWorkSampleRubricContext,
    },
    artifact: artifactContract(input.workSample!, true),
  };
}

function modelDefinition(kind: CodexExecutionKind, value: unknown) {
  if (kind === 'interview')
    return {
      runner: 'structured-text' as const,
      instructions: assessmentInstructions,
      schema: reportSchema,
      payload: validateInput(value),
    };
  if (kind === 'resume') {
    const input = validateResumeInput(value);
    if (input.workSample) return resumeWorkSampleDefinition(input);
    const version = input.outlineVersion ?? 1;
    return {
      runner: 'structured-text' as const,
      instructions: resumeInstructionsFor(version),
      schema: resumeOutputSchema(version),
      payload: input,
    };
  }
  if (kind === 'written-test') {
    const input = validateWrittenTestSupplementInput(value);
    const version = input.outlineVersion ?? 1;
    return {
      runner: 'structured-text' as const,
      instructions: writtenTestSupplementInstructionsFor(version),
      schema: writtenTestSupplementOutputSchema(version),
      payload: input,
    };
  }
  if (kind === 'outline') {
    const input = validateOutlineRegenerationInput(value);
    const version = input.outlineVersion ?? 1;
    return {
      runner: 'structured-text' as const,
      instructions: outlineRegenerationInstructionsFor(version),
      schema: outlineRegenerationOutputSchema(version),
      payload: input,
    };
  }
  const input = validateWorkSampleInput(value);
  const version = input.outlineVersion ?? 1;
  return {
    runner: 'structured-work-sample' as const,
    instructions: workSampleInstructionsFor(version),
    schema: workSampleOutputSchema(version),
    payload: {
      ...input,
      workSampleRubric: aiPmWorkSampleRubricContext,
    },
    artifact: artifactContract(input.workSample, version !== 1),
  };
}

export function executionContractFor(
  kind: CodexExecutionKind,
  input: unknown,
  options: { attempt?: number; feedback?: string } = {},
) {
  const definition = modelDefinition(kind, input);
  return validateCodexExecutionContract({
    contractVersion: 1,
    ...definition,
    instructions: retryInstructions(definition.instructions, options.feedback),
    attempt: options.attempt ?? 1,
    maxAttempts: 2,
  });
}
