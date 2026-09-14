import { BUILTIN_TEMPLATE_IDS } from './default-role-templates.ts';
import type { ResumeReading } from './resume-reading.ts';
import type {
  WorkSampleAnalysisResult,
  WorkSampleAssessment,
} from './work-sample.ts';
import { applyOutlineV2Supplement } from './outline-v2-supplement.ts';
import { applyOutlineV3Supplement } from './outline-v3-supplement.ts';

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
    ((value.resumeReading?.interviewQuestions?.length || 0) >= 6 ||
      value.resumeReading?.outline?.version === 2 ||
      value.resumeReading?.outline?.version === 3) &&
    !value.workSample &&
    !value.resumeReading?.workSample &&
    !value.workSampleJobId
  );
}

export function applyInitialWorkSample<T extends WorkSampleWorkflowState>(
  value: T,
  reading: ResumeReading,
): Omit<
  T,
  'hasWrittenTest' | 'resumeReading' | 'workSample' | 'workSampleJobId'
> & {
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
  result: WorkSampleAnalysisResult,
): Omit<
  T,
  'hasWrittenTest' | 'resumeReading' | 'workSample' | 'workSampleJobId'
> & {
  hasWrittenTest: true;
  resumeReading: ResumeReading;
  workSample: WorkSampleAssessment;
  workSampleJobId: undefined;
} {
  if (value.workSample || value.resumeReading?.workSample)
    throw new Error('本场面试的作品只能成功分析一次。');
  if (
    !value.resumeReading?.interviewQuestions?.length &&
    !value.resumeReading?.outline
  )
    throw new Error('请先生成面试提纲。');
  const workSample = 'version' in result ? result.workSample : result;
  const reading =
    'version' in result
      ? value.resumeReading.outline
        ? {
            ...value.resumeReading,
            outline:
              result.version === 3 && value.resumeReading.outline.version === 3
                ? applyOutlineV3Supplement(
                    value.resumeReading.outline,
                    result.outlineSupplement,
                  )
                : result.version === 2 &&
                    value.resumeReading.outline.version === 2
                  ? applyOutlineV2Supplement(
                      value.resumeReading.outline,
                      result.outlineSupplement,
                    )
                  : (() => {
                      throw new Error('作品分析结果与面试提纲版本不一致。');
                    })(),
            workSample,
          }
        : (() => {
            throw new Error('结构化面试提纲不存在。');
          })()
      : { ...value.resumeReading, workSample };
  return {
    ...value,
    hasWrittenTest: true,
    workSample,
    workSampleJobId: undefined,
    resumeReading: reading,
  };
}

export function workSampleStatusLabel(value: WorkSampleWorkflowState) {
  if (value.workSample || value.resumeReading?.workSample)
    return '有笔试 · 作品已分析';
  if (value.workSampleJobId) return '作品分析中';
  return value.hasWrittenTest ? '有笔试' : '无笔试';
}
