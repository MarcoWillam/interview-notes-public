import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conciseQuestion,
  interviewQuestionSchema,
  validateQuestionItems,
} from '../lib/interview-questions.ts';

const base = {
  question: '你如何确认这是用户的真实问题？',
  questionSource: 'role' as const,
  dimensions: ['用户洞察'],
  reason: '核实问题定义依据。',
  resumeEvidence: null,
  listenFor: ['说明实际依据'],
  probes: ['你排除了什么假设？'],
};

const options = {
  expectedCount: 1,
  allowedDimensions: new Set(['用户洞察']),
  allowedSources: new Set<'role'>(['role']),
  resumeText: '',
  conciseQuestions: true,
};

void test('new outline questions use one directly speakable 12–30 character question', () => {
  assert.equal(conciseQuestion(base.question), base.question);
  assert.equal(
    validateQuestionItems([base], options)[0].question,
    base.question,
  );
  assert.equal(interviewQuestionSchema.properties.question.minLength, 12);
  assert.equal(interviewQuestionSchema.properties.question.maxLength, 30);
});

void test('concise generation rejects short, long and compound questions', () => {
  assert.throws(() => conciseQuestion('怎么做？'), /12–30/);
  assert.throws(
    () =>
      conciseQuestion(
        '请你详细说明这个项目的背景过程行动结果以及最终复盘和后续调整是什么？',
      ),
    /12–30/,
  );
  assert.throws(
    () => conciseQuestion('你为什么这样判断？最终结果如何？'),
    /一个问点/,
  );
});

void test('historical long questions remain readable outside generation validation', () => {
  const historical = {
    ...base,
    question:
      '请详细讲述这个项目从背景、目标、个人行动、协作过程到最终结果与复盘的完整经历。',
  };
  assert.equal(
    validateQuestionItems([historical], {
      ...options,
      conciseQuestions: false,
    })[0].question,
    historical.question,
  );
});
