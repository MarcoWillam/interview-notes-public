import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMON_TEMPLATE_ID,
  TEMPLATE_STATUS_VALUE,
  appliedTemplateState,
  inferTemplateSource,
  markTemplateModified,
  resolveTemplateSelection,
  supportsWrittenTest,
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

test('infers only a unique exact source for a legacy snapshot', () => {
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

test('selection priority distinguishes modified, deleted and updated snapshots', () => {
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

test('custom records display a stable non-action status option', () => {
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

test('written-test support belongs only to the built-in AI PM source', () => {
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

test('template transitions preserve AI PM written-test state and clear it elsewhere', () => {
  assert.deepEqual(markTemplateModified('pm'), {
    sourceTemplateId: 'pm',
    templateModified: true,
  });
  assert.deepEqual(
    appliedTemplateState(BUILTIN_TEMPLATE_IDS.aiProductManager, true),
    {
      sourceTemplateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
      templateModified: false,
      hasWrittenTest: true,
    },
  );
  assert.deepEqual(
    appliedTemplateState(BUILTIN_TEMPLATE_IDS.productOperations, true),
    {
      sourceTemplateId: BUILTIN_TEMPLATE_IDS.productOperations,
      templateModified: false,
      hasWrittenTest: false,
    },
  );
});
