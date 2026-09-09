import { BUILTIN_TEMPLATE_IDS } from './default-role-templates.ts';
import {
  normalizeStandards,
  type InterviewStandards,
} from './standards.ts';

export const COMMON_TEMPLATE_ID = '__common__';
export const TEMPLATE_STATUS_VALUE = '__template_status__';

export type TemplateLike = Partial<InterviewStandards> & {
  id: string;
  name: string;
};

export type TemplateSelection = {
  sourceTemplateId: string | null;
  templateModified: boolean;
  kind: 'template' | 'custom' | 'deleted' | 'modified' | 'updated';
  selectValue: string;
  label: string;
};

const standardFields = [
  'role',
  'requirements',
  'dimensionText',
  'focus',
  'scoringGuidance',
  'reportRequirements',
] as const satisfies readonly (keyof InterviewStandards)[];

export function standardsEqual(
  a: Partial<InterviewStandards>,
  b: Partial<InterviewStandards>,
) {
  const left = normalizeStandards(a);
  const right = normalizeStandards(b);
  return standardFields.every((field) => left[field] === right[field]);
}

export function inferTemplateSource(
  standards: InterviewStandards,
  templates: TemplateLike[],
  common: InterviewStandards,
) {
  const matches = [
    ...(standardsEqual(standards, common) ? [COMMON_TEMPLATE_ID] : []),
    ...templates
      .filter((template) => standardsEqual(standards, template))
      .map((template) => template.id),
  ];
  return matches.length === 1
    ? { sourceTemplateId: matches[0], templateModified: false }
    : { sourceTemplateId: null, templateModified: true };
}

export function resolveTemplateSelection(
  standards: InterviewStandards,
  sourceTemplateId: string | null,
  templateModified: boolean,
  templates: TemplateLike[],
  common: InterviewStandards,
): TemplateSelection {
  if (!sourceTemplateId)
    return {
      sourceTemplateId: null,
      templateModified: true,
      kind: 'custom',
      selectValue: TEMPLATE_STATUS_VALUE,
      label: '已自定义本场标准',
    };

  const source =
    sourceTemplateId === COMMON_TEMPLATE_ID
      ? { ...common, id: COMMON_TEMPLATE_ID, name: '通用默认标准' }
      : templates.find((template) => template.id === sourceTemplateId);

  if (!source)
    return {
      sourceTemplateId,
      templateModified: true,
      kind: 'deleted',
      selectValue: TEMPLATE_STATUS_VALUE,
      label: '原模板已删除 · 已自定义',
    };
  if (templateModified)
    return {
      sourceTemplateId,
      templateModified: true,
      kind: 'modified',
      selectValue: TEMPLATE_STATUS_VALUE,
      label: `已自定义本场标准（来源：${source.name}）`,
    };
  if (!standardsEqual(standards, source))
    return {
      sourceTemplateId,
      templateModified: false,
      kind: 'updated',
      selectValue: TEMPLATE_STATUS_VALUE,
      label: `模板已更新 · 本场保留旧版本（来源：${source.name}）`,
    };
  return {
    sourceTemplateId,
    templateModified: false,
    kind: 'template',
    selectValue: sourceTemplateId,
    label: source.name,
  };
}

export function supportsWrittenTest(
  sourceTemplateId: string | null | undefined,
) {
  return sourceTemplateId === BUILTIN_TEMPLATE_IDS.aiProductManager;
}

export function markTemplateModified(sourceTemplateId: string | null) {
  return { sourceTemplateId, templateModified: true };
}

export function appliedTemplateState(
  sourceTemplateId: string,
  hasWrittenTest: boolean,
) {
  return {
    sourceTemplateId,
    templateModified: false,
    hasWrittenTest:
      supportsWrittenTest(sourceTemplateId) && hasWrittenTest,
  };
}
