import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMON_TEMPLATE_ID,
  TEMPLATE_STATUS_VALUE,
  appliedTemplateState,
  inferTemplateSource,
  markTemplateModified,
  normalizeInterviewTemplateState,
  resolveTemplateSelection,
  resolveResumeOutlinePreflight,
  resolveResumeOutlineSetup,
  resumeOutlineLocked,
  supportsWrittenTest,
  writtenTestDecision,
} from '../lib/interview-template-state.ts';
import { BUILTIN_TEMPLATE_IDS } from '../lib/default-role-templates.ts';

const common = {
  role: '',
  requirements: '',
  dimensionText: '通用能力',
  focus: '',
  scoringGuidance: '',
  reportRequirements: '',
};

const template = {
  ...common,
  id: 'pm',
  name: '产品经理',
  role: '产品经理',
  requirements: '理解用户',
};

void test('infers only a unique exact source for a legacy snapshot', () => {
  assert.deepEqual(inferTemplateSource(template, [template], common), {
    sourceTemplateId: 'pm',
    templateModified: false,
  });
  assert.deepEqual(
    inferTemplateSource(
      template,
      [template, { ...template, id: 'pm-2' }],
      common,
    ),
    { sourceTemplateId: null, templateModified: true },
  );
  assert.deepEqual(inferTemplateSource(common, [template], common), {
    sourceTemplateId: COMMON_TEMPLATE_ID,
    templateModified: false,
  });
});

void test('selection priority distinguishes modified, deleted and updated snapshots', () => {
  assert.deepEqual(
    resolveTemplateSelection(template, 'pm', true, [template], common),
    {
      sourceTemplateId: 'pm',
      templateModified: true,
      kind: 'modified',
      selectValue: TEMPLATE_STATUS_VALUE,
      label: '已自定义本场标准（来源：产品经理）',
    },
  );
  assert.equal(
    resolveTemplateSelection(template, 'missing', false, [template], common)
      .kind,
    'deleted',
  );
  assert.equal(
    resolveTemplateSelection(
      template,
      'pm',
      false,
      [{ ...template, focus: '新版' }],
      common,
    ).kind,
    'updated',
  );
  assert.deepEqual(
    resolveTemplateSelection(template, 'pm', false, [template], common),
    {
      sourceTemplateId: 'pm',
      templateModified: false,
      kind: 'template',
      selectValue: 'pm',
      label: '产品经理',
    },
  );
});

void test('custom records display a stable non-action status option', () => {
  assert.deepEqual(
    resolveTemplateSelection(template, null, true, [template], common),
    {
      sourceTemplateId: null,
      templateModified: true,
      kind: 'custom',
      selectValue: TEMPLATE_STATUS_VALUE,
      label: '已自定义本场标准',
    },
  );
});

void test('written-test support belongs only to the built-in AI PM source', () => {
  assert.equal(
    supportsWrittenTest(BUILTIN_TEMPLATE_IDS.aiProductManager),
    true,
  );
  assert.equal(
    supportsWrittenTest(BUILTIN_TEMPLATE_IDS.productOperations),
    false,
  );
  assert.equal(supportsWrittenTest(COMMON_TEMPLATE_ID), false);
});

void test('template transitions require a fresh AI PM written-test confirmation', () => {
  assert.deepEqual(markTemplateModified('pm'), {
    sourceTemplateId: 'pm',
    templateModified: true,
  });
  assert.deepEqual(
    appliedTemplateState(BUILTIN_TEMPLATE_IDS.aiProductManager),
    {
      sourceTemplateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
      templateModified: false,
      hasWrittenTest: false,
      writtenTestConfirmed: false,
    },
  );
  assert.deepEqual(
    appliedTemplateState(BUILTIN_TEMPLATE_IDS.productOperations),
    {
      sourceTemplateId: BUILTIN_TEMPLATE_IDS.productOperations,
      templateModified: false,
      hasWrittenTest: false,
      writtenTestConfirmed: false,
    },
  );
});

