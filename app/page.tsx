'use client';
import { importResume } from '@/lib/import-resume';
import {
  applyCandidateNameChange,
  reconcileCandidateName,
} from '@/lib/resume-workflow';
import { ResumeReadingView } from '@/components/interview/resume-reading-view';
import { WorkSamplePicker } from '@/components/interview/work-sample-picker';
import {
  validateResumeInput,
  exportResumeReading,
  type ResumeReading,
} from '@/lib/resume-reading';
import {
  submitRemoteResume,
  submitRemoteWrittenTest,
  submitRemoteWorkSample,
  submitRemoteOutline,
  submitRemoteFollowUpOutline,
  submitRemoteSecondRoundOutline,
  submitRemoteSecondRoundAssessment,
  listRemoteArtifacts,
  type RemoteArtifact,
} from '@/lib/remote-analysis';
import {
  validateWrittenTestSupplement,
  type WrittenTestSupplementResult,
} from '@/lib/written-test-supplement';
import type {
  WorkSampleAnalysisResult,
  WorkSampleAssessment,
  WorkSampleReference,
} from '@/lib/work-sample';
import { validateWorkSampleAnalysisResult } from '@/lib/work-sample';
import {
  createPreparationWorkSampleInput,
  createPreparationWrittenTestInput,
} from '@/lib/preparation-analysis-inputs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  ClipboardCheck,
  ShieldCheck,
  Download,
  Settings2,
  ArrowRight,
  LoaderCircle,
  Check,
  CircleAlert,
  X,
  Upload,
  ChevronDown,
  LogOut,
  Monitor,
  MoreHorizontal,
  UserPlus,
  LayoutDashboard,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import {
  validateInput,
  exportMarkdown,
  workSampleVerificationLabels,
  type Report,
} from '@/lib/interview';
import { useInterviewLibrary } from '@/hooks/use-interview-library';
import type { NewInterviewSeed, SavedInterview } from '@/lib/local/store';
import {
  applyWrittenTestSupplement,
  appliedTemplateState,
  canGenerateWrittenTestSupplement,
  outlineVersionForStandards,
  resolveResumeOutlinePreflight,
  resolveResumeOutlineSetup,
  resolveTemplateSelection,
  resumeOutlineLocked,
  supportsWrittenTest,
} from '@/lib/interview-template-state';
import {
  BUILTIN_TEMPLATE_IDS,
  builtInRoleTemplates,
} from '@/lib/default-role-templates';
import { LocalLibrary } from '@/components/interview/local-library';
import { InterviewSidebar } from '@/components/interview/interview-sidebar';
import { GlobalPreferences } from '@/components/interview/global-preferences';
import { InterviewPreparation } from '@/components/interview/interview-preparation';
import { InterviewSessionSummary } from '@/components/interview/interview-session-summary';
import { InterviewHandoffDialog } from '@/components/interview/interview-handoff-dialog';
import { CandidateDashboard } from '@/components/interview/candidate-dashboard';
import { SecondRoundOutlineView } from '@/components/interview/second-round-outline-view';
import { SecondRoundComparisonView } from '@/components/interview/second-round-comparison-view';
import {
  SecondRoundCreateDialog,
  type SecondRoundCreateSeed,
} from '@/components/interview/second-round-create-dialog';
import { TaskCenter } from '@/components/interview/task-center';
import {
  defaultStandards,
  normalizeStandards,
  type InterviewStandards,
} from '@/lib/standards';
import { importTranscript } from '@/lib/import-transcript';
import {
  submitRemoteAnalysis,
  remoteRequest,
  type RemoteJob,
} from '@/lib/remote-analysis';
import { interviewStatus } from '@/lib/interview-status';
import {
  applyLateWorkSample,
  canSubmitWorkSample,
} from '@/lib/work-sample-workflow';
import { groupAssessmentDimensions } from '@/lib/assessment-groups';
import {
  applyOutlineRegeneration,
  validateOutlineRegenerationResult,
  type OutlineRegenerationInput,
  type OutlineRegenerationResult,
} from '@/lib/outline-regeneration';
import {
  canApplyOutlineRegeneration,
  canRegenerateOutline,
  createOutlineRegenerationInput,
} from '@/lib/outline-regeneration-workflow';

import {
  normalizeRequestedFocus,
  validateFollowUpOutlineInput,
  type FollowUpOutlineGroup,
  type FollowUpOutlineResult,
} from '@/lib/follow-up-outline';
import {
  parsePriorRoundDocument,
  validateSecondRoundAssessmentInput,
  validateSecondRoundOutlineInput,
  type InterviewStage,
  type PriorRoundComparison,
  type PriorRoundSource,
  type SecondRoundDigest,
  type SecondRoundOutline,
  exportPriorRoundComparison,
} from '@/lib/second-round';
import {
  recoverSecondRoundTaskResult,
  secondRoundTaskSourceHash,
} from '@/lib/second-round-task';
import { extractPriorRoundReviewPoints } from '@/lib/prior-round-review-points';

const defaultDimensions = defaultStandards.dimensionText;
const MANUAL_TRANSCRIPT_SOURCE = '手动粘贴 / 输入';
export type WorkspaceAccount = {
  id: string;
  username: string;
  preview: boolean;
  owner: boolean;
  pending: boolean;
  error: string;
  onOpenDevices: () => void;
  onOpenAccount: () => void;
  onLogout: () => void;
};
export type WorkspaceConnectorUpdate = {
  required: boolean;
  latestVersion: string;
  notes: string;
  downloadUrl: string;
  onOpenDevices: () => void;
  onDismiss?: () => void;
};
type BusyKind =
  | 'import'
  | 'analyze'
  | 'resume-read'
  | 'written-test'
  | 'work-sample'
  | 'outline'
  | 'follow-up-outline'
  | 'second-round-outline'
  | 'second-round-assessment'
  | 'prepare';
type RemoteWaitKind = Extract<
  BusyKind,
  | 'analyze'
  | 'resume-read'
  | 'written-test'
  | 'work-sample'
  | 'outline'
  | 'second-round-outline'
  | 'second-round-assessment'
