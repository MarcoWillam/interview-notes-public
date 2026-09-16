import {
  validateCloudInterview,
  type CloudInterview,
} from './cloud-interview.ts';
import { exportMarkdown } from './interview.ts';

export type InterviewHandoffStage = 'initial' | 'second';

type HandoffRecordOptions = {
  id: string;
  now: number;
};

function preparationFields(source: CloudInterview) {
  return {
    candidate: source.candidate,
    role: source.role,
    requirements: source.requirements,
    dimensionText: source.dimensionText,
    focus: source.focus,
    ...(source.scoringGuidance === undefined
      ? {}
      : { scoringGuidance: source.scoringGuidance }),
    ...(source.reportRequirements === undefined
      ? {}
      : { reportRequirements: source.reportRequirements }),
    sourceTemplateId: source.sourceTemplateId ?? null,
    templateModified: source.templateModified ?? false,
    outlineVersion: source.outlineVersion ?? 1,
    resumeText: source.resumeText,
    resumeName: source.resumeName,
  };
}

function cleanRecord(
  source: CloudInterview,
  options: HandoffRecordOptions,
): CloudInterview {
  return {
    id: options.id,
    groupId: null,
    createdAt: options.now,
    updatedAt: options.now,
    ...preparationFields(source),
    resumeReading: null,
    transcript: '',
    reviewed: false,
    report: null,
    conclusion: '',
    confirmed: false,
  };
}

export function createInitialHandoffRecord(
  source: CloudInterview,
  options: HandoffRecordOptions,
) {
  return validateCloudInterview({
    ...cleanRecord(source, options),
    interviewStage: 'initial',
    hasWrittenTest: source.hasWrittenTest ?? false,
    writtenTestConfirmed: source.writtenTestConfirmed ?? false,
    workSample: null,
  });
}

export function createSecondRoundHandoffRecord(
  source: CloudInterview,
  options: HandoffRecordOptions,
) {
  const standaloneSecondRound = source.interviewStage === 'second';
  const dimensions = source.dimensionText
    .split('、')
    .map((item) => item.trim())
    .filter(Boolean);
  const priorRoundText = standaloneSecondRound
    ? source.priorRoundText
    : exportMarkdown(
        source.candidate,
        {
          role: source.role,
          requirements: source.requirements,
          dimensions,
          focus: source.focus,
          scoringGuidance: source.scoringGuidance,
          reportRequirements: source.reportRequirements,
          resumeText: source.resumeText,
          transcript: source.transcript,
          ...(source.workSample ? { workSample: source.workSample } : {}),
        },
        source.report,
        source.conclusion,
        source.confirmed,
      );
  return validateCloudInterview({
    ...cleanRecord(source, options),
    interviewStage: 'second',
    priorRoundSource: standaloneSecondRound
      ? source.priorRoundSource
      : 'bole-markdown',
    priorRoundText,
    priorRoundName: standaloneSecondRound
      ? source.priorRoundName
      : `${source.candidate.trim() || '候选人'}-面试记录.md`,
    priorRoundDigest: standaloneSecondRound
      ? (source.priorRoundDigest ?? null)
      : null,
    secondRoundOutline: standaloneSecondRound
      ? (source.secondRoundOutline ?? null)
      : null,
  });
}
