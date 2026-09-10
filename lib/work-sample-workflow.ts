import { BUILTIN_TEMPLATE_IDS } from './default-role-templates.ts';
import type { ResumeReading } from './resume-reading.ts';
import type { WorkSampleAssessment } from './work-sample.ts';

export type WorkSampleWorkflowState = {
  sourceTemplateId?: string | null;
  hasWrittenTest?: boolean;
  resumeReading?: ResumeReading | null;
  workSample?: WorkSampleAssessment | null;
  workSampleJobId?: string;
};

export function canSubmitWorkSample(value: WorkSampleWorkflowState) {
  return (
    value.sourceTemplateId === BUILTIN_TEMPLATE_IDS.aiProductManager &&
    (value.resumeReading?.interviewQuestions?.length || 0) >= 6 &&
    !value.workSample &&
    !value.resumeReading?.workSample &&
    !value.workSampleJobId
  );
}

export function applyInitialWorkSample<T extends WorkSampleWorkflowState>(
  value: T,
  reading: ResumeReading,
): Omit<T, 'hasWrittenTest' | 'resumeReading' | 'workSample' | 'workSampleJobId'> & {
  hasWrittenTest: true;
  resumeReading: ResumeReading;
  workSample: WorkSampleAssessment;
  workSampleJobId: undefined;
} {
  if (value.workSample || value.resumeReading?.workSample)
    throw new Error('本场面试的作品只能成功分析一次。');
  if (!reading.workSample) throw new Error('作品分析结果缺失。');
  return {
    ...value,
    hasWrittenTest: true,
    resumeReading: reading,
    workSample: reading.workSample,
    workSampleJobId: undefined,
  };
}

export function applyLateWorkSample<T extends WorkSampleWorkflowState>(
  value: T,
  result: WorkSampleAssessment,
): Omit<T, 'hasWrittenTest' | 'resumeReading' | 'workSample' | 'workSampleJobId'> & {
  hasWrittenTest: true;
  resumeReading: ResumeReading;
  workSample: WorkSampleAssessment;
  workSampleJobId: undefined;
} {
  if (value.workSample || value.resumeReading?.workSample)
    throw new Error('本场面试的作品只能成功分析一次。');
  if (!value.resumeReading?.interviewQuestions?.length)
    throw new Error('请先生成面试提纲。');
  return {
    ...value,
    hasWrittenTest: true,
    workSample: result,
    workSampleJobId: undefined,
    resumeReading: { ...value.resumeReading, workSample: result },
  };
}

export function workSampleStatusLabel(value: WorkSampleWorkflowState) {
  if (value.workSample || value.resumeReading?.workSample)
    return '有笔试 · 作品已分析';
  if (value.workSampleJobId) return '作品分析中';
  return value.hasWrittenTest ? '有笔试' : '无笔试';
}
