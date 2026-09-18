import {
  resumeInstructionsFor,
  resumeOutputSchema,
  validateResumeInput,
  validateResumeReading,
  type ResumeInput,
  type ResumeReading,
} from './resume-reading.ts';
import {
  validateResumeExperienceMap,
  type ResumeExperienceMap,
} from './resume-experience-map.ts';

export type InitialOutlineInput = ResumeInput & {
  experienceMap: ResumeExperienceMap;
};

export function validateInitialOutlineInput(value: unknown): InitialOutlineInput {
  if (!value || typeof value !== 'object')
    throw new Error('初试提纲资料格式不正确。');
  const raw = value as Record<string, unknown>;
  const resume = validateResumeInput(raw);
  const dimensions = resume.dimensionText
    .split(/[、,，\n]/)
    .map((dimension) => dimension.trim())
    .filter(Boolean);
  return {
    ...resume,
    experienceMap: validateResumeExperienceMap(raw.experienceMap, {
      resumeText: resume.resumeText,
      dimensions,
    }),
  };
}

type MutableQuestionSchema = {
  required: string[];
  properties: Record<string, unknown>;
};

type MutableReadingSchema = {
  properties: {
    outline?: {
      properties: Record<
        'requiredQuestions' | 'reserveQuestions' | 'archivedReserveQuestions',
        { items: MutableQuestionSchema }
      >;
    };
  };
};

function addExperienceIds(schema: MutableReadingSchema) {
  if (!schema.properties.outline) return;
  const changed = new Set<MutableQuestionSchema>();
  for (const collection of [
    'requiredQuestions',
    'reserveQuestions',
    'archivedReserveQuestions',
  ] as const) {
    const question = schema.properties.outline.properties[collection].items;
    if (changed.has(question)) continue;
    changed.add(question);
    question.required.push('experienceId');
    question.properties.experienceId = {
      type: ['string', 'null'],
      maxLength: 100,
    };
  }
}

export function initialOutlineOutputSchema(version: 1 | 2 | 3) {
  const schema = structuredClone(
    resumeOutputSchema(version),
  ) as unknown as MutableReadingSchema;
  if (version === 3) addExperienceIds(schema);
  return schema as ReturnType<typeof resumeOutputSchema>;
}

export function initialOutlineInstructionsFor(version: 1 | 2 | 3) {
  return `${resumeInstructionsFor(version)}\n输入 experienceMap 已经完成全量简历阅读。生成提纲前先建立“经历 × 考核维度”候选矩阵；优先使用实习、项目和个人项目，其他个人经历只用于补足维度。不得删除、改写或补造 experienceMap 中的经历。V3 中每道 resume 题必须返回对应 experienceId，其他来源的题必须返回 experienceId=null。`;
}

export function validateInitialOutlineResult(
  value: unknown,
  inputValue: InitialOutlineInput,
): ResumeReading {
  const input = validateInitialOutlineInput(inputValue);
  return validateResumeReading(value, input, {
    conciseQuestions: true,
    experienceMap: input.experienceMap,
  });
}