void test('resume reading asks only when AI PM written-test status is unconfirmed', () => {
  assert.equal(
    writtenTestDecision(BUILTIN_TEMPLATE_IDS.aiProductManager, false, false),
    null,
  );
  assert.equal(
    writtenTestDecision(BUILTIN_TEMPLATE_IDS.aiProductManager, true, false),
    false,
  );
  assert.equal(
    writtenTestDecision(BUILTIN_TEMPLATE_IDS.aiProductManager, true, true),
    true,
  );
  assert.equal(
    writtenTestDecision(BUILTIN_TEMPLATE_IDS.productOperations, false, true),
    false,
  );
});

void test('resume outline preflight requires AI PM written-test choice and normalizes operations', () => {
  assert.deepEqual(
    resolveResumeOutlinePreflight(
      BUILTIN_TEMPLATE_IDS.aiProductManager,
      true,
    ),
    {
      templateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
      hasWrittenTest: true,
    },
  );
  assert.equal(
    resolveResumeOutlinePreflight(
      BUILTIN_TEMPLATE_IDS.aiProductManager,
      null,
    ),
    null,
  );
  assert.deepEqual(
    resolveResumeOutlinePreflight(
      BUILTIN_TEMPLATE_IDS.productOperations,
      null,
    ),
    {
      templateId: BUILTIN_TEMPLATE_IDS.productOperations,
      hasWrittenTest: false,
    },
  );
  assert.equal(resolveResumeOutlinePreflight('custom-template', false), null);
});

void test('a persisted resume reading is the permanent outline lock', () => {
  assert.equal(resumeOutlineLocked({ summary: '已生成' }), true);
  assert.equal(resumeOutlineLocked(null), false);
  assert.equal(resumeOutlineLocked(undefined), false);
});

void test('resume outline setup carries the confirmed full role template', () => {
  const result = resolveResumeOutlineSetup(
    BUILTIN_TEMPLATE_IDS.aiProductManager,
    false,
    [
      {
        id: BUILTIN_TEMPLATE_IDS.aiProductManager,
        name: 'AI 产品经理（校招）',
        role: 'AI 产品经理（校招）',
        requirements: '确认后的岗位要求',
        dimensionText: '产品判断、自驱力',
        focus: '重点考察主动推进',
        scoringGuidance: '按证据评分',
        reportRequirements: '区分事实与自述',
      },
    ],
  );
  assert.deepEqual(result, {
    templateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
    hasWrittenTest: false,
    standards: {
      role: 'AI 产品经理（校招）',
      requirements: '确认后的岗位要求',
      dimensionText: '产品判断、自驱力',
      focus: '重点考察主动推进',
      scoringGuidance: '按证据评分',
      reportRequirements: '区分事实与自述',
    },
  });
});

void test('restored metadata infers legacy sources and removes impossible written-test state', () => {
  assert.deepEqual(
    normalizeInterviewTemplateState(
      template,
      { hasWrittenTest: true },
      [template],
      common,
    ),
    {
      sourceTemplateId: 'pm',
      templateModified: false,
      hasWrittenTest: false,
      writtenTestConfirmed: false,
    },
  );
  const aiTemplate = {
    ...template,
    id: BUILTIN_TEMPLATE_IDS.aiProductManager,
  };
  assert.deepEqual(
    normalizeInterviewTemplateState(
      aiTemplate,
      {
        sourceTemplateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
        templateModified: true,
        hasWrittenTest: true,
      },
      [aiTemplate],
      common,
    ),
    {
      sourceTemplateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
      templateModified: true,
      hasWrittenTest: true,
      writtenTestConfirmed: true,
    },
  );
  assert.equal(
    normalizeInterviewTemplateState(
      aiTemplate,
      {
        sourceTemplateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
        hasWrittenTest: false,
        resumeReading: { summary: '旧提纲' },
      },
      [aiTemplate],
      common,
    ).writtenTestConfirmed,
    true,
  );
  assert.equal(
    normalizeInterviewTemplateState(
      aiTemplate,
      {
        sourceTemplateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
        hasWrittenTest: true,
        writtenTestConfirmed: false,
      },
      [aiTemplate],
      common,
    ).writtenTestConfirmed,
    false,
  );
});
