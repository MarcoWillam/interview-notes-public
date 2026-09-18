import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessmentResultSchema, reportSchema } from '../lib/assessment.ts';
import { resumeOutputSchema, resumeSchema } from '../lib/resume-reading.ts';
import {
  workSampleAnalysisV2Schema,
  workSampleSchema,
} from '../lib/work-sample.ts';
import { writtenTestSupplementSchema } from '../lib/written-test-supplement.ts';
import { outlineV2SupplementSchema } from '../lib/outline-v2-supplement.ts';
import { outlineRegenerationOutputSchema } from '../lib/outline-regeneration.ts';
import { followUpOutlineOutputSchema } from '../lib/follow-up-outline.ts';
import { secondRoundOutlineSchema } from '../lib/second-round.ts';
import { resumeExperienceMapSchema } from '../lib/resume-experience-map.ts';
import { initialOutlineOutputSchema } from '../lib/initial-outline.ts';

function assertStrictObjectSchemas(value: unknown, path = 'root') {
  if (!value || typeof value !== 'object') return;
  const schema = value as Record<string, unknown>;
  if (schema.type === 'object') {
    const properties = (schema.properties || {}) as Record<string, unknown>;
    assert.deepEqual(
      [...((schema.required || []) as string[])].sort(),
      Object.keys(properties).sort(),
      `${path} must require every declared property`,
    );
    for (const [name, property] of Object.entries(properties))
      assertStrictObjectSchemas(property, `${path}.${name}`);
  }
  if (schema.items) assertStrictObjectSchemas(schema.items, `${path}[]`);
  if (Array.isArray(schema.anyOf))
    schema.anyOf.forEach((item, index) =>
      assertStrictObjectSchemas(item, `${path}.anyOf[${index}]`),
    );
}

void test('every Codex output schema satisfies strict required-property rules', () => {
  for (const [name, schema] of Object.entries({
    reportSchema,
    assessmentResultSchema,
    resumeSchema,
    resumeSchemaV2: resumeOutputSchema(2),
    writtenTestSupplementSchema,
    writtenTestSupplementSchemaV2: outlineV2SupplementSchema('written-test'),
    workSampleSchema,
    workSampleAnalysisV2Schema,
    outlineRegenerationSchemaV2: outlineRegenerationOutputSchema(2),
    followUpOutlineOutputSchema,
    secondRoundOutlineSchema,
    resumeExperienceMapSchema,
    initialOutlineSchemaV3: initialOutlineOutputSchema(3),
  }))
    assertStrictObjectSchemas(schema, name);
});

void test('follow-up outline schema fixes the requested focus and exactly two questions', () => {
  const questions = followUpOutlineOutputSchema.properties.questions;
  assert.equal(questions.minItems, 2);
  assert.equal(questions.maxItems, 2);
  assert.equal(
    followUpOutlineOutputSchema.properties.requestedFocus.minLength,
    2,
  );
});

void test('resume output schema selects exactly one outline contract', () => {
  const v1 = resumeOutputSchema(1);
  const v2 = resumeOutputSchema(2);
  assert.ok(v1.required.includes('interviewQuestions'));
  assert.ok(!('outline' in v1.properties));
  assert.ok(v2.required.includes('outline'));
  assert.ok(!('interviewQuestions' in v2.properties));
});