>;
type RemoteWaitBinding = {
  controller: AbortController;
  jobId: string;
  kind: RemoteWaitKind;
  recordId: string;
};
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Home({
  workspaceAccount,
  connectorUpdate,
}: {
  workspaceAccount?: WorkspaceAccount;
  connectorUpdate?: WorkspaceConnectorUpdate;
} = {}) {
  const [view, setView] = useState<'dashboard' | 'workbench'>('dashboard');
  const [tab, setTab] = useState('resume');
  const [interviewStage, setInterviewStage] =
    useState<InterviewStage>('initial');
  const [priorRoundSource, setPriorRoundSource] = useState<PriorRoundSource>();
  const [priorRoundText, setPriorRoundText] = useState('');
  const [priorRoundName, setPriorRoundName] = useState('');
  const [priorRoundDigest, setPriorRoundDigest] =
    useState<SecondRoundDigest | null>(null);
  const [secondRoundOutline, setSecondRoundOutline] =
    useState<SecondRoundOutline | null>(null);
  const [secondRoundOutlineJobId, setSecondRoundOutlineJobId] =
    useState<string>();
  const [secondRoundOutlineSourceHash, setSecondRoundOutlineSourceHash] =
    useState<string>();
  const [priorRoundComparison, setPriorRoundComparison] = useState<
    PriorRoundComparison[]
  >([]);
  const [secondRoundAssessmentJobId, setSecondRoundAssessmentJobId] =
    useState<string>();
  const [secondRoundAssessmentSourceHash, setSecondRoundAssessmentSourceHash] =
    useState<string>();
  const [secondRoundCreateOpen, setSecondRoundCreateOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffTarget, setHandoffTarget] = useState('');
  const [candidate, setCandidate] = useState('');
  const [role, setRole] = useState('');
  const [requirements, setRequirements] = useState('');
  const [dimensionText, setDimensionText] = useState(defaultDimensions);
  const [focus, setFocus] = useState('');
  const [scoringGuidance, setScoringGuidance] = useState('');
  const [reportRequirements, setReportRequirements] = useState('');
  const [sourceTemplateId, setSourceTemplateId] = useState<string | null>(null);
  const [templateModified, setTemplateModified] = useState(false);
  const [outlineVersion, setOutlineVersion] = useState<1 | 2 | 3>(1);
  const [hasWrittenTest, setHasWrittenTest] = useState(false);
  const [writtenTestConfirmed, setWrittenTestConfirmed] = useState(false);
  const [resumeText, setResumeText] = useState('');
  const [resumeName, setResumeName] = useState('');
  const [resumeReading, setResumeReading] = useState<ResumeReading | null>(
    null,
  );
  const [outlineSupplements, setOutlineSupplements] = useState<
    FollowUpOutlineGroup[]
  >([]);
  const [followUpOutlineJobId, setFollowUpOutlineJobId] = useState<
    string | undefined
  >();
  const [followUpOutlineDraft, setFollowUpOutlineDraft] = useState('');
  const followUpController = useRef<AbortController | null>(null);
  const followUpRecordId = useRef('');
  const recordNavigationEpoch = useRef(0);
  const [workSample, setWorkSample] = useState<WorkSampleAssessment | null>(
    null,
  );
  const [workSampleJobId, setWorkSampleJobId] = useState<string | undefined>();
  const [workSampleArtifacts, setWorkSampleArtifacts] = useState<
    RemoteArtifact[]
  >([]);
  const [workSampleLoading, setWorkSampleLoading] = useState(false);
  const [workSampleError, setWorkSampleError] = useState('');
  const [lateWorkSampleOpen, setLateWorkSampleOpen] = useState(false);
  const [lateWorkSampleArtifact, setLateWorkSampleArtifact] =
    useState<RemoteArtifact | null>(null);
  const [resumeBodyOpen, setResumeBodyOpen] = useState(false);
  const candidateKeepButton = useRef<HTMLButtonElement>(null);
  const [pendingCandidateName, setPendingCandidateName] = useState<{
    current: string;
    detected: string;
  } | null>(null);
  const [pendingResume, setPendingResume] = useState<{
    text: string;
    name: string;
    autoRead: boolean;
  } | null>(null);
  const [pendingResumeOutline, setPendingResumeOutline] = useState<{
    text: string;
    name: string;
    templateId: string;
    writtenTest: boolean | null;
    artifact: RemoteArtifact | null;
  } | null>(null);
  const [pendingWrittenTestSupplement, setPendingWrittenTestSupplement] =
    useState(false);
  const [writtenTestJobId, setWrittenTestJobId] = useState<
    string | undefined
  >();
  const [pendingOutlineRegeneration, setPendingOutlineRegeneration] =
    useState(false);
  const [outlineRegeneratedAt, setOutlineRegeneratedAt] = useState<
    number | undefined
  >();
  const [outlineRegenerationJobId, setOutlineRegenerationJobId] = useState<
    string | undefined
  >();
  const [outlineRevision, setOutlineRevision] = useState<string | undefined>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [taskCenterOpeningId, setTaskCenterOpeningId] = useState<string | null>(
    null,
  );
  const taskCenterNavigationRef = useRef(false);
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [standardsOpen, setStandardsOpen] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [transcriptName, setTranscriptName] = useState('');
  const [pendingImport, setPendingImport] = useState<{
    text: string;
    name: string;
  } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [conclusion, setConclusion] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<BusyKind | null>(null);
  const busyRef = useRef(false);
  const analysisController = useRef<AbortController | null>(null);
  const remoteWaitRef = useRef<RemoteWaitBinding | null>(null);
  useEffect(
    () => () => {
      analysisController.current?.abort();
      analysisController.current = null;
      followUpController.current?.abort();
      followUpController.current = null;
    },
    [],
  );
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [services, setServices] = useState<{
    analysis: boolean;
    provider?: 'codex-local' | 'codex-queue';
    connected?: boolean;
    message?: string;
  } | null>(null);
  const localCodex = services?.provider === 'codex-local';
  const queuedCodex = services?.provider === 'codex-queue';
  const effectiveHasWrittenTest =
    supportsWrittenTest(sourceTemplateId) && hasWrittenTest;
  const effectiveWrittenTestConfirmed =
    supportsWrittenTest(sourceTemplateId) && writtenTestConfirmed;
  const outlineLocked = resumeOutlineLocked(resumeReading);
  const writtenTestSupplemented = !!(
    resumeReading?.writtenTestSupplement?.length ||
    resumeReading?.outline?.reserveQuestions.some(
      (question) => question.source === 'written-test',
    )
  );
  const writtenTestSupplementEligible = canGenerateWrittenTestSupplement({
    sourceTemplateId,
    writtenTestConfirmed: effectiveWrittenTestConfirmed,
    hasWrittenTest: effectiveHasWrittenTest,
    hasResumeReading: !!(
      resumeReading?.interviewQuestions || resumeReading?.outline
    ),
    hasSupplement: writtenTestSupplemented,
  });
  const workSampleEligible = canSubmitWorkSample({
    sourceTemplateId,
    hasWrittenTest: effectiveHasWrittenTest,
    resumeReading,
    workSample,
    workSampleJobId,
  });
  const outlineRegenerationEligible = canRegenerateOutline({
    resumeText,
    reading: resumeReading,
    transcript,
    report,
    confirmed,
    regeneratedAt: outlineRegeneratedAt,
    activeJobId: outlineRegenerationJobId,
    preparationJobIds: [
      writtenTestJobId,
      workSampleJobId,
      followUpOutlineJobId,
    ],
    busy: !!busy,
  });
  const outlineTaskActive = !!outlineRegenerationJobId;
  const followUpTaskActive = !!followUpOutlineJobId;
  const followUpBusy =
    !!busy ||
    followUpTaskActive ||
    outlineTaskActive ||
    !!writtenTestJobId ||
    !!workSampleJobId;
  // Imports and queue responses may finish after the render that started them.
  const resumeContext = useRef({
    candidate,
    resumeText,
    role,
    requirements,
    dimensionText,
    focus,
    scoringGuidance,
    reportRequirements,
    hasWrittenTest: effectiveHasWrittenTest,
    writtenTestConfirmed: effectiveWrittenTestConfirmed,
    sourceTemplateId,
    outlineVersion,
    queuedCodex,
  });
  useEffect(() => {
    resumeContext.current = {
      candidate,
      resumeText,
      role,
      requirements,
      dimensionText,
      focus,
      scoringGuidance,
      reportRequirements,
      hasWrittenTest: effectiveHasWrittenTest,
      writtenTestConfirmed: effectiveWrittenTestConfirmed,
      sourceTemplateId,
      outlineVersion,
      queuedCodex,
    };
  }, [
    candidate,
    resumeText,
    role,
    requirements,
    dimensionText,
    focus,
    scoringGuidance,
    reportRequirements,
    effectiveHasWrittenTest,
    effectiveWrittenTestConfirmed,
    sourceTemplateId,
    outlineVersion,
    queuedCodex,
  ]);
  const [remoteJob, setRemoteJob] = useState<RemoteJob | null>(null);
  const cancelledRemotely = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [settings, setSettings] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const dimensions = dimensionText
    .split(/[、,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const input = {
    role,
    requirements,
    transcript,
    dimensions,
    resumeText,
    focus,
    scoringGuidance,
    reportRequirements,
    ...(workSample ? { workSample } : {}),
  };
  const standards: InterviewStandards = {
    role,
    requirements,
    dimensionText,
    focus,
    scoringGuidance,
    reportRequirements,
  };
  const secondRoundContext = useRef({
    candidate,
    role,
    requirements,
    dimensionText,
    focus,
    scoringGuidance,
    reportRequirements,
    priorRoundSource,
    priorRoundText,
    priorRoundName,
    resumeText,
    input,
  });
  useEffect(() => {
    secondRoundContext.current = {
      candidate,
      role,
      requirements,
      dimensionText,
      focus,
      scoringGuidance,
      reportRequirements,
      priorRoundSource,
      priorRoundText,
      priorRoundName,
      resumeText,
      input: {
        role,
        requirements,
        transcript,
        dimensions: dimensionText
          .split(/[、,，\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
        resumeText,
        focus,
        scoringGuidance,
        reportRequirements,
        ...(workSample ? { workSample } : {}),
      },
    };
  }, [
    candidate,
    role,
    requirements,
    dimensionText,
    focus,
    scoringGuidance,
    reportRequirements,
    priorRoundSource,
    priorRoundText,
    priorRoundName,
    resumeText,
    transcript,
    workSample,
  ]);
  function clearRemoteTaskDisplay() {
    remoteWaitRef.current = null;
    setRemoteJob(null);
    setCancelling(false);
    cancelledRemotely.current = false;
  }
  function trackRemoteWait(
    controller: AbortController,
    job: RemoteJob<unknown>,
    kind: RemoteWaitKind,
    recordId: string,
  ) {
    if (analysisController.current !== controller || controller.signal.aborted)
      return;
    setRemoteJob({ ...job, report: null });
    if (
      job.state === 'queued' ||
      job.state === 'running' ||
      job.state === 'paused'
    ) {
      remoteWaitRef.current = { controller, jobId: job.id, kind, recordId };
    } else if (remoteWaitRef.current?.controller === controller) {
      remoteWaitRef.current = null;
    }
  }
  function releaseRecordTaskWaits() {
    analysisController.current?.abort();
    analysisController.current = null;
    followUpController.current?.abort();
    followUpController.current = null;
    busyRef.current = false;
    setBusy(null);
    remoteWaitRef.current = null;
    setRemoteJob(null);
    setCancelling(false);
    cancelledRemotely.current = false;
  }
  function finishAnalysisWait(controller: AbortController) {
    if (analysisController.current !== controller) return;
    analysisController.current = null;
    busyRef.current = false;
    setBusy(null);
    remoteWaitRef.current = null;
    setRemoteJob(null);
    setCancelling(false);
    cancelledRemotely.current = false;
  }
  async function restoreInterview(saved: SavedInterview) {
    const sameFollowUpRecord = followUpRecordId.current === saved.id;
    followUpRecordId.current = saved.id;
    releaseRecordTaskWaits();
    setError('');
    setPendingCandidateName(null);
    setPendingResume(null);
    setPendingResumeOutline(null);
    setPendingWrittenTestSupplement(false);
    setPendingOutlineRegeneration(false);
    setInterviewStage(saved.interviewStage || 'initial');
    setPriorRoundSource(saved.priorRoundSource);
    setPriorRoundText(saved.priorRoundText || '');
    setPriorRoundName(saved.priorRoundName || '');
    setPriorRoundDigest(saved.priorRoundDigest || null);
    setSecondRoundOutline(saved.secondRoundOutline || null);
    setSecondRoundOutlineJobId(saved.secondRoundOutlineJobId);
    setSecondRoundOutlineSourceHash(saved.secondRoundOutlineSourceHash);
    setPriorRoundComparison(saved.priorRoundComparison || []);
    setSecondRoundAssessmentJobId(saved.secondRoundAssessmentJobId);
    setSecondRoundAssessmentSourceHash(saved.secondRoundAssessmentSourceHash);
    setLateWorkSampleOpen(false);
    setLateWorkSampleArtifact(null);
    setCandidate(saved.candidate);
    setRole(saved.role);
    setRequirements(saved.requirements);
    setDimensionText(saved.dimensionText);
    setFocus(saved.focus || '');
    setScoringGuidance(saved.scoringGuidance || '');
    setReportRequirements(saved.reportRequirements || '');
    setSourceTemplateId(saved.sourceTemplateId ?? null);
    setTemplateModified(saved.templateModified ?? false);
    setOutlineVersion(saved.outlineVersion ?? 1);
    setHasWrittenTest(saved.hasWrittenTest ?? false);
    setWrittenTestConfirmed(saved.writtenTestConfirmed ?? false);
    setResumeText(saved.resumeText || '');
    setResumeName(saved.resumeName || '');
    setResumeReading(saved.resumeReading || null);
    setOutlineSupplements(saved.outlineSupplements || []);
    setFollowUpOutlineJobId(saved.followUpOutlineJobId);
    if (!sameFollowUpRecord) setFollowUpOutlineDraft('');
    setWorkSample(saved.workSample || saved.resumeReading?.workSample || null);
    setWorkSampleJobId(saved.workSampleJobId);
    setWrittenTestJobId(saved.writtenTestJobId);
    setOutlineRegeneratedAt(saved.outlineRegeneratedAt);
    setOutlineRegenerationJobId(saved.outlineRegenerationJobId);
    setOutlineRevision(saved.outlineRevision);
    setResumeBodyOpen(false);
    setTranscript(saved.transcript);
    setTranscriptName(
      saved.transcriptName || (saved.transcript ? '历史面试记录' : ''),
    );
    setReviewed(saved.reviewed);
    setReport(saved.report);
    setConclusion(saved.conclusion);
    setConfirmed(saved.confirmed);
    setTab('resume');
    setNotice('已从当前浏览器恢复面试记录。');
  }
  const library = useInterviewLibrary(
    {
      interviewStage,
      priorRoundSource,
      priorRoundText,
      priorRoundName,
      priorRoundDigest,
      secondRoundOutline,
      secondRoundOutlineJobId,
      secondRoundOutlineSourceHash,
      priorRoundComparison,
      secondRoundAssessmentJobId,
      secondRoundAssessmentSourceHash,
      candidate,
      role,
      requirements,
      dimensionText,
      focus,
      scoringGuidance,
      reportRequirements,
      resumeText,
      resumeName,
      resumeReading,
      transcript,
      transcriptName,
      reviewed,
      report,
      conclusion,
      confirmed,
      sourceTemplateId,
      templateModified,
      outlineVersion,
      hasWrittenTest: effectiveHasWrittenTest,
      writtenTestConfirmed: effectiveWrittenTestConfirmed,
      workSample,
      workSampleJobId,
      writtenTestJobId,
      outlineRegeneratedAt,
      outlineRegenerationJobId,
      outlineRevision,
      outlineSupplements,
      followUpOutlineJobId,
    },
    restoreInterview,
    reset,
    {
      cloud: !!workspaceAccount && !workspaceAccount.preview,
    },
  );
  const handoffStage =
    workspaceAccount && !workspaceAccount.preview
      ? interviewStage === 'second'
        ? confirmed
          ? null
          : 'second'
        : confirmed
          ? 'second'
          : workspaceAccount?.owner
            ? 'initial'
            : null
      : null;
  useEffect(() => {
    let disposed = false;
    void Promise.resolve()
      .then(() => {
        if (disposed) return null;
        setHandoffTarget('');
        if (!handoffStage || !library.id) return null;
        return remoteRequest<{
          handoffs: Array<{ stage: InterviewStage; targetUsername: string }>;
        }>(`/api/interviews/${encodeURIComponent(library.id)}/handoffs`);
      })
      .then((result) => {
        if (!disposed && result)
          setHandoffTarget(
            result.handoffs.find(({ stage }) => stage === handoffStage)
              ?.targetUsername || '',
          );
      })
      .catch(() => {
        // The handoff dialog reports actionable errors when the user opens it.
      });
    return () => {
      disposed = true;
    };
  }, [handoffStage, library.id]);
  async function refreshCurrentAnalysisRecord(
    controller: AbortController,
    recordId: string,
    navigationEpoch: number,
  ) {
    if (
      analysisController.current !== controller ||
      followUpRecordId.current !== recordId ||
      recordNavigationEpoch.current !== navigationEpoch
    )
      return false;
    await library.refreshFromCloud(recordId);
    return (
      followUpRecordId.current === recordId &&
      recordNavigationEpoch.current === navigationEpoch
    );
  }
  const libraryRef = useRef(library);
  useEffect(() => {
    libraryRef.current = library;
    followUpRecordId.current = library.id;
  }, [library]);
  useEffect(() => {
    const jobId = secondRoundOutlineJobId || secondRoundAssessmentJobId;
    if (!library.ready || !jobId || busyRef.current) return;
    const kind = secondRoundOutlineJobId
      ? 'second-round-outline'
      : 'second-round-assessment';
    const sourceHash =
      kind === 'second-round-outline'
        ? secondRoundOutlineSourceHash
        : secondRoundAssessmentSourceHash;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearTask = async (persist = true) => {
      if (kind === 'second-round-outline') {
        if (persist)
          await libraryRef.current.flush({
            secondRoundOutlineJobId: undefined,
            secondRoundOutlineSourceHash: undefined,
          });
        setSecondRoundOutlineJobId(undefined);
        setSecondRoundOutlineSourceHash(undefined);
      } else {
        if (persist)
          await libraryRef.current.flush({
            secondRoundAssessmentJobId: undefined,
            secondRoundAssessmentSourceHash: undefined,
          });
        setSecondRoundAssessmentJobId(undefined);
        setSecondRoundAssessmentSourceHash(undefined);
      }
    };
    const recover = async () => {
      try {
        const job = await remoteRequest<RemoteJob>(
          '/api/jobs/' + encodeURIComponent(jobId),
        );
        if (disposed) return;
        if (job.state === 'completed') {
          if (job.resultDisposition === 'applied') {
            await clearTask(false);
            await libraryRef.current.refreshFromCloud();
            setNotice(
              kind === 'second-round-outline'
                ? '已恢复完成的复试提纲。'
                : '已恢复完成的独立复试评估。',
            );
            return;
          }
          if (job.resultDisposition === 'pending') {
            await clearTask(false);
            await libraryRef.current.refreshFromCloud();
            setError(
              '复试任务已完成，但资料发生变化。请在记录管理中确认结果。',
            );
            return;
          }
          if (!sourceHash || !job.report) {
            await clearTask();
            setError('复试任务缺少来源快照，请在任务中心查看结果并重新提交。');
            return;
          }
          const current = secondRoundContext.current;
          let outcome;
          try {
            outcome =
              kind === 'second-round-outline'
                ? await recoverSecondRoundTaskResult(
                    kind,
                    validateSecondRoundOutlineInput(current),
                    sourceHash,
                    job.report,
                  )
                : await recoverSecondRoundTaskResult(
                    kind,
                    validateSecondRoundAssessmentInput({
                      ...current.input,
                      priorRoundText: current.priorRoundText,
                    }),
                    sourceHash,
                    job.report,
                  );
          } catch (reason) {
            await clearTask();
            setError(
              reason instanceof Error
                ? `复试结果未自动应用：${reason.message}`
                : '复试结果结构校验失败，请在任务中心查看并重新提交。',
            );
            return;
          }
          if (outcome.status === 'stale') {
            await clearTask();
            setError(
              '复试资料在任务期间已变化，结果未自动应用。可在任务中心查看后重新提交当前材料。',
            );
            return;
          }
          if (kind === 'second-round-outline') {
            const result = outcome.result as Awaited<
              ReturnType<typeof submitRemoteSecondRoundOutline>
            >;
            await libraryRef.current.flush({
              priorRoundDigest: result.digest,
              secondRoundOutline: result.outline,
              secondRoundOutlineJobId: undefined,
              secondRoundOutlineSourceHash: undefined,
            });
            setPriorRoundDigest(result.digest);
            setSecondRoundOutline(result.outline);
            setSecondRoundOutlineJobId(undefined);
            setSecondRoundOutlineSourceHash(undefined);
            setNotice('已恢复完成的复试提纲。');
          } else {
            const result = outcome.result as Awaited<
              ReturnType<typeof submitRemoteSecondRoundAssessment>
            >;
            const { priorRoundComparison: comparison, ...nextReport } = result;
            await libraryRef.current.flush({
              report: nextReport,
              priorRoundComparison: comparison,
              secondRoundAssessmentJobId: undefined,
              secondRoundAssessmentSourceHash: undefined,
              confirmed: false,
            });
            setReport(nextReport);
            setPriorRoundComparison(comparison);
            setSecondRoundAssessmentJobId(undefined);
            setSecondRoundAssessmentSourceHash(undefined);
            setConfirmed(false);
            setNotice('已恢复完成的独立复试评估。');
          }
          return;
        }
        if (job.state === 'failed' || job.state === 'cancelled') {
          await clearTask();
          setError(job.error || '复试任务未完成，可以重新提交。');
          return;
        }
        setRemoteJob({ ...job, report: null });
        timer = setTimeout(() => void recover(), 3000);
      } catch (reason) {
        if (disposed) return;
        if ((reason as { status?: number }).status === 404) {
          await clearTask();
          setError('复试任务已过期，可以重新提交。');
          return;
        }
        timer = setTimeout(() => void recover(), 5000);
      }
    };
    void recover();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    library.ready,
    secondRoundAssessmentJobId,
    secondRoundAssessmentSourceHash,
    secondRoundOutlineJobId,
    secondRoundOutlineSourceHash,
  ]);
  const outlineLiveRef = useRef({
    recordId: library.id,
    resumeText,
    standards,
    reading: resumeReading,
    transcript,
    report,
    confirmed,
  });
  useEffect(() => {
    outlineLiveRef.current = {
      recordId: library.id,
      resumeText,
      standards: {
        role,
        requirements,
        dimensionText,
        focus,
        scoringGuidance,
        reportRequirements,
      },
      reading: resumeReading,
      transcript,
      report,
      confirmed,
    };
  }, [
    library.id,
    resumeText,
    role,
    requirements,
    dimensionText,
    focus,
    scoringGuidance,
    reportRequirements,
    resumeReading,
    transcript,
    report,
    confirmed,
  ]);
  useEffect(() => {
    if (!library.ready || !workSampleJobId || workSample || busyRef.current)
      return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const recover = async () => {
      let job: RemoteJob<WorkSampleAnalysisResult>;
      try {
        job = await remoteRequest<RemoteJob<WorkSampleAnalysisResult>>(
          '/api/jobs/' + encodeURIComponent(workSampleJobId),
        );
      } catch (reason) {
        if (disposed) return;
        if ((reason as { status?: number }).status === 404) {
          setWorkSampleJobId(undefined);
          setError('作品分析任务已过期，可以再次提交。');
          return;
        }
        setError('暂时无法获取作品分析进度，系统会继续重试。');
        timer = setTimeout(() => void recover(), 5000);
        return;
      }
      if (disposed) return;
      if (job.state === 'completed' && job.report) {
        try {
          if (job.resultDisposition === 'pending') {
            setWorkSampleJobId(undefined);
            await libraryRef.current.refreshFromCloud();
            setError(
              '作品分析已完成，但资料发生变化。请在记录管理中确认结果。',
            );
            return;
          }
          if (job.resultDisposition === 'applied') {
            setWorkSampleJobId(undefined);
            await libraryRef.current.refreshFromCloud();
            setNotice('已恢复完成的作品分析。');
            return;
          }
          const artifacts = await listRemoteArtifacts();
          if (disposed) return;
          const reference = artifacts.find(
            (artifact) => artifact.id === job.artifactId,
          );
          if (!reference) {
            setWorkSampleJobId(undefined);
            throw new Error(
              '已完成的作品文件信息已过期，请从任务中心查看结果。',
            );
          }
          if (!resumeReading)
            throw new Error('当前面试提纲已变化，未应用作品结果。');
          const analysisInput = createPreparationWorkSampleInput(
            {
              role,
              requirements,
              dimensionText,
              focus,
              scoringGuidance,
              reportRequirements,
              resumeText,
              outlineVersion,
            },
            resumeReading,
            reference,
          );
          const result = validateWorkSampleAnalysisResult(
            job.report,
            analysisInput,
          );
          const next = applyLateWorkSample(
            {
              sourceTemplateId,
              hasWrittenTest: effectiveHasWrittenTest,
              resumeReading,
              workSample,
              workSampleJobId,
            },
            result,
          );
          setResumeReading(next.resumeReading);
          setWorkSample(next.workSample);
          setWorkSampleJobId(undefined);
          setReport(null);
          setConfirmed(false);
          setHasWrittenTest(true);
          setWrittenTestConfirmed(true);
          setNotice(
            'version' in result
              ? `已恢复作品分析，${result.version === 3 ? 2 : 3} 道作品复盘题已更新到候选题。`
              : '已恢复完成的作品分析，并追加 3 道作品复盘题。',
          );
          return;
        } catch (reason) {
          if (disposed) return;
          const status = (reason as { status?: number }).status;
          if (
            status === 401 ||
            (typeof status === 'number' && status >= 500) ||
            reason instanceof TypeError
          ) {
            setError('暂时无法恢复作品分析结果，系统会继续重试。');
            timer = setTimeout(() => void recover(), 5000);
            return;
          }
          setWorkSampleJobId(undefined);
          setError(
            reason instanceof Error ? reason.message : '作品任务恢复失败。',
          );
          return;
        }
      }
      if (job.state === 'failed' || job.state === 'cancelled') {
        setWorkSampleJobId(undefined);
        setError(job.error || '作品分析未完成，可以重新提交。');
        return;
      }
      setRemoteJob({ ...job, report: null });
      timer = setTimeout(() => void recover(), 3000);
    };
    void recover();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    busy,
    dimensionText,
    focus,
    effectiveHasWrittenTest,
    library.ready,
    outlineVersion,
    reportRequirements,
    requirements,
    resumeReading,
    resumeText,
    sourceTemplateId,
    role,
    scoringGuidance,
    workSample,
    workSampleJobId,
  ]);
  useEffect(() => {
    if (
      !library.ready ||
      !writtenTestJobId ||
      (!resumeReading?.interviewQuestions && !resumeReading?.outline) ||
      busyRef.current
    )
      return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const supplementInput = createPreparationWrittenTestInput(
      {
        resumeText,
        role,
        requirements,
        dimensionText,
        focus,
        scoringGuidance,
        reportRequirements,
        outlineVersion,
      },
      resumeReading,
    );
    const recover = async () => {
      try {
        const job = await remoteRequest<RemoteJob<WrittenTestSupplementResult>>(
          '/api/jobs/' + encodeURIComponent(writtenTestJobId),
        );
        if (disposed) return;
        if (job.state === 'completed' && job.report) {
          if (job.resultDisposition === 'pending') {
            setWrittenTestJobId(undefined);
            await libraryRef.current.refreshFromCloud();
            setError(
              '笔试复盘题已完成，但资料发生变化。请在记录管理中确认结果。',
            );
            return;
          }
          if (job.resultDisposition === 'applied') {
            setWrittenTestJobId(undefined);
            await libraryRef.current.refreshFromCloud();
            setNotice('已恢复完成的笔试复盘题。');
            return;
          }
          const result = validateWrittenTestSupplement(
            job.report,
            supplementInput,
            { conciseQuestions: true },
          );
          setResumeReading(applyWrittenTestSupplement(resumeReading, result));
          setHasWrittenTest(true);
          setWrittenTestConfirmed(true);
          setWrittenTestJobId(undefined);
          setNotice(
            'version' in result
              ? `已恢复并将 ${result.version === 3 ? 2 : 3} 道笔试复盘题更新到候选题。`
              : '已恢复并追加 3 道笔试复盘题。',
          );
          return;
        }
        if (job.state === 'failed' || job.state === 'cancelled') {
          setWrittenTestJobId(undefined);
          setError(job.error || '笔试复盘补充未完成，可以再次提交。');
          return;
        }
        setRemoteJob({ ...job, report: null });
        timer = setTimeout(() => void recover(), 3000);
      } catch (reason) {
        if (disposed) return;
        if ((reason as { status?: number }).status === 404) {
          setWrittenTestJobId(undefined);
          setError('笔试复盘任务已过期，可以再次提交。');
          return;
        }
        setError('暂时无法获取笔试复盘任务进度，系统会继续重试。');
        timer = setTimeout(() => void recover(), 5000);
      }
    };
    void recover();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    library.ready,
    writtenTestJobId,
    resumeReading,
    resumeText,
    role,
    requirements,
    dimensionText,
    focus,
    scoringGuidance,
    reportRequirements,
    outlineVersion,
  ]);
  useEffect(() => {
    if (
      !library.ready ||
      !outlineRegenerationJobId ||
      (!resumeReading?.interviewQuestions && !resumeReading?.outline) ||
      busyRef.current
    )
      return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const recover = async () => {
      let regenerationInput: OutlineRegenerationInput;
      try {
        if (transcript.trim() || report || confirmed)
          throw new Error('面试记录已开始，未应用重新生成的提纲。');
        regenerationInput = await createOutlineRegenerationInput({
          resumeText,
          standards: {
            role,
            requirements,
            dimensionText,
            focus,
            scoringGuidance,
            reportRequirements,
          },
          reading: resumeReading,
        });
        if (outlineRevision && outlineRevision !== regenerationInput.revision)
          throw new Error('面试记录已变化，未应用过期提纲。');
      } catch (reason) {
        if (!disposed) {
          setOutlineRegenerationJobId(undefined);
          setOutlineRevision(undefined);
          setError(
            reason instanceof Error
              ? reason.message
              : '面试记录已变化，未应用重新生成的提纲。',
          );
        }
        return;
      }
      try {
        const job = await remoteRequest<RemoteJob<OutlineRegenerationResult>>(
          '/api/jobs/' + encodeURIComponent(outlineRegenerationJobId),
        );
        if (disposed) return;
        if (job.state === 'completed' && job.report) {
          if (job.resultDisposition === 'pending') {
            setOutlineRegenerationJobId(undefined);
            setOutlineRevision(undefined);
            await libraryRef.current.refreshFromCloud();
            setError('新提纲已完成，但资料发生变化。请在记录管理中确认结果。');
            return;
          }
          if (job.resultDisposition === 'applied') {
            setOutlineRegenerationJobId(undefined);
            setOutlineRevision(undefined);
            await libraryRef.current.refreshFromCloud();
            setNotice('已恢复并应用重新生成的短问题提纲。');
            return;
          }
          let result: OutlineRegenerationResult;
          try {
            result = validateOutlineRegenerationResult(
              job.report,
              regenerationInput,
            );
          } catch (reason) {
            setOutlineRegenerationJobId(undefined);
            setOutlineRevision(undefined);
            setError(
              reason instanceof Error
                ? reason.message
                : '重新生成的提纲格式异常，旧提纲已保留。',
            );
            return;
          }
          setResumeReading(applyOutlineRegeneration(resumeReading, result));
          setOutlineRegeneratedAt(job.updated);
          setOutlineRegenerationJobId(undefined);
          setOutlineRevision(undefined);
          setNotice('已恢复并应用重新生成的短问题提纲。');
          return;
        }
        if (job.state === 'failed' || job.state === 'cancelled') {
          setOutlineRegenerationJobId(undefined);
          setOutlineRevision(undefined);
          setError(job.error || '提纲重新生成未完成，可以再次提交。');
          return;
        }
        setRemoteJob({ ...job, report: null });
        timer = setTimeout(() => void recover(), 3000);
      } catch (reason) {
        if (disposed) return;
        if ((reason as { status?: number }).status === 404) {
          setOutlineRegenerationJobId(undefined);
          setOutlineRevision(undefined);
          setError('提纲重新生成任务已过期，可以再次提交。');
          return;
        }
        setError('暂时无法获取提纲重新生成进度，系统会继续重试。');
        timer = setTimeout(() => void recover(), 5000);
      }
    };
    void recover();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    busy,
    library.ready,
    outlineRegenerationJobId,
    outlineRevision,
    resumeReading,
    resumeText,
    role,
    requirements,
    dimensionText,
    focus,
    scoringGuidance,
    reportRequirements,
    transcript,
    report,
    confirmed,
  ]);
  // Recover only the saved follow-up task; a polling error must never submit a new job.
  useEffect(() => {
    if (
      !library.ready ||
      !library.cloud ||
      !followUpOutlineJobId ||
      busyRef.current
    )
      return;
    const recordId = library.id;
    const draft = followUpOutlineDraft;
    const controller = new AbortController();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !disposed && followUpRecordId.current === recordId;
    const recover = async () => {
      if (!current()) return;
      try {
        const job = await remoteRequest<RemoteJob<FollowUpOutlineResult>>(
          '/api/jobs/' + encodeURIComponent(followUpOutlineJobId),
          { signal: controller.signal },
        );
        if (!current()) return;
        if (job.state === 'completed') {
          if (job.resultDisposition === 'applied') {
            await libraryRef.current.refreshFollowUpFromCloud(recordId);
            if (followUpRecordId.current !== recordId) return;
            setFollowUpOutlineJobId(undefined);
            setFollowUpOutlineDraft('');
            setRemoteJob(null);
            setNotice('已恢复完成的 2 道补充追问。');
            setTab('resume');
            return;
          }
          if (job.resultDisposition === 'pending') {
            await libraryRef.current.refreshFollowUpFromCloud(recordId);
            if (followUpRecordId.current !== recordId) return;
            setFollowUpOutlineJobId(undefined);
            setFollowUpOutlineDraft(draft);
            setRemoteJob(null);
            setError(
              '补充追问已完成，但资料发生变化。请在记录管理中确认结果。',
            );
            return;
          }
          setFollowUpOutlineJobId(undefined);
          setRemoteJob(null);
          setError('补充追问尚未应用，请在记录管理中检查任务结果后重试。');
          return;
        }
        if (job.state === 'failed' || job.state === 'cancelled') {
          setFollowUpOutlineJobId(undefined);
          setRemoteJob(null);
          setError(
            `${job.error || '补充追问任务未完成。'} 关注点已保留，可以重试。`,
          );
          return;
        }
        setRemoteJob({ ...job, report: null });
        timer = setTimeout(() => void recover(), 3000);
      } catch (reason) {
        if (!current()) return;
        if ((reason as { status?: number }).status === 404) {
          setFollowUpOutlineJobId(undefined);
          setRemoteJob(null);
          setError('补充追问任务已过期，关注点已保留，可以重试。');
          return;
        }
        setError('暂时无法获取补充追问进度，系统会继续重试，无需重复提交。');
        timer = setTimeout(() => void recover(), 5000);
      }
    };
    void recover();
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [
    library.ready,
    library.cloud,
    library.id,
    followUpOutlineJobId,
    followUpOutlineDraft,
    busy,
  ]);
  async function localAction(action: () => Promise<void>) {
    if (busyRef.current) return;
    clearRemoteTaskDisplay();
    busyRef.current = true;
    setBusy('prepare');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '本地操作失败');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }
  function applyTranscript(text: string, name: string) {
    if (outlineTaskActive) {
      setError('提纲正在重新生成，请等待完成或先在任务中心停止任务。');
      return;
    }
    editTranscript(text);
    setTranscriptName(name);
    setTab('transcript');
    setPendingImport(null);
    setNotice('面试记录已导入，请校对文字与说话人归属后再生成评估。');
  }
  async function transcriptFile(file: File) {
    if (busyRef.current || outlineTaskActive || followUpTaskActive) {
      if (outlineTaskActive)
        setError('提纲正在重新生成，请等待完成或先在任务中心停止任务。');
      return;
    }
    clearRemoteTaskDisplay();
    busyRef.current = true;
    setBusy('import');
    setError('');
    try {
      const text = await importTranscript(file);
      if (transcript.trim()) setPendingImport({ text, name: file.name });
      else applyTranscript(text, file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : '面试记录导入失败');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }
  function editResume(text: string, name = '') {
    if (outlineLocked) return;
    analysisController.current?.abort();
    analysisController.current = null;
    invalidate();
    setResumeText(text);
    setResumeName(name);
    setResumeReading(null);
    setOutlineSupplements([]);
    setFollowUpOutlineJobId(undefined);
    setFollowUpOutlineDraft('');
    followUpController.current?.abort();
    followUpController.current = null;
    busyRef.current = false;
    setBusy(null);
    clearRemoteTaskDisplay();
    setWorkSample(null);
    setWorkSampleJobId(undefined);
    setWrittenTestJobId(undefined);
    setOutlineRegeneratedAt(undefined);
    setOutlineRegenerationJobId(undefined);
    setOutlineRevision(undefined);
    setLateWorkSampleOpen(false);
    setLateWorkSampleArtifact(null);
    setPendingCandidateName(null);
    setPendingResumeOutline(null);
    setResumeBodyOpen(true);
  }
  async function applyImportedResume(text: string, name: string) {
    editResume(text, name);
    setPendingResume(null);
    setResumeBodyOpen(false);
    openResumeOutlinePreflight(text, name);
  }
  async function refreshWorkSampleArtifacts() {
    setWorkSampleLoading(true);
    setWorkSampleError('');
    try {
      setWorkSampleArtifacts(await listRemoteArtifacts());
    } catch (reason) {
      setWorkSampleError(
        reason instanceof Error ? reason.message : '作品清单刷新失败。',
      );
    } finally {
      setWorkSampleLoading(false);
    }
  }
  function openResumeOutlinePreflight(text: string, name: string) {
    if (resumeOutlineLocked(resumeReading)) {
      setError('提纲已生成，本面试记录不能再次生成。');
      return;
    }
    const templateId = builtInRoleTemplates.some(
      ({ id }) => id === sourceTemplateId,
    )
      ? sourceTemplateId || ''
      : '';
    setError('');
    setPendingResumeOutline({
      text,
      name,
      templateId,
      writtenTest:
        templateId === BUILTIN_TEMPLATE_IDS.aiProductManager &&
        writtenTestConfirmed
          ? hasWrittenTest
          : null,
      artifact: null,
    });
    void refreshWorkSampleArtifacts();
  }
  async function resumeFile(file: File) {
    if (busyRef.current || outlineLocked) return;
    clearRemoteTaskDisplay();
    busyRef.current = true;
    setBusy('import');
    setError('');
    const controller = new AbortController();
    analysisController.current?.abort();
    analysisController.current = controller;
    try {
      const text = await importResume(file);
      if (analysisController.current !== controller) return;
      controller.signal.throwIfAborted();
      if (resumeContext.current.resumeText.trim())
        setPendingResume({ text, name: file.name, autoRead: true });
      else await applyImportedResume(text, file.name);
    } catch (e) {
      if (analysisController.current !== controller) return;
      setResumeBodyOpen(true);
      setError(e instanceof Error ? e.message : '简历提取失败，原内容已保留。');
    } finally {
      if (
        analysisController.current === controller ||
        analysisController.current === null
      ) {
        analysisController.current = null;
        busyRef.current = false;
        setBusy(null);
      }
    }
  }
  async function runResumeReading(
    resumeText: string,
    resumeName: string,
    confirmedChoice: boolean,
    artifact: WorkSampleReference | null = null,
  ) {
    if (resumeOutlineLocked(resumeReading)) {
      setError('提纲已生成，本面试记录不能再次生成。');
      return;
    }
    const decision = confirmedChoice;
    const recordId = library.id;
    const navigationEpoch = recordNavigationEpoch.current;
    setPendingResumeOutline(null);
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    busyRef.current = true;
    setBusy('resume-read');
    setError('');
    setNotice('');
    setPendingCandidateName(null);
    clearRemoteTaskDisplay();
    try {
      const context = resumeContext.current;
      const value = validateResumeInput({
        resumeText,
        role: context.role,
        requirements: context.requirements,
        dimensionText: context.dimensionText,
        focus: context.focus,
        scoringGuidance: context.scoringGuidance,
        reportRequirements: context.reportRequirements,
        hasWrittenTest: decision,
        outlineVersion: context.outlineVersion,
        ...(artifact ? { workSample: artifact } : {}),
      });
      if (!context.queuedCodex)
        throw new Error('请使用当前队列版工作台连接 Codex 后阅读简历。');
      const recordBinding = await library.flushForTask({
        role: value.role,
        requirements: value.requirements,
        dimensionText: value.dimensionText,
        focus: value.focus,
        scoringGuidance: value.scoringGuidance,
        reportRequirements: value.reportRequirements,
        resumeText: value.resumeText,
        sourceTemplateId: context.sourceTemplateId,
        templateModified: false,
        outlineVersion: value.outlineVersion,
        hasWrittenTest: value.hasWrittenTest,
        writtenTestConfirmed:
          context.sourceTemplateId === BUILTIN_TEMPLATE_IDS.aiProductManager,
      });
      const valueRead = await submitRemoteResume(
        value,
        (context.candidate || resumeName || '未命名候选人').slice(0, 100),
        controller.signal,
        (job) => {
          trackRemoteWait(controller, job, 'resume-read', recordId);
        },
        {
          fetcher: fetch,
          pollMs: 2000,
          scope: recordId,
          ...recordBinding,
        },
      );
      if (analysisController.current !== controller) return;
      controller.signal.throwIfAborted();
      if (
        !(await refreshCurrentAnalysisRecord(
          controller,
          recordId,
          navigationEpoch,
        ))
      )
        return;
      setResumeReading(valueRead);
      setWorkSample(valueRead.workSample || null);
      setWorkSampleJobId(undefined);
      const resolution = reconcileCandidateName(
        resumeContext.current.candidate,
        valueRead.candidateName,
      );
      if (resolution.kind === 'fill') applyDetectedCandidate(resolution.value);
      else if (resolution.kind === 'confirm')
        setPendingCandidateName(resolution);
      setNotice(
        valueRead.candidateName?.trim()
          ? '简历要点已整理，内容来自候选人自述，请结合原文核实。'
          : '简历要点已整理；未识别到明确姓名，可在本场标准中填写，不影响继续面试。',
      );
      setTab('resume');
    } catch (e) {
      if (analysisController.current !== controller) return;
      setError(
        controller.signal.aborted
          ? cancelledRemotely.current
            ? '简历阅读已取消，正文保留。'
            : '已停止等待，可在任务列表查看结果。'
          : e instanceof Error
            ? e.message
            : '简历阅读失败。',
      );
    } finally {
      finishAnalysisWait(controller);
    }
  }
  function confirmResumeOutlineGeneration() {
    const pending = pendingResumeOutline;
    if (!pending || busyRef.current || resumeOutlineLocked(resumeReading))
      return;
    const availableTemplates = builtInRoleTemplates.map(
      (fallback) =>
        library.preferences.find(({ id }) => id === fallback.id) || fallback,
    );
    const resolved = resolveResumeOutlineSetup(
      pending.templateId,
      pending.writtenTest,
      availableTemplates,
    );
    if (!resolved) {
      setError('请先确认岗位及适用的笔试情况。');
      return;
    }
    const nextStandards = resolved.standards;
    const nextOutlineVersion = outlineVersionForStandards(
      resolved.templateId,
      nextStandards,
    );
    invalidate();
    setRole(nextStandards.role);
    setRequirements(nextStandards.requirements);
    setDimensionText(nextStandards.dimensionText);
    setFocus(nextStandards.focus);
    setScoringGuidance(nextStandards.scoringGuidance);
    setReportRequirements(nextStandards.reportRequirements);
    setSourceTemplateId(resolved.templateId);
    setTemplateModified(false);
    setOutlineVersion(nextOutlineVersion);
    setHasWrittenTest(resolved.hasWrittenTest);
    setWrittenTestConfirmed(
      resolved.templateId === BUILTIN_TEMPLATE_IDS.aiProductManager,
    );
    resumeContext.current = {
      ...resumeContext.current,
      resumeText: pending.text,
      ...nextStandards,
      sourceTemplateId: resolved.templateId,
      outlineVersion: nextOutlineVersion,
      hasWrittenTest: resolved.hasWrittenTest,
      writtenTestConfirmed:
        resolved.templateId === BUILTIN_TEMPLATE_IDS.aiProductManager,
    };
    setPendingResumeOutline(null);
    const selectedArtifact =
      resolved.templateId === BUILTIN_TEMPLATE_IDS.aiProductManager &&
      resolved.hasWrittenTest
        ? pending.artifact
        : null;
    void runResumeReading(
      pending.text,
      pending.name,
      resolved.hasWrittenTest,
      selectedArtifact,
    );
  }
  async function runFollowUpOutline(requestedFocus: string): Promise<boolean> {
    if (busyRef.current || followUpBusy) {
      setError('当前记录还有任务进行中，请等待完成或先在任务中心处理。');
      return false;
    }
    setFollowUpOutlineDraft(requestedFocus);
    if (!resumeReading?.outline && !resumeReading?.interviewQuestions?.length) {
      setError('请先生成面试提纲，再补充追问。');
      return false;
    }
    if (!queuedCodex || !library.cloud) {
      setError('补充追问需要登录云端队列版工作台；本地预览不能提交此任务。');
      return false;
    }
    const recordId = library.id;
    const controller = new AbortController();
    followUpController.current = controller;
    clearRemoteTaskDisplay();
    busyRef.current = true;
    setBusy('follow-up-outline');
    setError('');
    setNotice('');
    const current = () =>
      followUpController.current === controller &&
      followUpRecordId.current === recordId &&
      !controller.signal.aborted;
    try {
      const normalizedFocus = normalizeRequestedFocus(requestedFocus);
      setFollowUpOutlineDraft(normalizedFocus);
      const followUpInput = validateFollowUpOutlineInput({
        role,
        requirements,
        dimensionText,
        focus,
        scoringGuidance,
        reportRequirements,
        resumeText,
        resumeReading,
        outlineVersion,
        requestedFocus: normalizedFocus,
        existingSupplements: outlineSupplements,
      });
      const recordBinding = await library.flushForTask();
      if (!current()) return false;
      if (!recordBinding)
        throw new Error('面试记录尚未绑定云端，请同步成功后重试。');
      return await new Promise<boolean>((resolve) => {
        let accepted = false;
        controller.signal.addEventListener('abort', () => resolve(accepted), {
          once: true,
        });
        // Only submission belongs to the dialog. The saved-job effect owns polling.
        void Promise.resolve()
          .then(() =>
            submitRemoteFollowUpOutline(
              followUpInput,
              controller.signal,
              (job) => {
                if (!current() || accepted) return;
                accepted = true;
                setFollowUpOutlineJobId(job.id);
                setRemoteJob({ ...job, report: null });
                // Persist active task metadata; terminal responses are refreshed by
                // recovery so this old snapshot cannot overwrite completed groups.
                if (
                  job.state === 'queued' ||
                  job.state === 'running' ||
                  job.state === 'paused'
                ) {
                  void library
                    .flush({ followUpOutlineJobId: job.id })
                    .catch(() => {
                      if (followUpRecordId.current === recordId)
                        setError(
                          '任务已提交，但任务标识保存失败，请在任务中心查看进度。',
                        );
                    });
                }
                resolve(true);
                // Stop this helper's wait, not the server job. Recovery starts once
                // the submission busy state is released, including terminal POSTs.
                controller.abort();
              },
              {
                fetcher: fetch,
                pollMs: 2000,
                scope: recordId,
                ...recordBinding,
              },
            ),
          )
          .then(
            () => resolve(accepted),
            (reason: unknown) => {
              if (!accepted && current())
                setError(
                  `${reason instanceof Error ? reason.message : '补充追问提交失败。'} 请检查后重试。`,
                );
              resolve(accepted);
            },
          );
      });
    } catch (reason) {
      if (current())
        setError(
          `${reason instanceof Error ? reason.message : '补充追问提交失败。'} 请检查后重试。`,
        );
      return false;
    } finally {
      if (followUpController.current === controller) {
        followUpController.current = null;
        busyRef.current = false;
        setBusy(null);
      }
    }
  }
  async function deleteFollowUpOutline(groupId: string): Promise<boolean> {
    if (busyRef.current || followUpBusy) {
      setError('当前记录还有任务进行中，请等待完成后再删除补充追问。');
      return false;
    }
    const recordId = library.id;
    const next = outlineSupplements.filter((group) => group.id !== groupId);
    if (next.length === outlineSupplements.length) {
      setError('这组补充追问已不存在，请刷新记录。');
      return false;
    }
    busyRef.current = true;
    clearRemoteTaskDisplay();
    setBusy('prepare');
    try {
      await library.flush({ outlineSupplements: next });
      if (followUpRecordId.current !== recordId) return false;
      setOutlineSupplements(next);
      setError('');
      setNotice('已删除这组补充追问。');
      return true;
    } catch (reason) {
      if (followUpRecordId.current === recordId)
        setError(
          reason instanceof Error ? reason.message : '删除保存失败，请重试。',
        );
      return false;
    } finally {
      if (followUpRecordId.current === recordId) {
        busyRef.current = false;
        setBusy(null);
      }
    }
  }
  async function runOutlineRegeneration() {
    const reading = resumeReading;
    const recordId = library.id;
    const navigationEpoch = recordNavigationEpoch.current;
    if (
      busyRef.current ||
      followUpTaskActive ||
      (!reading?.interviewQuestions && !reading?.outline) ||
      !canRegenerateOutline({
        resumeText,
        reading,
        transcript,
        report,
        confirmed,
        regeneratedAt: outlineRegeneratedAt,
        activeJobId: outlineRegenerationJobId,
        preparationJobIds: [
          writtenTestJobId,
          workSampleJobId,
          followUpOutlineJobId,
        ],
      })
    ) {
      setPendingOutlineRegeneration(false);
      setError('当前记录不能重新生成提纲。');
      return;
    }
    setPendingOutlineRegeneration(false);
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    busyRef.current = true;
    setBusy('outline');
    setError('');
    setNotice('');
    clearRemoteTaskDisplay();
    let submittedJobId: string | undefined;
    let completedAt = 1;
    try {
      if (!queuedCodex)
        throw new Error('请使用队列版工作台连接 Codex 后重新生成提纲。');
      const regenerationInput: OutlineRegenerationInput =
        await createOutlineRegenerationInput({
          resumeText,
          standards,
          reading,
        });
      const recordBinding = await library.flushForTask();
      setOutlineRevision(regenerationInput.revision);
      const result = await submitRemoteOutline(
        regenerationInput,
        `${candidate || resumeName || '未命名候选人'} · 重新生成提纲`.slice(
          0,
          100,
        ),
        controller.signal,
        (job) => {
          if (
            analysisController.current === controller &&
            !controller.signal.aborted
          ) {
            submittedJobId = job.id;
            completedAt = job.updated;
            setOutlineRegenerationJobId(job.id);
            trackRemoteWait(controller, job, 'outline', recordId);
          }
        },
        {
          fetcher: fetch,
          pollMs: 2000,
          scope: recordId,
          ...recordBinding,
        },
      );
      if (analysisController.current !== controller) return;
      controller.signal.throwIfAborted();
      if (
        !(await refreshCurrentAnalysisRecord(
          controller,
          recordId,
          navigationEpoch,
        ))
      )
        return;
      const live = outlineLiveRef.current;
      if (!live.reading?.interviewQuestions && !live.reading?.outline)
        throw new Error('面试记录已变化，未应用过期提纲。');
      const currentInput = await createOutlineRegenerationInput({
        resumeText: live.resumeText,
        standards: live.standards,
        reading: live.reading,
      });
      const canApply = canApplyOutlineRegeneration({
        submittedRecordId: recordId,
        currentRecordId: live.recordId,
        submittedInput: regenerationInput,
        currentInput,
        transcript: live.transcript,
        report: live.report,
        confirmed: live.confirmed,
      });
      if (!canApply) {
        throw new Error('面试记录已变化，未应用过期提纲。');
      }
      const currentResult = validateOutlineRegenerationResult(
        result,
        currentInput,
      );
      setResumeReading(applyOutlineRegeneration(live.reading, currentResult));
      setOutlineRegeneratedAt(completedAt);
      setOutlineRegenerationJobId(undefined);
      setOutlineRevision(undefined);
      setNotice('面试提纲已重新生成，主问题已精简为现场可直接提问的短句。');
      setTab('resume');
    } catch (reason) {
      if (analysisController.current !== controller) return;
      const message =
        reason instanceof Error ? reason.message : '提纲重新生成失败。';
      const stillRemote =
        !!submittedJobId &&
        !controller.signal.aborted &&
        /任务已提交|无法获取进度/.test(message);
      if (!stillRemote) {
        setOutlineRegenerationJobId(undefined);
        setOutlineRevision(undefined);
      }
      setError(
        controller.signal.aborted
          ? cancelledRemotely.current
            ? '提纲重新生成任务已取消，旧提纲保留。'
            : '已停止等待，可在任务中心查看结果。'
          : message,
      );
    } finally {
      finishAnalysisWait(controller);
    }
  }
  async function runWrittenTestSupplement() {
    const reading = resumeReading;
    const recordId = library.id;
    const navigationEpoch = recordNavigationEpoch.current;
    let submittedJobId: string | undefined;
    if (
      busyRef.current ||
      followUpTaskActive ||
      (!reading?.interviewQuestions && !reading?.outline) ||
      !canGenerateWrittenTestSupplement({
        sourceTemplateId,
        writtenTestConfirmed: effectiveWrittenTestConfirmed,
        hasWrittenTest: effectiveHasWrittenTest,
        hasResumeReading: true,
        hasSupplement: !!reading.writtenTestSupplement?.length,
      })
    ) {
      setPendingWrittenTestSupplement(false);
      setError('当前记录不能生成笔试复盘补充题。');
      return;
    }
    setPendingWrittenTestSupplement(false);
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    busyRef.current = true;
    setBusy('written-test');
    setError('');
    setNotice('');
    clearRemoteTaskDisplay();
    try {
      const context = resumeContext.current;
      if (!context.queuedCodex)
        throw new Error('请使用当前队列版工作台连接 Codex 后生成补充题。');
      const supplementInput = createPreparationWrittenTestInput(
        context,
        reading,
      );
      const recordBinding = await library.flushForTask();
      const value = await submitRemoteWrittenTest(
        supplementInput,
        `${context.candidate || resumeName || '未命名候选人'} · 笔试复盘补充`.slice(
          0,
          100,
        ),
        controller.signal,
        (job) => {
          if (
            analysisController.current === controller &&
            !controller.signal.aborted
          ) {
            submittedJobId = job.id;
            setWrittenTestJobId(job.id);
            trackRemoteWait(controller, job, 'written-test', recordId);
          }
        },
        {
          fetcher: fetch,
          pollMs: 2000,
          scope: recordId,
          ...recordBinding,
        },
      );
      if (analysisController.current !== controller) return;
      controller.signal.throwIfAborted();
      if (
        !(await refreshCurrentAnalysisRecord(
          controller,
          recordId,
          navigationEpoch,
        ))
      )
        return;
      const result: WrittenTestSupplementResult = value;
      setResumeReading(applyWrittenTestSupplement(reading, result));
      setHasWrittenTest(true);
      setWrittenTestConfirmed(true);
      setWrittenTestJobId(undefined);
      resumeContext.current = {
        ...resumeContext.current,
        hasWrittenTest: true,
        writtenTestConfirmed: true,
      };
      setNotice(
        'version' in result
          ? `已将 ${result.version === 3 ? 2 : 3} 道笔试复盘题更新到候选题，笔试情况已同步为“有笔试”。`
          : '已追加 3 道笔试复盘题，笔试情况已同步为“有笔试”。',
      );
      setTab('resume');
    } catch (e) {
      if (analysisController.current !== controller) return;
      const message =
        e instanceof Error ? e.message : '笔试复盘补充题生成失败。';
      const stillRemote =
        !!submittedJobId &&
        !cancelledRemotely.current &&
        (/任务已提交|无法获取进度/.test(message) ||
          (controller.signal.aborted && !cancelledRemotely.current));
      if (!stillRemote) setWrittenTestJobId(undefined);
      setError(
        controller.signal.aborted
          ? cancelledRemotely.current
            ? '笔试复盘补充任务已取消，原提纲保留。'
            : '已停止等待，可在任务中心查看结果。'
          : message,
      );
    } finally {
      finishAnalysisWait(controller);
    }
  }
  function openLateWorkSample() {
    if (!workSampleEligible || busyRef.current || followUpTaskActive) return;
    setLateWorkSampleArtifact(null);
    setLateWorkSampleOpen(true);
    void refreshWorkSampleArtifacts();
  }
  async function runLateWorkSample() {
    const reading = resumeReading;
    const artifact = lateWorkSampleArtifact;
    const recordId = library.id;
    const navigationEpoch = recordNavigationEpoch.current;
    let submittedJobId: string | undefined;
    if (
      busyRef.current ||
      followUpTaskActive ||
      (!reading?.interviewQuestions && !reading?.outline) ||
      !workSampleEligible ||
      !artifact?.available
    ) {
      setError('请选择当前在线电脑中的笔试作品。');
      return;
    }
    setLateWorkSampleOpen(false);
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    busyRef.current = true;
    setBusy('work-sample');
    setError('');
    setNotice('');
    clearRemoteTaskDisplay();
    try {
      const context = resumeContext.current;
      if (!context.queuedCodex)
        throw new Error('请使用当前队列版工作台连接 Codex 后分析作品。');
      const progress = (job: RemoteJob<WorkSampleAnalysisResult>) => {
        if (
          analysisController.current === controller &&
          !controller.signal.aborted
        ) {
          submittedJobId = job.id;
          setWorkSampleJobId(job.id);
          trackRemoteWait(controller, job, 'work-sample', recordId);
        }
      };
      const result = await submitRemoteWorkSample(
        createPreparationWorkSampleInput(context, reading, artifact),
        `${context.candidate || resumeName || '未命名候选人'} · 笔试作品`.slice(
          0,
          100,
        ),
        controller.signal,
        progress,
        {
          fetcher: fetch,
          pollMs: 2000,
          scope: recordId,
          ...(await library.flushForTask()),
        },
      );
      if (analysisController.current !== controller) return;
      controller.signal.throwIfAborted();
      if (
        !(await refreshCurrentAnalysisRecord(
          controller,
          recordId,
          navigationEpoch,
        ))
      )
        return;
      const next = applyLateWorkSample(
        {
          sourceTemplateId,
          hasWrittenTest: effectiveHasWrittenTest,
          resumeReading: reading,
          workSample,
          workSampleJobId,
        },
        result,
      );
      setResumeReading(next.resumeReading);
      setWorkSample(next.workSample);
      setWorkSampleJobId(undefined);
      setReport(null);
      setConfirmed(false);
      setHasWrittenTest(true);
      setWrittenTestConfirmed(true);
      resumeContext.current = {
        ...resumeContext.current,
        hasWrittenTest: true,
        writtenTestConfirmed: true,
      };
      setNotice(
        'version' in result
          ? `作品已分析，${result.version === 3 ? '六' : '五'}道必问题保留，${result.version === 3 ? 2 : 3} 道作品复盘题已更新到候选题。`
          : '作品已分析，原提纲保留，并在下方追加 3 道作品复盘题。',
      );
      setTab('resume');
    } catch (reason) {
      if (analysisController.current !== controller) return;
      const message =
        reason instanceof Error ? reason.message : '笔试作品分析失败。';
      const stillRemote =
        !!submittedJobId &&
        !cancelledRemotely.current &&
        (/任务已提交|无法获取进度/.test(message) ||
          (controller.signal.aborted && !cancelledRemotely.current));
      if (!stillRemote) setWorkSampleJobId(undefined);
      setError(
        controller.signal.aborted
          ? cancelledRemotely.current
            ? '作品分析任务已取消，原提纲保留。'
            : '已停止等待，可在任务中心查看结果。'
          : message,
      );
    } finally {
      finishAnalysisWait(controller);
    }
  }
  const hasContent = Boolean(
    dimensionText !== defaultDimensions ||
    resumeText ||
    scoringGuidance ||
    reportRequirements ||
    focus ||
    candidate ||
    role ||
    requirements ||
    transcript ||
    conclusion,
  );
  const safeName = (candidate || '未命名面试')
    .replace(/[\\/:*?"<>|\r\n]/g, '_')
    .slice(0, 60);
  const refreshServices = useCallback(async () => {
    try {
      const value = await remoteRequest<NonNullable<typeof services>>(
        '/api/status',
        {
          signal: AbortSignal.timeout(10000),
        },
      );
      setServices(value);
      setStatusError(false);
    } catch {
      setServices(null);
      setStatusError(true);
    }
  }, []);
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- This callback updates state only after the external status request resolves.
    void refreshServices();
    const timer = setInterval(() => void refreshServices(), 10000);
    return () => clearInterval(timer);
  }, [refreshServices]);
  useEffect(() => {
    if (!library.unsaved && (busy !== 'analyze' || queuedCodex)) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [library.unsaved, busy, queuedCodex]);
  const reportSnapshot = useRef({
    report,
    conclusion,
    confirmed,
    transcriptLength: transcript.length,
  });
  useEffect(() => {
    reportSnapshot.current = {
      report,
      conclusion,
      confirmed,
      transcriptLength: transcript.length,
    };
  }, [report, conclusion, confirmed, transcript.length]);
  useEffect(() => {
    type ModelContext = {
      registerTool: (
        tool: {
          name: string;
          description: string;
          inputSchema: object;
          annotations: object;
          execute: (input: unknown) => unknown;
        },
        options: { signal: AbortSignal },
      ) => void | Promise<void>;
    };
    const ctx = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        ctx.registerTool(
          {
            name: 'get_interview_assessment',
            description:
              '读取当前面试的辅助评估、人工结论及确认状态；不会调用模型或改变结论。',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute(value) {
              if (
                !value ||
                typeof value !== 'object' ||
                Array.isArray(value) ||
                Object.keys(value).length
              )
                throw new Error('不接受参数');
              return reportSnapshot.current;
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional browser capability. */
    }
    return () => lifecycle.abort();
  }, []);
  function invalidate() {
    if (report || confirmed)
      setNotice('面试资料已修改，旧评估已清除；请重新评估并确认结论。');
    setReport(null);
    if (interviewStage === 'second') {
      setPriorRoundComparison([]);
      setSecondRoundAssessmentJobId(undefined);
    }
    setConfirmed(false);
    setError('');
  }
  function applyDetectedCandidate(name: string) {
    applyCandidateNameChange(resumeContext.current.candidate, name, {
      invalidate,
      setCandidate,
    });
  }
  function editTranscript(text: string) {
    if (outlineTaskActive) {
      setError('提纲正在重新生成，请等待完成或先在任务中心停止任务。');
      return;
    }
    invalidate();
    setTranscript(text);
    if (!transcriptName && text.trim())
      setTranscriptName(MANUAL_TRANSCRIPT_SOURCE);
    else if (transcriptName === MANUAL_TRANSCRIPT_SOURCE && !text.trim())
      setTranscriptName('');
    setReviewed(false);
  }
  async function replaceSecondRoundPrior(file: File) {
    if (secondRoundOutline || secondRoundOutlineJobId || busyRef.current) return;
    busyRef.current = true;
    setBusy('import');
    setError('');
    try {
      const text = await importTranscript(file);
      const parsed = parsePriorRoundDocument(text, file.name);
      setPriorRoundSource(parsed.source);
      setPriorRoundText(parsed.text);
      setPriorRoundName(parsed.name);
      setPriorRoundDigest(null);
      if (parsed.embeddedResumeText) {
        setResumeText(parsed.embeddedResumeText);
        setResumeName(parsed.name);
      } else if (priorRoundSource === 'bole-markdown') {
        setResumeText('');
        setResumeName('');
      }
      if (!candidate.trim() && parsed.candidate)
        setCandidate(parsed.candidate);
      setNotice('初试资料已更新，请确认简历和岗位后生成复试提纲。');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '初试资料读取失败。',
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }
  async function replaceSecondRoundResume(file: File) {
    if (secondRoundOutline || secondRoundOutlineJobId || busyRef.current) return;
    busyRef.current = true;
    setBusy('import');
    setError('');
    try {
      setResumeText(await importResume(file));
      setResumeName(file.name);
      setNotice('候选人简历已更新，请确认后生成复试提纲。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '简历提取失败。');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }
  async function runSecondRoundOutline() {
    if (
      busyRef.current ||
      secondRoundOutline ||
      secondRoundOutlineJobId ||
      !queuedCodex
    )
      return;
    const recordId = library.id;
    const navigationEpoch = recordNavigationEpoch.current;
    let outlineInput;
    try {
      outlineInput = validateSecondRoundOutlineInput({
        candidate,
        role,
        requirements,
        dimensionText,
        focus,
        scoringGuidance,
        reportRequirements,
        priorRoundSource,
        priorRoundText,
        priorRoundName,
        resumeText,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '请补全复试资料。');
      return;
    }
    clearRemoteTaskDisplay();
    busyRef.current = true;
    setBusy('second-round-outline');
    setError('');
    const controller = new AbortController();
    analysisController.current = controller;
    try {
      await library.flush();
      const sourceHash = await secondRoundTaskSourceHash(
        'second-round-outline',
        outlineInput,
      );
      let trackedJobId = secondRoundOutlineJobId;
      const result = await submitRemoteSecondRoundOutline(
        outlineInput,
        `${candidate} · 生成复试提纲`.slice(0, 100),
        controller.signal,
        (job) => {
          trackRemoteWait(controller, job, 'second-round-outline', recordId);
          if (job.id !== trackedJobId) {
            trackedJobId = job.id;
            setSecondRoundOutlineJobId(job.id);
            setSecondRoundOutlineSourceHash(sourceHash);
            void library
              .flush({
                secondRoundOutlineJobId: job.id,
                secondRoundOutlineSourceHash: sourceHash,
              })
              .catch(() => {});
          }
        },
        { fetcher: fetch, pollMs: 2000, scope: recordId },
      );
      if (
        analysisController.current !== controller ||
        followUpRecordId.current !== recordId ||
        recordNavigationEpoch.current !== navigationEpoch
      )
        return;
      const currentInput = validateSecondRoundOutlineInput(
        secondRoundContext.current,
      );
      const outcome = await recoverSecondRoundTaskResult(
        'second-round-outline',
        currentInput,
        sourceHash,
        result,
      );
      if (outcome.status === 'stale') {
        await library.flush({
          secondRoundOutlineJobId: undefined,
          secondRoundOutlineSourceHash: undefined,
        });
        setSecondRoundOutlineJobId(undefined);
        setSecondRoundOutlineSourceHash(undefined);
        setError(
          '复试资料在任务期间已变化，结果未自动应用。可在任务中心查看后重新提交当前材料。',
        );
        return;
      }
      await library.flush({
        priorRoundDigest: outcome.result.digest,
        secondRoundOutline: outcome.result.outline,
        secondRoundOutlineJobId: undefined,
        secondRoundOutlineSourceHash: undefined,
      });
      setPriorRoundDigest(outcome.result.digest);
      setSecondRoundOutline(outcome.result.outline);
      setSecondRoundOutlineJobId(undefined);
      setSecondRoundOutlineSourceHash(undefined);
      setNotice('复试提纲已生成，初试资料与简历已锁定。');
    } catch (reason) {
      if (analysisController.current !== controller) return;
      setError(
        controller.signal.aborted
          ? '已停止等待，请在任务中心查看服务器状态。'
          : reason instanceof Error
            ? reason.message
            : '复试提纲生成失败。',
      );
    } finally {
      finishAnalysisWait(controller);
    }
  }

  async function analyzeSecondRound() {
    if (busyRef.current || secondRoundAssessmentJobId) return;
    if (!secondRoundOutline)
      return setError('请先生成复试提纲，再生成复试结论。');
    if (!reviewed)
      return setError('请先校对复试对话和说话人归属，并勾选确认。');
    const secondInput = {
      ...input,
      priorRoundText,
    };
    const recordId = library.id;
    const navigationEpoch = recordNavigationEpoch.current;
    clearRemoteTaskDisplay();
    busyRef.current = true;
    setBusy('second-round-assessment');
    setError('');
    const controller = new AbortController();
    analysisController.current = controller;
    try {
      const normalizedInput = validateSecondRoundAssessmentInput(secondInput);
      await library.flush();
      const sourceHash = await secondRoundTaskSourceHash(
        'second-round-assessment',
        normalizedInput,
      );
      let trackedJobId = secondRoundAssessmentJobId;
      const data = await submitRemoteSecondRoundAssessment(
        normalizedInput,
        `${candidate} · 复试结论评估`.slice(0, 100),
        controller.signal,
        (job) => {
          trackRemoteWait(controller, job, 'second-round-assessment', recordId);
          if (job.id !== trackedJobId) {
            trackedJobId = job.id;
            setSecondRoundAssessmentJobId(job.id);
            setSecondRoundAssessmentSourceHash(sourceHash);
            void library
              .flush({
                secondRoundAssessmentJobId: job.id,
                secondRoundAssessmentSourceHash: sourceHash,
              })
              .catch(() => {});
          }
        },
        { fetcher: fetch, pollMs: 2000, scope: recordId },
      );
      if (
        analysisController.current !== controller ||
        followUpRecordId.current !== recordId ||
        recordNavigationEpoch.current !== navigationEpoch
      )
        return;
      const current = secondRoundContext.current;
      const currentInput = validateSecondRoundAssessmentInput({
        ...current.input,
        priorRoundText: current.priorRoundText,
      });
      const outcome = await recoverSecondRoundTaskResult(
        'second-round-assessment',
        currentInput,
        sourceHash,
        data,
      );
      if (outcome.status === 'stale') {
        await library.flush({
          secondRoundAssessmentJobId: undefined,
          secondRoundAssessmentSourceHash: undefined,
        });
        setSecondRoundAssessmentJobId(undefined);
        setSecondRoundAssessmentSourceHash(undefined);
        setError(
          '复试资料在任务期间已变化，结果未自动应用。可在任务中心查看后重新提交当前材料。',
        );
        return;
      }
      const { priorRoundComparison: comparison, ...nextReport } =
        outcome.result;
      await library.flush({
        report: nextReport,
        priorRoundComparison: comparison,
        secondRoundAssessmentJobId: undefined,
        secondRoundAssessmentSourceHash: undefined,
        confirmed: false,
      });
      setReport(nextReport);
      setPriorRoundComparison(comparison);
      setSecondRoundAssessmentJobId(undefined);
      setSecondRoundAssessmentSourceHash(undefined);
      setConfirmed(false);
      setTab('report');
      setNotice('独立复试评估已生成，请核实本轮引用与判断。');
    } catch (reason) {
      if (analysisController.current !== controller) return;
      setError(
        controller.signal.aborted
          ? '已停止等待，请在任务中心查看服务器状态。'
          : reason instanceof Error
            ? reason.message
            : '复试评估失败。',
      );
    } finally {
      finishAnalysisWait(controller);
    }
  }
  async function analyze() {
    if (interviewStage === 'second') {
      await analyzeSecondRound();
      return;
    }
    if (busyRef.current || outlineTaskActive || followUpTaskActive) {
      if (outlineTaskActive)
        setError('提纲正在重新生成，请等待完成或先在任务中心停止任务。');
      return;
    }
    setError('');
    try {
      validateInput(input);
      if (!reviewed)
        throw new Error('请先校对对话内容和说话人归属，并勾选确认。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '请补全面试资料');
      return;
    }
    const recordId = library.id;
    const navigationEpoch = recordNavigationEpoch.current;
    clearRemoteTaskDisplay();
    busyRef.current = true;
    setBusy('analyze');
    const controller = new AbortController();
    analysisController.current = controller;
    try {
      let data: Report;
      if (queuedCodex) {
        const recordBinding = await library.flushForTask();
        data = await submitRemoteAnalysis(
          input,
          `${candidate || '未命名面试'} · ${role}`.slice(0, 100),
          controller.signal,
          (job) => trackRemoteWait(controller, job, 'analyze', recordId),
          { fetcher: fetch, pollMs: 2000, ...recordBinding },
        );
        if (
          !(await refreshCurrentAnalysisRecord(
            controller,
            recordId,
            navigationEpoch,
          ))
        )
          return;
      } else {
        const r = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(localCodex ? 260000 : 100000),
          ]),
        });
        data = (await r.json()) as Report & { error?: string };
        controller.signal.throwIfAborted();
        if (!r.ok)
          throw new Error(
            (data as Report & { error?: string }).error || '生成评估失败',
          );
      }
      if (!queuedCodex) {
        if (analysisController.current !== controller) return;
        controller.signal.throwIfAborted();
      }
      setReport(data);
      setConfirmed(false);
      setTab('report');
      setNotice('辅助评估已生成，请核实引用与判断后填写最终意见。');
    } catch (e) {
      if (analysisController.current !== controller) return;
      setError(
        controller.signal.aborted
          ? queuedCodex
            ? cancelledRemotely.current
              ? '任务已取消，原记录保留。'
              : '已停止等待，请在评估任务中查看服务器状态。'
            : '已取消分析，原记录保留。'
          : e instanceof Error && e.name === 'TimeoutError'
            ? '分析超时，记录仍保留，请重试。'
            : e instanceof Error
              ? e.message
              : '分析失败',
      );
    } finally {
      finishAnalysisWait(controller);
    }
  }
  async function cancelAnalysis() {
    const controller = analysisController.current;
    if (!queuedCodex) {
      controller?.abort();
      return;
    }
    if (!remoteJob || cancelling) return;
    setCancelling(true);
    try {
      const job = await remoteRequest<RemoteJob>(
        '/api/jobs/' + encodeURIComponent(remoteJob.id),
        { method: 'DELETE' },
      );
      if (analysisController.current !== controller) return;
      cancelledRemotely.current = job.state === 'cancelled';
      controller?.abort();
    } catch (e) {
      if (analysisController.current === controller)
        setError(e instanceof Error ? e.message : '取消失败，请重试。');
    } finally {
      if (
        !analysisController.current ||
        analysisController.current === controller
      )
        setCancelling(false);
    }
  }
  function confirmConclusion() {
    try {
      validateInput(input);
      if (!reviewed) throw new Error('请先在面试记录页完成校对确认。');
      if (!conclusion.trim()) throw new Error('请填写面试官结论。');
      setError('');
      setConfirmed(true);
      setNotice('面试结论已确认，将自动保存在本地，也可导出备份。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '请补全资料');
    }
  }
  function setStandards(value: InterviewStandards) {
    setRole(value.role);
    setRequirements(value.requirements);
    setDimensionText(value.dimensionText);
    setFocus(value.focus);
    setScoringGuidance(value.scoringGuidance);
    setReportRequirements(value.reportRequirements);
  }
  function applyStandards(value: InterviewStandards) {
    if (outlineLocked) return;
    invalidate();
    setStandards(value);
    setTemplateModified(true);
    setOutlineVersion(1);
  }
  function reset(seed: NewInterviewSeed) {
    followUpRecordId.current = '';
    releaseRecordTaskWaits();
    setStandards(seed.standards);
    setInterviewStage(seed.interviewStage || 'initial');
    setPriorRoundSource(seed.priorRoundSource);
    setPriorRoundText(seed.priorRoundText || '');
    setPriorRoundName(seed.priorRoundName || '');
    setPriorRoundDigest(null);
    setSecondRoundOutline(null);
    setSecondRoundOutlineJobId(undefined);
    setSecondRoundOutlineSourceHash(undefined);
    setPriorRoundComparison([]);
    setSecondRoundAssessmentJobId(undefined);
    setSecondRoundAssessmentSourceHash(undefined);
    setSourceTemplateId(seed.sourceTemplateId);
    setTemplateModified(false);
    setOutlineVersion(
      outlineVersionForStandards(seed.sourceTemplateId, seed.standards),
    );
    setHasWrittenTest(false);
    setWrittenTestConfirmed(false);
    setCandidate(seed.candidate || '');
    setResumeText(seed.resumeText || '');
    setResumeName(seed.resumeName || '');
    setResumeReading(null);
    setOutlineSupplements([]);
    setFollowUpOutlineJobId(undefined);
    setFollowUpOutlineDraft('');
    setWorkSample(null);
    setWorkSampleJobId(undefined);
    setWrittenTestJobId(undefined);
    setOutlineRegeneratedAt(undefined);
    setOutlineRegenerationJobId(undefined);
    setOutlineRevision(undefined);
    setLateWorkSampleOpen(false);
    setLateWorkSampleArtifact(null);
    setResumeBodyOpen(false);
    setPendingCandidateName(null);
    setPendingResume(null);
    setPendingResumeOutline(null);
    setPendingWrittenTestSupplement(false);
    setPendingOutlineRegeneration(false);
    setTranscript('');
    setTranscriptName('');
    setPendingImport(null);
    setReviewed(false);
    setReport(null);
    setConclusion('');
    setConfirmed(false);
    setNotice('');
    setError('');
    setTab('resume');
    setResetOpen(false);
  }
  function exportRecord() {
    const comparisonMarkdown =
      interviewStage === 'second'
        ? exportPriorRoundComparison(priorRoundComparison)
        : '';
    download(
      new Blob(
        [
          exportMarkdown(
            candidate,
            input,
            report,
            conclusion,
            confirmed,
            interviewStage === 'second' ? '独立复试评估记录' : undefined,
          ) +
            (resumeReading ? '\n\n' + exportResumeReading(resumeReading) : '') +
            (comparisonMarkdown ? '\n\n' + comparisonMarkdown : ''),
        ],
        { type: 'text/markdown;charset=utf-8' },
      ),
      `${safeName}-${interviewStage === 'second' ? '复试' : '面试'}记录.md`,
    );
  }
  const templateSelection = resolveTemplateSelection(
    standards,
    sourceTemplateId ?? null,
    templateModified,
    library.preferences,
    library.globalSettings.defaults,
  );
  const preparationProps = {
    candidate,
    standards,
    templates: library.preferences,
    disabled: !!busy,
    standardsLocked:
      interviewStage === 'second' ? !!secondRoundOutline : outlineLocked,
    standardsOpen,
    templateSelection,
    hasWrittenTest: effectiveHasWrittenTest,
    writtenTestConfirmed: effectiveWrittenTestConfirmed,
    writtenTestSupported:
      interviewStage === 'initial' && supportsWrittenTest(sourceTemplateId),
    writtenTestSupplemented,
    workSampleAnalyzed: !!workSample,
    onStandardsOpenChange: setStandardsOpen,
    onCandidateChange: (value: string) => {
      invalidate();
      setCandidate(value);
    },
    onStandardsChange: applyStandards,
    onApplyTemplate: (id: string) => {
      if (outlineLocked) return;
      const selected = library.preferences.find(
        (preference) => preference.id === id,
      );
      if (selected) {
        invalidate();
        const selectedStandards = normalizeStandards(selected);
        setStandards(selectedStandards);
        const next = appliedTemplateState(id);
        setSourceTemplateId(next.sourceTemplateId);
        setTemplateModified(next.templateModified);
        setOutlineVersion(outlineVersionForStandards(id, selectedStandards));
        setHasWrittenTest(next.hasWrittenTest);
        setWrittenTestConfirmed(next.writtenTestConfirmed);
        setWorkSample(null);
        setWorkSampleJobId(undefined);
        setNotice('已将模板标准复制到本场面试；旧评估已清除，请重新确认结论。');
      }
    },
    serviceReady: !!(
      services?.analysis &&
      (!queuedCodex || services.connected)
    ),
    serviceStatus: statusError
      ? '服务状态获取失败'
      : services === null
        ? '正在检查服务…'
        : services.analysis
          ? queuedCodex
            ? services.connected
              ? '电脑已连接 · 可分析'
              : '电脑未就绪 · 可排队'
            : localCodex
              ? '本地 Codex 已连接'
              : '模型服务已配置'
          : localCodex
            ? '本地 Codex 需登录'
            : '模型服务待配置',
    onOpenService: () => setSettings(true),
  };
  async function openInterview(id: string) {
    recordNavigationEpoch.current++;
    await library.open(id);
    setTab('resume');
    setView('workbench');
  }
  async function openInterviewFromTaskCenter(id: string) {
    if (taskCenterNavigationRef.current) return;
    setError('');
    setTab('resume');
    setView('workbench');
    const wait = remoteWaitRef.current;
    const detachableKind =
      busy === 'analyze' ||
      busy === 'resume-read' ||
      busy === 'written-test' ||
      busy === 'work-sample' ||
      busy === 'outline';
    const activeRemoteJob =
      remoteJob?.state === 'queued' ||
      remoteJob?.state === 'running' ||
      remoteJob?.state === 'paused';
    const canDetach = !!(
      busyRef.current &&
      queuedCodex &&
      detachableKind &&
      activeRemoteJob &&
      wait &&
      wait.controller === analysisController.current &&
      wait.kind === busy &&
      wait.recordId === library.id &&
      wait.jobId === remoteJob?.id
    );
    if (busyRef.current && !canDetach) {
      setError(
        busy === 'import'
          ? '当前资料正在导入，请等待完成后再切换面试记录。'
          : queuedCodex
            ? '当前任务尚未确认进入服务器队列，请等待任务中心出现后再切换记录。'
            : '本地分析正在运行，请等待完成或先取消分析，再切换面试记录。',
      );
      return;
    }
    taskCenterNavigationRef.current = true;
    setTaskCenterOpeningId(id);
    if (canDetach) releaseRecordTaskWaits();
    recordNavigationEpoch.current++;
    try {
      await library.openLatest(id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? `打开面试记录失败：${reason.message}`
          : '打开面试记录失败，请稍后重试。',
      );
    } finally {
      taskCenterNavigationRef.current = false;
      setTaskCenterOpeningId(null);
    }
  }
  async function createInterview() {
    recordNavigationEpoch.current++;
    await library.create();
    setView('workbench');
  }
  async function createSecondRoundInterview(seed: SecondRoundCreateSeed) {
    const template = library.preferences.find(
      ({ id }) => id === seed.sourceTemplateId,
    );
    if (!template) throw new Error('请选择有效的复试岗位模板。');
    recordNavigationEpoch.current++;
    await library.create({
      standards: normalizeStandards(template),
      sourceTemplateId: template.id,
      interviewStage: 'second',
      candidate: seed.candidate,
      priorRoundSource: seed.priorRound.source,
      priorRoundText: seed.priorRound.text,
      priorRoundName: seed.priorRound.name,
      resumeText: seed.resumeText,
      resumeName: seed.resumeName,
    });
    setTab('resume');
    setView('workbench');
    setNotice('复试资料已导入，请确认后生成复试提纲。');
  }
  const priorRoundReviewPoints = useMemo(
    () => extractPriorRoundReviewPoints(priorRoundText, priorRoundDigest),
    [priorRoundText, priorRoundDigest],
  );
  return (
    <div className="workbench-root">
      <header className="topbar">
        <div className="topbar-identity">
          <div className="brand">
            <span className="brand-mark">
              <ClipboardCheck size={23} />
            </span>
            <b>
              伯乐 AI<span>INTERVIEW COPILOT</span>
            </b>
          </div>
          <nav className="workspace-view-nav" aria-label="页面导航">
            <button
              type="button"
              aria-label="候选人看板"
              aria-current={view === 'dashboard' ? 'page' : undefined}
              onClick={() => setView('dashboard')}
            >
              <LayoutDashboard size={15} /> <span>候选人看板</span>
            </button>
            <button
              type="button"
              aria-label="面试工作台"
              aria-current={view === 'workbench' ? 'page' : undefined}
              disabled={!library.ready}
              onClick={() => setView('workbench')}
            >
              <ClipboardCheck size={15} /> <span>面试工作台</span>
            </button>
          </nav>
        </div>
        <nav className="topbar-actions" aria-label="工作台操作">
          <span className="privacy-label" title="当前面试资料保存在这台设备">
            <ShieldCheck size={16} />
            <span>当前设备 · 本地保存</span>
          </span>
          <div className="workspace-tools" data-open={toolsOpen || undefined}>
            <button
              type="button"
              className="workspace-tools-trigger"
              aria-label="更多操作"
              aria-expanded={toolsOpen}
              aria-controls="workspace-tools-menu"
              onClick={() => setToolsOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setToolsOpen(false);
              }}
            >
              <MoreHorizontal size={18} />
              <span>更多操作</span>
            </button>
            <div id="workspace-tools-menu" className="workspace-tools-content">
              {workspaceAccount && (
                <>
                  <button
                    className="text-button"
                    onClick={() => {
                      setToolsOpen(false);
                      workspaceAccount.onOpenDevices();
                    }}
                  >
                    <Monitor size={16} />
                    <span className="workspace-action-copy">电脑连接</span>
                  </button>
                  <TaskCenter
                    onOpen={() => setToolsOpen(false)}
                    onOpenInterview={(id) => {
                      setToolsOpen(false);
                      void openInterviewFromTaskCenter(id);
                    }}
                  />
                </>
              )}
              <button
                className="global-settings-entry text-button"
                disabled={!library.ready || library.working || !!busy}
                onClick={() => {
                  setToolsOpen(false);
                  void localAction(async () => {
                    await library.refresh();
                    setPreferencesOpen(true);
                  });
                }}
                aria-label="打开全局面试设置"
              >
                <Settings2 size={18} />
                <span className="workspace-action-copy">全局设置</span>
              </button>
            </div>
          </div>
          {workspaceAccount?.preview ? (
            <span className="workspace-account-label">本机预览</span>
          ) : workspaceAccount ? (
            <details className="workspace-account-menu">
              <summary>
                <span>{workspaceAccount.username}</span>
                <ChevronDown size={14} />
              </summary>
              <div>
                {workspaceAccount.owner && (
                  <button
                    onClick={(event) => {
                      event.currentTarget
                        .closest('details')
                        ?.removeAttribute('open');
                      workspaceAccount.onOpenAccount();
                    }}
                  >
                    <UserPlus size={15} /> 账号配置
                  </button>
                )}
                <button
                  disabled={workspaceAccount.pending}
                  onClick={(event) => {
                    event.currentTarget
                      .closest('details')
                      ?.removeAttribute('open');
                    workspaceAccount.onLogout();
                  }}
                >
                  <LogOut size={15} /> 退出登录
                </button>
              </div>
            </details>
          ) : null}
        </nav>
      </header>
      {connectorUpdate && (
        <aside
          className={`connector-update-banner ${connectorUpdate.required ? 'is-required' : ''}`}
          role={connectorUpdate.required ? 'alert' : 'status'}
        >
          <div>
            <strong>
              {connectorUpdate.required
                ? '电脑连接器需要更新'
                : '电脑连接器有新版本'}
            </strong>
            <span>
              最新版 {connectorUpdate.latestVersion} · {connectorUpdate.notes}
            </span>
          </div>
          <div className="connector-update-actions">
            <button
              className="text-button"
              onClick={connectorUpdate.onOpenDevices}
            >
              查看设备
            </button>
            <a
              className="secondary-button"
              href={connectorUpdate.downloadUrl}
              download
            >
              <Download size={15} /> 下载更新
            </a>
            {connectorUpdate.onDismiss && (
              <button
                className="icon-button"
                aria-label="暂时关闭更新提醒"
                onClick={connectorUpdate.onDismiss}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </aside>
      )}
      {workspaceAccount?.error && (
        <p className="remote-error workspace-remote-error" role="alert">
          {workspaceAccount.error}
        </p>
      )}
      <div className="workbench-shell">
        <InterviewSidebar
          storageScope={workspaceAccount?.id || 'standalone-preview'}
          sessions={library.sessions}
          groups={library.groups}
          currentId={view === 'workbench' ? library.id : ''}
          disabled={!library.ready || library.working || !!busy}
          saveStatus={
            library.unsaved
              ? '正在保存…'
              : workspaceAccount?.preview || !workspaceAccount
                ? '已保存在当前浏览器'
                : library.syncStatus === 'conflict'
                  ? '需要处理冲突'
                  : library.syncStatus === 'pending'
                    ? '等待同步到云端'
                    : library.syncStatus === 'syncing'
                      ? '正在同步到云端…'
                      : '已同步到云端'
          }
          onCreate={() => {
            setResetOpen(true);
          }}
          onOpen={(id) => void localAction(() => openInterview(id))}
          onManage={() =>
            void localAction(async () => {
              await library.refresh();
              setHistoryOpen(true);
            })
          }
          onCreateGroup={library.createGroup}
          onRenameGroup={library.renameGroup}
          onDeleteGroup={library.deleteGroup}
          onMoveToGroup={library.moveToGroup}
          workspacePreferences={
            library.cloud
              ? library.workspacePreferences || undefined
              : undefined
          }
          onWorkspacePreferencesChange={
            library.cloud && library.workspaceReady
              ? library.updateWorkspacePreferences
              : undefined
          }
        />
        <div className="workbench">
          {(!library.ready || library.error) && (
            <div className="workspace">
              <div className="message" role="alert">
                {library.error ||
                  (library.access === 'blocked'
                    ? '另一个标签正在使用本地工作台。请关闭另一个标签后刷新，避免互相覆盖。'
                    : library.access === 'unavailable'
                      ? '浏览器本地存储不可用，请使用正常模式的 Chrome 打开。'
                      : '正在恢复本地面试记录…')}
              </div>
            </div>
          )}
          {view === 'dashboard' && (
            <CandidateDashboard
              sessions={library.sessions}
              groups={library.groups}
              disabled={!library.ready || library.working || !!busy}
              onCreate={() => {
                setResetOpen(true);
              }}
              onOpen={(id) => void localAction(() => openInterview(id))}
            />
          )}
          <main
            className="workspace"
            hidden={view !== 'workbench'}
            inert={!library.ready || library.working || busy === 'prepare'}
          >
            <div className="page-heading">
              <h1>
                {candidate
                  ? `${candidate}的${interviewStage === 'second' ? '复试' : '面试'}记录`
                  : interviewStage === 'second'
                    ? '当前复试'
                    : '当前面试'}
              </h1>
            </div>
            <InterviewSessionSummary
              interviewStage={interviewStage}
              priorRoundSource={priorRoundSource}
              candidate={candidate}
              role={standards.role}
              status={interviewStatus({
                transcript,
                reviewed,
                report,
                conclusion,
                confirmed,
              })}
              writtenTestSupported={supportsWrittenTest(sourceTemplateId)}
              writtenTestConfirmed={effectiveWrittenTestConfirmed}
              hasWrittenTest={effectiveHasWrittenTest}
              writtenTestSupplemented={writtenTestSupplemented}
              workSampleAnalyzed={!!workSample}
              outlineLocked={
                interviewStage === 'second'
                  ? !!secondRoundOutline
                  : outlineLocked
              }
              disabled={!!busy || outlineTaskActive}
              open={preparationOpen}
              onOpen={() => setPreparationOpen(true)}
              handoffLabel={
                handoffStage
                  ? handoffTarget
                    ? `已派发${handoffStage === 'second' ? '复试' : '初试'} · ${handoffTarget}`
                    : handoffStage === 'second'
                      ? '派发复试'
                      : '派发初试'
                  : undefined
              }
              onHandoff={
                handoffStage ? () => setHandoffOpen(true) : undefined
              }
            />
            {error && (
              <div role="alert" className="message error">
                <CircleAlert size={18} />
                <span>{error}</span>
                {error && (
                  <button
                    aria-label="关闭错误提示"
                    onClick={() => setError('')}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            )}
            {taskCenterOpeningId && (
              <output className="message" data-testid="task-center-opening">
                <LoaderCircle className="spin" size={18} />
                <span>正在打开面试记录…</span>
              </output>
            )}
            {notice && (
              <output className="message">
                <Check size={17} />
                <span>{notice}</span>
                <button aria-label="关闭提示" onClick={() => setNotice('')}>
                  <X size={16} />
                </button>
              </output>
            )}
            {(busy === 'follow-up-outline' || followUpTaskActive) && (
              <output
                className="message"
                data-testid="follow-up-outline-progress"
              >
                <LoaderCircle className="spin" size={18} />
                <span>
                  {busy === 'follow-up-outline'
                    ? '正在提交补充追问任务…'
                    : remoteJob?.state === 'running'
                      ? 'Codex 正在生成补充追问。可以继续使用工作台或关闭网页，稍后从任务中心查看结果。'
                      : '补充追问任务已提交，等待电脑处理。可以继续使用工作台，稍后从任务中心查看结果。'}
                </span>
              </output>
            )}
            {(busy === 'analyze' ||
              busy === 'resume-read' ||
              busy === 'written-test' ||
              busy === 'work-sample' ||
              busy === 'outline' ||
              busy === 'second-round-outline' ||
              busy === 'second-round-assessment') && (
              <output className="message">
                <LoaderCircle className="spin" size={18} />
                <span>
                  {queuedCodex
                    ? remoteJob?.state === 'running'
                      ? busy === 'resume-read'
                        ? 'Codex 正在阅读简历。可以关闭网页，稍后从评估任务查看结果。'
                        : busy === 'written-test'
                          ? `Codex 正在生成 ${outlineVersion === 3 ? 2 : 3} 道笔试复盘补充题。可以关闭网页，稍后从任务中心查看结果。`
                          : busy === 'work-sample'
                            ? 'Codex 正在只读分析笔试作品。可以关闭网页，稍后从任务中心查看结果。'
                            : busy === 'outline'
                              ? 'Codex 正在重新生成短问题提纲，旧提纲会保留到新结果完成。'
                              : busy === 'second-round-outline'
                                ? 'Codex 正在根据初试资料生成复试提纲。可以关闭网页，稍后从任务中心查看结果。'
                                : busy === 'second-round-assessment'
                                  ? 'Codex 正在生成独立复试结论，评分仅引用本轮复试对话。'
                              : '电脑正在分析。可以关闭网页，稍后从评估任务查看结果。'
                      : remoteJob
                        ? '任务已提交，等待已配对的电脑领取。电脑离线时也会保留任务。'
                        : '正在提交评估任务…'
                    : localCodex
                      ? '本地 Codex 正在分析，可能需要几分钟。请保持工作台和本地服务开启。'
                      : '正在生成评估，请稍候。'}
                </span>
                <button
                  className="text-button"
                  disabled={cancelling || (queuedCodex && !remoteJob)}
                  onClick={() => void cancelAnalysis()}
                >
                  {cancelling
                    ? '正在取消…'
                    : queuedCodex
                      ? '取消任务'
                      : '取消分析'}
                </button>
              </output>
            )}
            <div className="workspace-grid">
              <section className="main-column">
                <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
                  <div className="work-navigation">
                    <TabsList className="work-tabs">
                      <TabsTrigger value="resume">
                        <FileText />
                        {interviewStage === 'second'
                          ? '复试准备'
                          : '候选人简历'}
                      </TabsTrigger>
                      <TabsTrigger value="transcript">
                        <FileText />
                        {interviewStage === 'second' ? '复试记录' : '面试记录'}
                        {transcript && <span className="tab-dot" />}
                      </TabsTrigger>
                      <TabsTrigger value="report">
                        <ClipboardCheck />
                        {interviewStage === 'second' ? '复试结论' : '结论评估'}
                        {confirmed && <Check size={14} />}
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="resume">
                    {interviewStage === 'second' ? (
                      <div className="panel text-panel second-round-preparation">
                        <div className="panel-heading">
                          <div>
                            <span className="eyebrow">复试准备</span>
                            <h2>根据初试资料生成复试提纲</h2>
                            <p className="section-description">
                              聚焦待验证点、证据不足和关键风险，避免重复初试问题。
                            </p>
                          </div>
                          <span className="badge">45–60 分钟</span>
                        </div>
                        <div className="panel-body second-round-preparation-body">
                          <div className="second-round-material-grid">
                            <article className="second-round-material-card">
                              <div className="second-round-material-meta">
                                <span>
                                  {priorRoundSource === 'bole-markdown'
                                    ? '伯乐 AI 初试记录'
                                    : '外部初试记录'}
                                </span>
                                <strong title={priorRoundName || '初试资料'}>
                                  {priorRoundName || '初试资料'}
                                </strong>
                                <small>
                                  {priorRoundText.length.toLocaleString()} 字符
                                </small>
                              </div>
                              <div className="second-round-material-controls">
                                <details className="second-round-material-details">
                                  <summary>查看初试资料原文</summary>
                                  <pre>{priorRoundText}</pre>
                                </details>
                                {!secondRoundOutline && (
                                  <div className="second-round-material-actions">
                                    <label
                                      className="secondary-button"
                                      title="重新导入初试资料"
                                    >
                                      <FileText size={14} />
                                      {busy === 'import'
                                        ? '正在读取…'
                                        : '重新导入'}
                                      <input
                                        type="file"
                                        accept=".md,.txt"
                                        disabled={
                                          !!busy || !!secondRoundOutlineJobId
                                        }
                                        onChange={(event) => {
                                          const file = event.target.files?.[0];
                                          event.target.value = '';
                                          if (file)
                                            void replaceSecondRoundPrior(file);
                                        }}
                                      />
                                    </label>
                                  </div>
                                )}
                              </div>
                            </article>
                            <article className="second-round-material-card">
                              <div className="second-round-material-meta">
                                <span>候选人简历</span>
                                <strong
                                  title={resumeName || '已从初试记录提取'}
                                >
                                  {resumeName || '已从初试记录提取'}
                                </strong>
                                <small>
                                  已提取 {resumeText.length.toLocaleString()}{' '}
                                  字符
                                </small>
                              </div>
                              <div className="second-round-material-controls">
                                <details className="second-round-material-details">
                                  <summary>查看候选人简历正文</summary>
                                  <pre>{resumeText}</pre>
                                </details>
                                {!secondRoundOutline && (
                                  <div className="second-round-material-actions">
                                    <label
                                      className="secondary-button"
                                      title="重新上传候选人简历"
                                    >
                                      <Upload size={14} />
                                      {busy === 'import'
                                        ? '正在提取…'
                                        : '重新上传'}
                                      <input
                                        type="file"
                                        accept=".doc,.docx,.pdf"
                                        disabled={
                                          !!busy || !!secondRoundOutlineJobId
                                        }
                                        onChange={(event) => {
                                          const file = event.target.files?.[0];
                                          event.target.value = '';
                                          if (file)
                                            void replaceSecondRoundResume(file);
                                        }}
                                      />
                                    </label>
                                  </div>
                                )}
                              </div>
                            </article>
                          </div>
                          <section
                            className="second-round-review-points"
                            aria-label="初试待核实与考察重点"
                          >
                            <div className="second-round-review-points-heading">
                              <strong>初试待核实与考察重点</strong>
                              {priorRoundReviewPoints.source !== 'none' && (
                                <span>
                                  {priorRoundReviewPoints.source === 'document'
                                    ? '初试明确记录'
                                    : 'Codex 整理'}
                                </span>
                              )}
                            </div>
                            {priorRoundReviewPoints.pending.length > 0 && (
                              <div className="second-round-review-point-group">
                                <h3>待核实事项</h3>
                                <ul>
                                  {priorRoundReviewPoints.pending.map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {priorRoundReviewPoints.focus.length > 0 && (
                              <div className="second-round-review-point-group">
                                <h3>重点考察事项</h3>
                                <ul>
                                  {priorRoundReviewPoints.focus.map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {priorRoundReviewPoints.source === 'none' && (
                              <p>
                                初试资料未明确列出，生成提纲后可查看整理结果。
                              </p>
                            )}
                          </section>
                          {!secondRoundOutline ? (
                            <div className="second-round-preparation-actions">
                              <span>
                                生成成功后，初试资料、简历和岗位标准将锁定。
                              </span>
                              <button
                                className="primary-button"
                                disabled={
                                  !!busy || !queuedCodex || !services?.analysis
                                }
                                onClick={() => void runSecondRoundOutline()}
                              >
                                {busy === 'second-round-outline' ? (
                                  <LoaderCircle className="spin" size={16} />
                                ) : (
                                  <ClipboardCheck size={16} />
                                )}{' '}
                                {busy === 'second-round-outline'
                                  ? '正在生成…'
                                  : '确认并生成复试提纲'}
                              </button>
                            </div>
                          ) : (
                            <>
                              <SecondRoundOutlineView
                                value={secondRoundOutline}
                              />
                              <div className="action-footer">
                                <button
                                  className="secondary-button"
                                  onClick={() => setTab('transcript')}
                                >
                                  下一步：导入复试记录 <ArrowRight size={16} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                    <div className="panel text-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>候选人简历</h2>
                          <p className="section-description">
                            上传 Word 或文字版 PDF
                            后自动整理要点；也可粘贴正文后阅读。
                          </p>
                        </div>
                        <span className="count">
                          {resumeText.length.toLocaleString()} / 30,000 字
                        </span>
                      </div>
                      <div className="panel-body">
                        <label
                          className="transcript-upload"
                          htmlFor="resume-file"
                        >
                          <Upload size={24} />
                          <strong>
                            {outlineLocked
                              ? '简历与提纲已锁定'
                              : busy === 'import'
                                ? '正在提取文件文字…'
                                : '上传候选人简历'}
                          </strong>
                          <span>
                            Word（.doc / .docx）或文字版 PDF · 最大 5 MB · PDF
                            最多 30 页
                          </span>
                          <input
                            id="resume-file"
                            type="file"
                            accept=".doc,.docx,.pdf"
                            disabled={!!busy || outlineLocked}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) void resumeFile(file);
                            }}
                          />
                        </label>
                        <div className="action-footer resume-reading-action">
                          <span>
                            {queuedCodex
                              ? '将发送简历与岗位要求，由已配对电脑的 Codex 整理'
                              : '简历阅读需使用队列版工作台连接 Codex'}
                          </span>
                          <button
                            className="primary-button"
                            disabled={
                              !!busy ||
                              outlineLocked ||
                              !resumeText.trim() ||
                              !queuedCodex ||
                              !services?.analysis
                            }
                            onClick={() => {
                              if (!busyRef.current)
                                openResumeOutlinePreflight(
                                  resumeText,
                                  resumeName,
                                );
                            }}
                          >
                            {busy === 'resume-read' ? (
                              <LoaderCircle className="spin" size={16} />
                            ) : (
                              <ClipboardCheck size={16} />
                            )}{' '}
                            {busy === 'resume-read'
                              ? '正在阅读…'
                              : outlineLocked
                                ? '提纲已生成'
                                : '确认岗位并生成提纲'}
                          </button>
                        </div>
                        <p className="small-note">
                          {outlineLocked
                            ? '提纲已生成，本面试记录不能再次生成或替换简历。'
                            : '附件仅在浏览器提取文字，原文件不上传。生成前可展开编辑。'}
                        </p>
                        <details
                          className="resume-body-details"
                          open={resumeBodyOpen}
                          onToggle={(event) =>
                            setResumeBodyOpen(event.currentTarget.open)
                          }
                        >
                          <summary>
                            <span className="resume-body-title">
                              {resumeText.trim()
                                ? '简历正文 · 已提取'
                                : '简历正文 · 待补充'}
                            </span>
                            {resumeName && (
                              <span className="resume-body-name">
                                {resumeName}
                              </span>
                            )}
                            <span className="resume-body-count">
                              {resumeText.length.toLocaleString()} 字符
                            </span>
                          </summary>
                            <label
                              htmlFor="resume-text"
                              className="field-title"
                            >
                            简历正文
                          </label>
                          <textarea
                            id="resume-text"
                            rows={12}
                            maxLength={30000}
                            disabled={!!busy}
                            readOnly={outlineLocked}
                            value={resumeText}
                            onChange={(e) =>
                              editResume(e.target.value, resumeName)
                            }
                            placeholder="在这里粘贴简历文字。简历作为背景信息，项目经历与能力仍需通过面试核实。"
                          />
                        </details>
                        {resumeReading && (
                          <ResumeReadingView
                            key={library.id}
                            value={resumeReading}
                            groups={outlineSupplements}
                            busy={followUpBusy}
                            draft={followUpOutlineDraft}
                            onGenerate={runFollowUpOutline}
                            onDelete={deleteFollowUpOutline}
                            canSupplement={
                              writtenTestSupplementEligible &&
                              !followUpTaskActive
                            }
                            supplementBusy={busy === 'written-test'}
                            onSupplement={() =>
                              setPendingWrittenTestSupplement(true)
                            }
                            canSubmitWork={
                              workSampleEligible && !followUpTaskActive
                            }
                            workBusy={busy === 'work-sample'}
                            onSubmitWork={openLateWorkSample}
                            canRegenerate={outlineRegenerationEligible}
                            regenerationUsed={!!outlineRegeneratedAt}
                            regenerationBusy={busy === 'outline'}
                            onRegenerate={() =>
                              setPendingOutlineRegeneration(true)
                            }
                          />
                        )}
                        <div className="action-footer">
                          <button
                            className="secondary-button"
                            disabled={!!busy}
                            onClick={() => setTab('transcript')}
                          >
                            下一步：导入面试记录 <ArrowRight size={16} />
                          </button>
                          <button
                            className="text-button"
                            disabled={!resumeText || !!busy || outlineLocked}
                            onClick={() => {
                              editResume('');
                            }}
                          >
                            清空简历文字
                          </button>
                        </div>
                      </div>
                    </div>
                    )}
                  </TabsContent>
                  <TabsContent value="transcript">
                    <div className="panel text-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>面试记录</h2>
                          <p className="section-description">
                            {interviewStage === 'second'
                              ? '导入或粘贴本轮复试对话，再校对内容和说话人。'
                              : '直接粘贴转写文本，或导入豆包整理后的 .md、.txt 文件，再校对内容和说话人。'}
                          </p>
                        </div>
                        <span className="count">
                          {transcript.length.toLocaleString()} / 80,000 字
                        </span>
                      </div>
                      <div className="panel-body">
                        <label
                          className="transcript-upload"
                          htmlFor="transcript-file"
                        >
                          <Upload size={24} />
                          <strong>
                            {busy === 'import'
                              ? '正在读取面试记录…'
                              : transcriptName &&
                                  transcriptName !== MANUAL_TRANSCRIPT_SOURCE
                                ? '重新导入面试记录文件'
                                : '导入面试记录文件'}
                          </strong>
                          <span>
                            支持 .md、.txt · UTF-8 · 最大 1 MB / 80,000 字
                          </span>
                          <input
                            id="transcript-file"
                            type="file"
                            accept=".md,.txt"
                            disabled={!!busy || outlineTaskActive}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) void transcriptFile(file);
                            }}
                          />
                        </label>
                        {transcriptName && (
                          <p className="small-note transcript-source">
                            来源：{transcriptName} · 以下为可编辑正文
                          </p>
                        )}
                        <label htmlFor="transcript" className="field-title">
                          直接粘贴或输入面试记录
                        </label>
                        <textarea
                          id="transcript"
                          className="transcript-input"
                          disabled={!!busy || outlineTaskActive}
                          value={transcript}
                          maxLength={80000}
                          onChange={(e) => editTranscript(e.target.value)}
                          placeholder={
                            '可直接在这里粘贴完整转写文本。\n\n建议按下面的格式整理：\n面试官：请介绍一个你负责的项目。\n候选人：……\n\n不确定的内容请标注“待核实”，不要补写未说过的话。'
                          }
                        />
                        <label
                          className="review-check"
                          htmlFor="transcript-reviewed"
                        >
                          <Checkbox
                            id="transcript-reviewed"
                            checked={reviewed}
                            disabled={
                              !transcript.trim() || !!busy || outlineTaskActive
                            }
                            onCheckedChange={(v) => {
                              setReviewed(v);
                              setConfirmed(false);
                            }}
                          />
                          <span>已核对文字内容与面试官、候选人的说话归属</span>
                        </label>
                        <div className="action-footer">
                          <span>
                            {!services?.analysis
                              ? localCodex
                                ? '请先登录本地 Codex'
                                : 'AI 分析服务尚未配置'
                              : queuedCodex
                                ? '材料经工作台发送到已配对电脑，由 Codex 联网分析'
                                : localCodex
                                  ? '使用当前 Codex 登录，材料将发送至 OpenAI 分析'
                                  : '生成评估时，将发送简历、面试偏好与校对后的文字'}
                          </span>
                          <button
                            className="primary-button"
                            disabled={
                              !!busy || !services?.analysis || !reviewed
                            }
                            onClick={() => void analyze()}
                          >
                            {busy === 'analyze' ? (
                              <LoaderCircle className="spin" size={16} />
                            ) : (
                              <ClipboardCheck size={16} />
                            )}{' '}
                            {busy === 'analyze'
                              ? queuedCodex && remoteJob?.state === 'queued'
                                ? '等待电脑…'
                                : '正在分析…'
                              : busy === 'second-round-assessment'
                                ? '正在分析…'
                                : interviewStage === 'second'
                                  ? '生成独立复试评估'
                              : '生成辅助评估'}
                          </button>
                        </div>
                        <button
                          className="text-button"
                          disabled={!transcript.trim() || !!busy}
                          onClick={() => setTab('report')}
                        >
                          先填写面试官结论 <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="report">
                    <div className="panel report-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            {interviewStage === 'second'
                              ? '独立复试结论'
                              : '结论评估'}
                          </h2>
                          <p className="section-description">
                            {interviewStage === 'second'
                              ? '评分与证据仅来自本轮复试对话，不继承初试分数。'
                              : '把观察和证据，整理成清晰的判断。'}
                          </p>
                        </div>
                        <span className="badge">
                          {confirmed ? '已人工确认' : '待人工确认'}
                        </span>
                      </div>
                      {report ? (
                        <div className="panel-body">
                          <div className="report-summary">
                            <span className="eyebrow">
                              AI 辅助评估 · 请核实
                            </span>
                            <p>{report.summary}</p>
                          </div>
                          <p className="small-note">
                            评分参考：1 明确不符合 · 2 部分达到 · 3 基本达到 · 4
                            充分达到 · 5 显著超出
                          </p>
                          {report.workSampleReview?.length ? (
                            <section className="work-sample-verification">
                              <div className="work-sample-verification-heading">
                                <div>
                                  <span className="eyebrow">笔试作品核对</span>
                                  <h3>作品表现（归属与过程待核实）</h3>
                                </div>
                                <span className="badge">不计入对话评分</span>
                              </div>
                              {report.workSampleReview.map((item, index) => (
                                <article key={`${item.status}-${index}`}>
                                  <span
                                    className={`work-verification-status ${item.status}`}
                                  >
                                    {workSampleVerificationLabels[item.status]}
                                  </span>
                                  <p>{item.observation}</p>
                                  {item.transcriptEvidence.map(
                                    (quote, quoteIndex) => (
                                      <blockquote key={quoteIndex}>
                                        <span>对话依据</span>
                                        {quote}
                                      </blockquote>
                                    ),
                                  )}
                                </article>
                              ))}
                            </section>
                          ) : null}
                          {groupAssessmentDimensions(
                            role,
                            report.dimensions,
                          ).map((group, groupIndex) => (
                            <section
                              className="assessment-group"
                              key={group.title || `dimensions-${groupIndex}`}
                            >
                              {group.title && (
                                <div className="assessment-group-heading">
                                  <span>能力分组</span>
                                  <h3>{group.title}</h3>
                                </div>
                              )}
                              {group.dimensions.map((d) => (
                                <article className="assessment" key={d.name}>
                                  <div className="assessment-heading">
                                    <h3>{d.name}</h3>
                                    <span
                                      className={
                                        d.score === null ? 'unscored' : 'score'
                                      }
                                    >
                                      {d.score === null
                                        ? '证据不足'
                                        : `${d.score} / 5`}
                                    </span>
                                  </div>
                                  <p>{d.assessment}</p>
                                  {d.evidence.map((quote, i) => (
                                    <blockquote key={i}>
                                      <span>对话依据</span>
                                      {quote}
                                    </blockquote>
                                  ))}
                                </article>
                              ))}
                            </section>
                          ))}
                          {interviewStage === 'second' && (
                            <SecondRoundComparisonView
                              value={priorRoundComparison}
                            />
                          )}
                          {report.followUps.length > 0 && (
                            <div className="follow-ups">
                              <h3>值得进一步核实</h3>
                              <ul>
                                {report.followUps.map((q, i) => (
                                  <li key={i}>{q}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="report-empty">
                          <ClipboardCheck size={30} />
                          <h3>还没有 AI 辅助评估</h3>
                          <p>
                            {services?.analysis
                              ? '完成对话校对后，即可按岗位标准生成评估。'
                              : '模型服务尚未配置。你可以先根据对话填写人工结论。'}
                          </p>
                          <button
                            className="text-button"
                            onClick={() => setTab('transcript')}
                          >
                            前往面试记录 <ArrowRight size={15} />
                          </button>
                        </div>
                      )}
                      <div className="human-review">
                        <label htmlFor="conclusion">
                          面试官结论 <span>由你作出最终判断</span>
                        </label>
                        <textarea
                          id="conclusion"
                          rows={5}
                          maxLength={10000}
                          value={conclusion}
                          disabled={!!busy}
                          onChange={(e) => {
                            setConclusion(e.target.value);
                            setConfirmed(false);
                          }}
                          placeholder="结合岗位要求，写下已证实的能力、尚存疑问和下一步建议。"
                        />
                        <div className="button-row">
                          <button
                            className="primary-button"
                            disabled={confirmed || !!busy || !conclusion.trim()}
                            onClick={confirmConclusion}
                          >
                            <Check size={16} />
                            {confirmed ? '已确认结论' : '确认面试结论'}
                          </button>
                          <button
                            className="secondary-button"
                            disabled={!hasContent || !!busy}
                            onClick={exportRecord}
                          >
                            <Download size={16} />
                            导出记录
                          </button>
                        </div>
                        <p className="small-note">
                          确认与草稿都可导出为
                          Markdown；修改面试资料后，需要重新确认。
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </section>
            </div>
            <footer className="page-footer">
              <span>伯乐 AI · 让面试判断有据可依</span>
              <button
                className="text-button"
                disabled={!hasContent || !!busy}
                onClick={exportRecord}
              >
                <Download size={13} />
                导出当前记录
              </button>
            </footer>
          </main>
          <Dialog
            open={preparationOpen}
            onOpenChange={(open) => {
              setPreparationOpen(open);
              if (!open) setStandardsOpen(false);
            }}
          >
            <DialogContent
              className="preparation-dialog"
              showCloseButton={false}
            >
              <div className="dialog-heading">
                <DialogTitle>面试设置</DialogTitle>
                <button
                  className="icon-button"
                  aria-label="关闭面试设置"
                  onClick={() => {
                    setPreparationOpen(false);
                    setStandardsOpen(false);
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              <DialogDescription>
                设置候选人、岗位模板和本场面试标准。
              </DialogDescription>
              <InterviewPreparation {...preparationProps} />
            </DialogContent>
          </Dialog>
          <LocalLibrary
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            library={library}
            onError={setError}
            download={download}
            assertIdle={() => {
              if (busyRef.current)
                throw new Error('请等待当前操作结束后管理本地记录');
            }}
          />
          {preferencesOpen && (
            <GlobalPreferences
              initialSettings={library.globalSettings}
              initialTemplates={library.preferences}
              onSave={library.saveGlobalPreferences}
              onClose={() => setPreferencesOpen(false)}
            />
          )}
          <Dialog open={settings} onOpenChange={setSettings}>
            <DialogContent className="settings-dialog" showCloseButton={false}>
              <div className="dialog-heading">
                <DialogTitle>模型服务</DialogTitle>
                <button
                  className="icon-button"
                  aria-label="关闭服务配置"
                  onClick={() => setSettings(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <DialogDescription>
                {queuedCodex
                  ? '网页提交任务，已配对电脑上的 Codex 领取并完成分析。通过顶部“电脑连接”管理配对。'
                  : localCodex
                    ? '使用本机 Codex 的 ChatGPT 登录生成面试评估，无需单独填写 API 密钥。'
                    : '粘贴简历和导入面试记录可直接使用，生成 AI 辅助评估需要配置分析服务。'}
              </DialogDescription>
              <div className="service-row">
                <span>
                  {queuedCodex
                    ? '已配对电脑上的 Codex'
                    : localCodex
                      ? '本地 Codex'
                      : 'AI 辅助评估'}
                </span>
                <span className="badge">
                  {services?.analysis
                    ? queuedCodex
                      ? services.connected
                        ? '已连接'
                        : '等待电脑'
                      : localCodex
                        ? '已连接'
                        : '已配置'
                    : localCodex
                      ? '需检查登录'
                      : '未配置'}
                </span>
              </div>
              {queuedCodex ? (
                <>
                  <p>{services?.message}</p>
                  <p className="small-note">
                    简历、偏好与面试文字会提交到工作台服务器，由配对电脑发送给
                    OpenAI，使用该电脑的 Codex
                    账号额度。登录凭据留在电脑；结果可从评估任务找回，仍需人工核实。
                  </p>
                </>
              ) : localCodex ? (
                <>
                  <p>{services?.message}</p>
                  <p className="small-note">
                    点击生成后，面试材料会通过 Codex 发送给
                    OpenAI，并使用当前账号的额度。网页和连接服务在本机运行，模型分析需要联网。报告仍需人工核实。
                  </p>
                </>
              ) : (
                <>
                  <p>请在服务端配置分析 API 地址、模型和密钥。</p>
                  <p className="small-note">
                    本地 Codex 方式请使用 npm start 启动工作台；兼容 API
                    方式需单独配置。
                  </p>
                </>
              )}
              {statusError && <p role="alert">无法获取状态，请稍后重试。</p>}
              <button
                className="secondary-button"
                onClick={() => void refreshServices()}
              >
                重新检查配置
              </button>
            </DialogContent>
          </Dialog>
          <AlertDialog
            open={pendingOutlineRegeneration}
            onOpenChange={setPendingOutlineRegeneration}
          >
            <AlertDialogContent className="outline-regeneration-dialog">
              <AlertDialogTitle>重新生成面试提纲</AlertDialogTitle>
              <AlertDialogDescription>
                使用已保存的简历文字重新生成一次短问题提纲。旧提纲会保留到新结果完整生成。
              </AlertDialogDescription>
              <dl className="outline-regeneration-summary">
                <div>
                  <dt>候选人</dt>
                  <dd>{candidate || '未填写'}</dd>
                </div>
                <div>
                  <dt>岗位</dt>
                  <dd>{role}</dd>
                </div>
                <div>
                  <dt>笔试情况</dt>
                  <dd>
                    {supportsWrittenTest(sourceTemplateId)
                      ? effectiveHasWrittenTest
                        ? '有笔试'
                        : '无笔试'
                      : '不适用'}
                  </dd>
                </div>
                <div>
                  <dt>作品情况</dt>
                  <dd>{workSample ? '已分析' : '无作品分析'}</dd>
                </div>
              </dl>
              <p className="small-note">
                成功后将替换整套问题并使用本记录唯一一次重新生成机会；失败、暂停或停止不会消耗机会。
              </p>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void runOutlineRegeneration()}
                >
                  确认并重新生成
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={pendingWrittenTestSupplement}
            onOpenChange={setPendingWrittenTestSupplement}
          >
            <AlertDialogContent className="written-test-supplement-dialog">
              <AlertDialogTitle>补充笔试复盘题</AlertDialogTitle>
              <AlertDialogDescription>
                {outlineVersion === 3
                  ? 'Codex 将生成 2 道笔试复盘候选题，替换当前候选区并归档此前候选题。6 道必问题保持不变；成功后笔试情况会同步为“有笔试”，且不能再次生成。'
                  : outlineVersion === 2
                    ? 'Codex 将生成 3 道笔试复盘候选题，替换当前候选区并归档此前候选题。5 道必问题保持不变；成功后笔试情况会同步为“有笔试”，且不能再次生成。'
                    : 'Codex 将额外生成 3 道笔试复盘题，追加在原有 6 道提纲下方，不修改原提纲。成功后笔试情况会同步为“有笔试”，且不能再次生成。'}
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void runWrittenTestSupplement()}
                >
                  确认并生成 {outlineVersion === 3 ? 2 : 3} 道题
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={lateWorkSampleOpen}
            onOpenChange={(open) => {
              setLateWorkSampleOpen(open);
              if (!open) setLateWorkSampleArtifact(null);
            }}
          >
            <AlertDialogContent className="work-sample-confirmation-dialog">
              <AlertDialogTitle>补交笔试作品</AlertDialogTitle>
              <AlertDialogDescription>
                {outlineVersion === 3
                  ? '选择保存在已配对电脑 works/ 目录中的 ZIP。Codex 将从产品经理视角只读分析；生成的 2 道作品复盘候选题会替换当前候选区并归档此前候选题，6 道必问题保持不变。成功后不能再次分析作品。'
                  : outlineVersion === 2
                    ? '选择保存在已配对电脑 works/ 目录中的 ZIP。Codex 将从产品经理视角只读分析；生成的 3 道作品复盘候选题会替换当前候选区并归档此前候选题，5 道必问题保持不变。成功后不能再次分析作品。'
                    : '选择保存在已配对电脑 works/ 目录中的 ZIP。Codex 将从产品经理视角只读分析；原提纲保留，追加三题，成功后不能再次分析作品。'}
              </AlertDialogDescription>
              <WorkSamplePicker
                artifacts={workSampleArtifacts}
                selected={lateWorkSampleArtifact?.id || null}
                loading={workSampleLoading}
                error={workSampleError}
                onRefresh={() => void refreshWorkSampleArtifacts()}
                onSelect={setLateWorkSampleArtifact}
              />
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  disabled={!lateWorkSampleArtifact?.available}
                  onClick={() => void runLateWorkSample()}
                >
                  确认并分析作品
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={!!pendingResumeOutline}
            onOpenChange={(open) => {
              if (!open) setPendingResumeOutline(null);
            }}
          >
            <AlertDialogContent className="resume-outline-confirmation-dialog">
              <AlertDialogTitle>确认提纲生成条件</AlertDialogTitle>
              <AlertDialogDescription>
                先确认本场岗位；AI
                产品经理还需确认笔试情况。确认的完整岗位模板会同步到面试准备，再交给
                Codex 生成提纲。
              </AlertDialogDescription>
              <div className="resume-outline-confirmation-form">
                <label htmlFor="resume-outline-role-select">
                  确认岗位
                  <NativeSelect
                    id="resume-outline-role-select"
                    className="workbench-native-select resume-outline-role-select"
                    value={pendingResumeOutline?.templateId || ''}
                    onChange={(event) =>
                      setPendingResumeOutline((current) =>
                        current
                          ? {
                              ...current,
                              templateId: event.target.value,
                              writtenTest:
                                event.target.value ===
                                  BUILTIN_TEMPLATE_IDS.aiProductManager &&
                                current.templateId === event.target.value
                                  ? current.writtenTest
                                  : null,
                              artifact: null,
                            }
                          : null,
                      )
                    }
                  >
                    <option value="">请选择岗位</option>
                    {builtInRoleTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                {pendingResumeOutline?.templateId ===
                  BUILTIN_TEMPLATE_IDS.aiProductManager && (
                  <fieldset>
                    <legend>笔试情况</legend>
                    <label className="resume-outline-written-test-option">
                      <input
                        type="radio"
                        name="resume-outline-written-test"
                        checked={pendingResumeOutline.writtenTest === true}
                        onChange={() =>
                          setPendingResumeOutline((current) =>
                            current ? { ...current, writtenTest: true } : null,
                          )
                        }
                      />
                      有笔试
                    </label>
                    <label className="resume-outline-written-test-option">
                      <input
                        type="radio"
                        name="resume-outline-written-test"
                        checked={pendingResumeOutline.writtenTest === false}
                        onChange={() =>
                          setPendingResumeOutline((current) =>
                            current
                              ? {
                                  ...current,
                                  writtenTest: false,
                                  artifact: null,
                                }
                              : null,
                          )
                        }
                      />
                      无笔试
                    </label>
                  </fieldset>
                )}
                {pendingResumeOutline?.templateId ===
                  BUILTIN_TEMPLATE_IDS.aiProductManager &&
                  pendingResumeOutline.writtenTest === true && (
                    <WorkSamplePicker
                      artifacts={workSampleArtifacts}
                      selected={pendingResumeOutline.artifact?.id || null}
                      loading={workSampleLoading}
                      error={workSampleError}
                      onRefresh={() => void refreshWorkSampleArtifacts()}
                      onSelect={(artifact) =>
                        setPendingResumeOutline((current) =>
                          current ? { ...current, artifact } : null,
                        )
                      }
                    />
                  )}
                <p>提纲成功生成后，本面试记录不能再次生成或替换简历。</p>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  disabled={
                    !pendingResumeOutline ||
                    !resolveResumeOutlinePreflight(
                      pendingResumeOutline.templateId,
                      pendingResumeOutline.writtenTest,
                    )
                  }
                  onClick={confirmResumeOutlineGeneration}
                >
                  确认并生成提纲
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={!!pendingCandidateName}
            onOpenChange={(open) => {
              if (!open) setPendingCandidateName(null);
            }}
          >
            <AlertDialogContent initialFocus={candidateKeepButton}>
              <AlertDialogTitle>简历姓名与当前候选人不同</AlertDialogTitle>
              <AlertDialogDescription>
                默认保留当前姓名。请选择是否使用简历中识别的姓名；选择不会重新生成提纲。
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel ref={candidateKeepButton}>
                  保留当前姓名：{pendingCandidateName?.current}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (pendingCandidateName)
                      applyDetectedCandidate(pendingCandidateName.detected);
                    setPendingCandidateName(null);
                  }}
                >
                  使用简历姓名：{pendingCandidateName?.detected}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={!!pendingResume}
            onOpenChange={(open) => {
              if (!open) setPendingResume(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogTitle>替换当前简历？</AlertDialogTitle>
              <AlertDialogDescription>
                将使用 {pendingResume?.name}{' '}
                的文字替换现有简历，并清除旧的辅助评估与人工确认。替换后需要确认岗位，再生成唯一一次提纲。面试对话和人工意见保留。
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>取消，保留原文</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (!pendingResume || busyRef.current) return;
                    if (pendingResume.autoRead)
                      void applyImportedResume(
                        pendingResume.text,
                        pendingResume.name,
                      );
                  }}
                >
                  替换并确认岗位
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={!!pendingImport}
            onOpenChange={(open) => {
              if (!open) setPendingImport(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogTitle>替换当前面试记录？</AlertDialogTitle>
              <AlertDialogDescription>
                将使用 {pendingImport?.name} 替换当前正文，并清除旧 AI
                评估和校对确认。人工意见会保留，需重新核对。如需保留原文，请先取消并导出当前记录。
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>取消，保留原文</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (pendingImport)
                      applyTranscript(pendingImport.text, pendingImport.name);
                  }}
                >
                  替换并重新校对
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
            <AlertDialogContent>
              <AlertDialogTitle>新建面试</AlertDialogTitle>
              <AlertDialogDescription>
                当前面试会自动保存。请选择本次面试阶段；复试将先导入初试资料和候选人简历。
              </AlertDialogDescription>
              <AlertDialogFooter className="new-interview-actions">
                <AlertDialogCancel>取消</AlertDialogCancel>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setResetOpen(false);
                    setSecondRoundCreateOpen(true);
                  }}
                >
                  新建复试
                </button>
                <AlertDialogAction
                  onClick={() => void localAction(createInterview)}
                >
                  新建初试
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <SecondRoundCreateDialog
            open={secondRoundCreateOpen}
            templates={library.preferences}
            defaultTemplateId={
              library.globalSettings.defaultTemplateId ||
              BUILTIN_TEMPLATE_IDS.aiProductManager
            }
            onOpenChange={setSecondRoundCreateOpen}
            onCreate={(seed) =>
              localAction(() => createSecondRoundInterview(seed))
            }
          />
          {handoffStage && (
            <InterviewHandoffDialog
              open={handoffOpen}
              onOpenChange={setHandoffOpen}
              sourceId={library.id}
              candidate={candidate}
              stage={handoffStage}
              onPrepare={async () => {
                const binding = await library.flushForTask();
                if (!binding)
                  throw new Error('面试记录尚未同步到云端，请稍后重试。');
                return { sourceRevision: binding.interviewRevision };
              }}
              onSuccess={(handoff) => {
                setHandoffTarget(handoff.targetUsername);
                setNotice(
                  `${handoff.stage === 'second' ? '复试' : '初试'}已派发给 ${handoff.targetUsername}。`,
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
