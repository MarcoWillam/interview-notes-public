import {
  validateCodexExecutionContract,
  type CodexExecutionContract,
  type CodexExecutionKind,
} from '../lib/codex-execution-contract.ts';
import { assessmentInstructions, reportSchema } from '../lib/assessment.ts';
import { validateInput } from '../lib/interview.ts';
import {
  followUpOutlineInstructions,
  followUpOutlineOutputSchema,
  validateFollowUpOutlineInput,
} from '../lib/follow-up-outline.ts';
import {
  outlineRegenerationInstructionsFor,
  outlineRegenerationOutputSchema,
  validateOutlineRegenerationInput,
} from '../lib/outline-regeneration.ts';
import {
  validateResumeInput,
} from '../lib/resume-reading.ts';
import {
  resumeExperienceMapInstructions,
  resumeExperienceMapSchema,
} from '../lib/resume-experience-map.ts';
import {
  initialOutlineInstructionsFor,
  initialOutlineOutputSchema,
  validateInitialOutlineInput,
} from '../lib/initial-outline.ts';
import { aiPmWorkSampleRubricContext } from '../lib/work-sample-rubric.ts';
import {
  priorRoundComparisonSchema,
  secondRoundAssessmentInstructions,
  secondRoundOutlineInstructions,
  secondRoundOutlineSchema,
  validateSecondRoundAssessmentInput,
  validateSecondRoundOutlineInput,
} from '../lib/second-round.ts';
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

type MutableSourceSchema = {
  required: string[];
  properties: {
    [key: string]: unknown;
    interviewQuestions?: {
      items: { properties: { questionSource: { enum: string[] } } };
    };
    outline?: {
      properties: Record<
        'requiredQuestions' | 'reserveQuestions' | 'archivedReserveQuestions',
        { items: { properties: { source: { enum: string[] } } } }
      >;
    };
  };
};

function allowedResumeSources(input: ReturnType<typeof validateResumeInput>) {
  if (input.workSample) return ['role', 'resume', 'work-sample'];
  if (input.hasWrittenTest && input.role === 'AI 产品经理（校招）')
    return ['role', 'resume', 'written-test'];
  return ['role', 'resume'];
}

function initialOutlineSchemaFor(
  input: ReturnType<typeof validateInitialOutlineInput>,
) {
  const version = input.outlineVersion ?? 1;
  const schema = structuredClone(
    initialOutlineOutputSchema(version),
  ) as unknown as MutableSourceSchema;
  const sources = allowedResumeSources(input);
  if (version === 1)
    schema.properties.interviewQuestions!.items.properties.questionSource.enum =
      sources;
  else
    for (const collection of [
      'requiredQuestions',
      'reserveQuestions',
      'archivedReserveQuestions',
    ] as const)
      schema.properties.outline!.properties[
        collection
      ].items.properties.source.enum = sources;
  return schema;
}

function resumeSourceInstructions(
  input: ReturnType<typeof validateResumeInput>,
) {
  if (input.workSample)
    return '本次已提供作品，问题 source 只能使用 role、resume 或 work-sample，不得使用 written-test。';
  if (input.hasWrittenTest && input.role === 'AI 产品经理（校招）')
    return '本次 hasWrittenTest=true 且未提供作品，问题 source 只能使用 role、resume 或 written-test，不得使用 work-sample。';
  return '本次 hasWrittenTest=false 且未提供作品。即使岗位要求或模板文字提到“笔试”“作品”或其考察框架，也不代表本候选人完成了笔试或提交了作品；所有问题 source 只能使用 role 或 resume。';
}

function initialOutlineWorkSampleDefinition(
  input: ReturnType<typeof validateInitialOutlineInput>,
) {
  const version = input.outlineVersion ?? 1;
  const resumeSchema = initialOutlineSchemaFor(input);
  return {
    runner: 'structured-work-sample' as const,
    instructions: `${initialOutlineInstructionsFor(version)}\n${resumeSourceInstructions(input)}\n只使用 work_sample 工具读取笔试作品。必须返回 workSample。${version === 3 ? 'outline 的第 5–6 道必问题必须与 workSample.questions 的问题文本、文件路径和逐字引用完全一致，source=work-sample；workSample.questions 恰好两道，主问题自然、亲和且为 12–30 字' : version === 2 ? 'outline 的第 2–4 道必问题必须与 workSample.questions 的问题文本、文件路径和逐字引用完全一致，source=work-sample' : '第 2–4 题必须与 workSample.questions 完全一致，questionSource=work-sample'}；引用只能来自 UTF-8 文本或源码。\n${workSampleEmbeddedInstructionsFor(version)}`,
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
    return {
      runner: 'structured-text' as const,
      instructions: resumeExperienceMapInstructions,
      schema: resumeExperienceMapSchema,
      payload: {
        resumeText: input.resumeText,
        dimensions: input.dimensionText
          .split(/[、,，\n]/)
          .map((dimension) => dimension.trim())
          .filter(Boolean),
      },
    };
  }
  if (kind === 'initial-outline') {
    const input = validateInitialOutlineInput(value);
    if (input.workSample) return initialOutlineWorkSampleDefinition(input);
    const version = input.outlineVersion ?? 1;
    return {
      runner: 'structured-text' as const,
      instructions: `${initialOutlineInstructionsFor(version)}\n${resumeSourceInstructions(input)}`,
      schema: initialOutlineSchemaFor(input),
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
  if (kind === 'follow-up-outline') {
    const input = validateFollowUpOutlineInput(value);
    return {
      runner: 'structured-text' as const,
      instructions: followUpOutlineInstructions,
      schema: followUpOutlineOutputSchema,
      payload: input,
    };
  }
  if (kind === 'second-round-outline') {
    const input = validateSecondRoundOutlineInput(value);
    return {
      runner: 'structured-text' as const,
      instructions: secondRoundOutlineInstructions,
      schema: secondRoundOutlineSchema,
      payload: input,
    };
  }
  if (kind === 'second-round-assessment') {
    const input = validateSecondRoundAssessmentInput(value);
    const schema = structuredClone(reportSchema) as typeof reportSchema & {
      required: string[];
      properties: Record<string, unknown>;
    };
    schema.required = [...schema.required, 'priorRoundComparison'];
    schema.properties.priorRoundComparison = priorRoundComparisonSchema;
    return {
      runner: 'structured-text' as const,
      instructions: `${assessmentInstructions}\n${secondRoundAssessmentInstructions}`,
      schema,
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
  const attempt = options.attempt ?? 1;
  return validateCodexExecutionContract({
    contractVersion: 1,
    ...definition,
    instructions: retryInstructions(
      definition.instructions,
      attempt === 2 ? options.feedback : undefined,
    ),
    attempt,
    maxAttempts: 2,
  });
}
