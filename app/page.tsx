'use client';
import { importResume } from '@/lib/import-resume';
import {
  applyCandidateNameChange,
  reconcileCandidateName,
} from '@/lib/resume-workflow';
import { ResumeReadingView } from '@/components/interview/resume-reading-view';
import {
  validateResumeInput,
  exportResumeReading,
  type ResumeReading,
} from '@/lib/resume-reading';
import { submitRemoteResume } from '@/lib/remote-analysis';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileText,
  ClipboardCheck,
  ShieldCheck,
  Download,
  Plus,
  Settings2,
  ArrowRight,
  LoaderCircle,
  Check,
  CircleAlert,
  X,
  Upload,
  FolderOpen,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
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
import { validateInput, exportMarkdown, type Report } from '@/lib/interview';
import { useInterviewLibrary } from '@/hooks/use-interview-library';
import type { NewInterviewSeed } from '@/lib/local/store';
import {
  COMMON_TEMPLATE_ID,
  appliedTemplateState,
  inferTemplateSource,
  resolveTemplateSelection,
  supportsWrittenTest,
} from '@/lib/interview-template-state';
import { LocalLibrary } from '@/components/interview/local-library';
import { GlobalPreferences } from '@/components/interview/global-preferences';
import { InterviewPreparation } from '@/components/interview/interview-preparation';
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

const defaultDimensions = defaultStandards.dimensionText;
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Home() {
  const [tab, setTab] = useState('resume');
  const [candidate, setCandidate] = useState('');
  const [role, setRole] = useState('');
  const [requirements, setRequirements] = useState('');
  const [dimensionText, setDimensionText] = useState(defaultDimensions);
  const [focus, setFocus] = useState('');
  const [scoringGuidance, setScoringGuidance] = useState('');
  const [reportRequirements, setReportRequirements] = useState('');
  const [sourceTemplateId, setSourceTemplateId] = useState<
    string | null | undefined
  >(undefined);
  const [templateModified, setTemplateModified] = useState(false);
  const [hasWrittenTest, setHasWrittenTest] = useState(false);
  const [resumeText, setResumeText] = useState('');
  const [resumeName, setResumeName] = useState('');
  const [resumeReading, setResumeReading] = useState<ResumeReading | null>(
    null,
  );
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
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
  const [busy, setBusy] = useState<
    'import' | 'analyze' | 'resume-read' | 'prepare' | null
  >(null);
  const busyRef = useRef(false);
  const analysisController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      analysisController.current?.abort();
      analysisController.current = null;
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
  };
  const standards: InterviewStandards = {
    role,
    requirements,
    dimensionText,
    focus,
    scoringGuidance,
    reportRequirements,
  };
  const library = useInterviewLibrary(
    {
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
      hasWrittenTest,
    },
    async (saved) => {
      analysisController.current?.abort();
      analysisController.current = null;
      setPendingCandidateName(null);
      setPendingResume(null);
      setCandidate(saved.candidate);
      setRole(saved.role);
      setRequirements(saved.requirements);
      setDimensionText(saved.dimensionText);
      setFocus(saved.focus || '');
      setScoringGuidance(saved.scoringGuidance || '');
      setReportRequirements(saved.reportRequirements || '');
      setSourceTemplateId(saved.sourceTemplateId);
      setTemplateModified(saved.templateModified ?? false);
      setHasWrittenTest(saved.hasWrittenTest ?? false);
      setResumeText(saved.resumeText || '');
      setResumeName(saved.resumeName || '');
      setResumeReading(saved.resumeReading || null);
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
    },
    reset,
  );
  useEffect(() => {
    if (!library.ready || sourceTemplateId !== undefined) return;
    const inferred = inferTemplateSource(
      standards,
      library.preferences,
      library.globalSettings.defaults,
    );
    setSourceTemplateId(inferred.sourceTemplateId);
    setTemplateModified(inferred.templateModified);
    if (!supportsWrittenTest(inferred.sourceTemplateId))
      setHasWrittenTest(false);
  }, [
    library.ready,
    library.preferences,
    library.globalSettings.defaults,
    sourceTemplateId,
    standards,
  ]);
  useEffect(() => {
    if (
      sourceTemplateId !== undefined &&
      !supportsWrittenTest(sourceTemplateId) &&
      hasWrittenTest
    )
      setHasWrittenTest(false);
  }, [sourceTemplateId, hasWrittenTest]);
  async function localAction(action: () => Promise<void>) {
    if (busyRef.current) return;
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
    editTranscript(text);
    setTranscriptName(name);
    setTab('transcript');
    setPendingImport(null);
    setNotice('面试记录已导入，请校对文字与说话人归属后再生成评估。');
  }
  async function transcriptFile(file: File) {
    if (busyRef.current) return;
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
    analysisController.current?.abort();
    analysisController.current = null;
    invalidate();
    setResumeText(text);
    setResumeName(name);
    setResumeReading(null);
    setPendingCandidateName(null);
    setResumeBodyOpen(true);
  }
  async function applyImportedResume(text: string, name: string) {
    editResume(text, name);
    setPendingResume(null);
    setResumeBodyOpen(false);
    await runResumeReading(text, name);
  }
  async function resumeFile(file: File) {
    if (busyRef.current) return;
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
      if (analysisController.current === controller) {
        analysisController.current = null;
        busyRef.current = false;
        setBusy(null);
      }
    }
  }
  async function runResumeReading(resumeText: string, resumeName: string) {
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    busyRef.current = true;
    setBusy('resume-read');
    setError('');
    setNotice('');
    setResumeReading(null);
    setPendingCandidateName(null);
    setRemoteJob(null);
    setCancelling(false);
    cancelledRemotely.current = false;
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
      });
      if (!context.queuedCodex)
        throw new Error('请使用当前队列版工作台连接 Codex 后阅读简历。');
      const valueRead = await submitRemoteResume(
        value,
        (context.candidate || resumeName || '未命名候选人').slice(0, 100),
        controller.signal,
        (job) => {
          if (
            analysisController.current === controller &&
            !controller.signal.aborted
          )
            setRemoteJob({ ...job, report: null });
        },
      );
      if (analysisController.current !== controller) return;
      controller.signal.throwIfAborted();
      setResumeReading(valueRead);
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
      if (analysisController.current === controller) {
        analysisController.current = null;
        busyRef.current = false;
        setBusy(null);
      }
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
    invalidate();
    setTranscript(text);
    setReviewed(false);
  }
  async function analyze() {
    if (busyRef.current) return;
    setError('');
    try {
      validateInput(input);
      if (!reviewed)
        throw new Error('请先校对对话内容和说话人归属，并勾选确认。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '请补全面试资料');
      return;
    }
    busyRef.current = true;
    setBusy('analyze');
    const controller = new AbortController();
    analysisController.current = controller;
    setRemoteJob(null);
    setCancelling(false);
    cancelledRemotely.current = false;
    try {
      let data: Report;
      if (queuedCodex) {
        data = await submitRemoteAnalysis(
          input,
          `${candidate || '未命名面试'} · ${role}`.slice(0, 100),
          controller.signal,
          setRemoteJob,
        );
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
      controller.signal.throwIfAborted();
      setReport(data);
      setConfirmed(false);
      setTab('report');
      setNotice('辅助评估已生成，请核实引用与判断后填写最终意见。');
    } catch (e) {
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
      analysisController.current = null;
      busyRef.current = false;
      setBusy(null);
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
    setResumeReading(null);
    setRole(value.role);
    setRequirements(value.requirements);
    setDimensionText(value.dimensionText);
    setFocus(value.focus);
    setScoringGuidance(value.scoringGuidance);
    setReportRequirements(value.reportRequirements);
  }
  function applyStandards(value: InterviewStandards) {
    invalidate();
    setStandards(value);
    setTemplateModified(true);
  }
  function reset(seed: NewInterviewSeed) {
    analysisController.current?.abort();
    analysisController.current = null;
    setStandards(seed.standards);
    setSourceTemplateId(seed.sourceTemplateId);
    setTemplateModified(false);
    setHasWrittenTest(false);
    setCandidate('');
    setResumeText('');
    setResumeName('');
    setResumeReading(null);
    setResumeBodyOpen(false);
    setPendingCandidateName(null);
    setPendingResume(null);
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
    download(
      new Blob(
        [
          exportMarkdown(candidate, input, report, conclusion, confirmed) +
            (resumeReading ? '\n\n' + exportResumeReading(resumeReading) : ''),
        ],
        { type: 'text/markdown;charset=utf-8' },
      ),
      `${safeName}-面试记录.md`,
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
    standardsOpen,
    templateSelection,
    hasWrittenTest,
    writtenTestSupported: supportsWrittenTest(sourceTemplateId),
    onStandardsOpenChange: setStandardsOpen,
    onCandidateChange: (value: string) => {
      invalidate();
      setCandidate(value);
    },
    onStandardsChange: applyStandards,
    onWrittenTestChange: (checked: boolean) => {
      invalidate();
      setResumeReading(null);
      setHasWrittenTest(checked);
    },
    onApplyTemplate: (id: string) => {
      const selected =
        id === COMMON_TEMPLATE_ID
          ? library.globalSettings.defaults
          : library.preferences.find((preference) => preference.id === id);
      if (selected) {
        invalidate();
        setStandards(normalizeStandards(selected));
        const next = appliedTemplateState(id, hasWrittenTest);
        setSourceTemplateId(next.sourceTemplateId);
        setTemplateModified(next.templateModified);
        setHasWrittenTest(next.hasWrittenTest);
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
  return (
    <div className="workbench">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <ClipboardCheck size={23} />
          </span>
          <b>
            面谈<span>INTERVIEW NOTES</span>
          </b>
        </div>
        <span className="workspace-label">面试工作台</span>
        <span className="privacy-label">
          <ShieldCheck size={16} /> 当前设备 · 本地保存
        </span>
        <button
          className="global-settings-entry text-button"
          disabled={!library.ready || library.working || !!busy}
          onClick={() =>
            void localAction(async () => {
              await library.refresh();
              setPreferencesOpen(true);
            })
          }
          aria-label="打开全局面试设置"
        >
          <Settings2 size={19} /> 全局设置
        </button>
      </header>
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
      <main
        className="workspace"
        inert={!library.ready || library.working || busy === 'prepare'}
      >
        <div className="page-heading">
          <h1>{candidate ? `${candidate}的面试记录` : '当前面试'}</h1>
          <button
            className="secondary-button"
            disabled={!!busy}
            onClick={() => {
              if (hasContent) setResetOpen(true);
              else void localAction(library.create);
            }}
          >
            <Plus size={16} />
            新的面试
          </button>
        </div>
        <div className="local-toolbar">
          <span className="local-save-status">
            {library.unsaved ? '正在保存到本地…' : '已保存在当前浏览器'}
          </span>
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() =>
              void localAction(async () => {
                await library.refresh();
                setHistoryOpen(true);
              })
            }
          >
            <FolderOpen size={15} />
            本地面试记录
          </button>
        </div>
        {error && (
          <div role="alert" className="message error">
            <CircleAlert size={18} />
            <span>{error}</span>
            {error && (
              <button aria-label="关闭错误提示" onClick={() => setError('')}>
                <X size={16} />
              </button>
            )}
          </div>
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
        {(busy === 'analyze' || busy === 'resume-read') && (
          <output className="message">
            <LoaderCircle className="spin" size={18} />
            <span>
              {queuedCodex
                ? remoteJob?.state === 'running'
                  ? busy === 'resume-read'
                    ? 'Codex 正在阅读简历。可以关闭网页，稍后从评估任务查看结果。'
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
              {cancelling ? '正在取消…' : queuedCodex ? '取消任务' : '取消分析'}
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
                    候选人简历
                  </TabsTrigger>
                  <TabsTrigger value="transcript">
                    <FileText />
                    面试记录{transcript && <span className="tab-dot" />}
                  </TabsTrigger>
                  <TabsTrigger value="report">
                    <ClipboardCheck />
                    结论评估{confirmed && <Check size={14} />}
                  </TabsTrigger>
                </TabsList>
                <button
                  className="secondary-button preparation-toggle"
                  onClick={() => setPreparationOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={preparationOpen}
                >
                  <Settings2 size={16} /> 面试准备
                </button>
              </div>
              <TabsContent value="resume">
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
                    <label className="transcript-upload" htmlFor="resume-file">
                      <Upload size={24} />
                      <strong>
                        {busy === 'import'
                          ? '正在提取文件文字…'
                          : '上传候选人简历'}
                      </strong>
                      <span>
                        Word（.doc / .docx）或文字版 PDF · 最大 5 MB · PDF 最多
                        30 页
                      </span>
                      <input
                        id="resume-file"
                        type="file"
                        accept=".doc,.docx,.pdf"
                        disabled={!!busy}
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
                          !resumeText.trim() ||
                          !queuedCodex ||
                          !services?.analysis
                        }
                        onClick={() => {
                          if (!busyRef.current)
                            void runResumeReading(resumeText, resumeName);
                        }}
                      >
                        {busy === 'resume-read' ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <ClipboardCheck size={16} />
                        )}{' '}
                        {busy === 'resume-read'
                          ? '正在阅读…'
                          : resumeReading
                            ? '重新阅读简历'
                            : '用 Codex 阅读简历'}
                      </button>
                    </div>
                    <p className="small-note">
                      附件仅在浏览器提取文字，原文件不上传。展开后编辑会清除旧的阅读和评估结果。
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
                          <span className="resume-body-name">{resumeName}</span>
                        )}
                        <span className="resume-body-count">
                          {resumeText.length.toLocaleString()} 字符
                        </span>
                      </summary>
                      <label htmlFor="resume-text" className="field-title">
                        简历正文
                      </label>
                      <textarea
                        id="resume-text"
                        rows={12}
                        maxLength={30000}
                        disabled={!!busy}
                        value={resumeText}
                        onChange={(e) => editResume(e.target.value, resumeName)}
                        placeholder="在这里粘贴简历文字。简历作为背景信息，项目经历与能力仍需通过面试核实。"
                      />
                    </details>
                    {resumeReading && (
                      <ResumeReadingView value={resumeReading} />
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
                        disabled={!resumeText || !!busy}
                        onClick={() => {
                          editResume('');
                        }}
                      >
                        清空简历文字
                      </button>
                    </div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="transcript">
                <div className="panel text-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>面试记录</h2>
                      <p className="section-description">
                        上传豆包转写后整理的 .md 文件，再校对内容和说话人。
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
                          : transcriptName
                            ? '重新导入 Markdown 面试记录'
                            : '导入 Markdown 面试记录'}
                      </strong>
                      <span>仅支持 .md · UTF-8 · 最大 1 MB / 80,000 字</span>
                      <input
                        id="transcript-file"
                        type="file"
                        accept=".md"
                        disabled={!!busy}
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
                    <label htmlFor="transcript" className="sr-only">
                      面试对话文本
                    </label>
                    <textarea
                      id="transcript"
                      className="transcript-input"
                      disabled={!!busy || !transcriptName}
                      value={transcript}
                      maxLength={80000}
                      onChange={(e) => editTranscript(e.target.value)}
                      placeholder={
                        '请先导入 .md 面试记录，再在这里预览和校对。\n\n建议按下面的格式整理：\n面试官：请介绍一个你负责的项目。\n候选人：……\n\n不确定的内容请标注“待核实”，不要补写未说过的话。'
                      }
                    />
                    <label
                      className="review-check"
                      htmlFor="transcript-reviewed"
                    >
                      <Checkbox
                        id="transcript-reviewed"
                        checked={reviewed}
                        disabled={!transcript.trim() || !!busy}
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
                        disabled={!!busy || !services?.analysis || !reviewed}
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
                      <h2>结论评估</h2>
                      <p className="section-description">
                        把观察和证据，整理成清晰的判断。
                      </p>
                    </div>
                    <span className="badge">
                      {confirmed ? '已人工确认' : '待人工确认'}
                    </span>
                  </div>
                  {report ? (
                    <div className="panel-body">
                      <div className="report-summary">
                        <span className="eyebrow">AI 辅助评估 · 请核实</span>
                        <p>{report.summary}</p>
                      </div>
                      <p className="small-note">
                        评分参考：1 明确不符合 · 2 部分达到 · 3 基本达到 · 4
                        充分达到 · 5 显著超出
                      </p>
                      {report.dimensions.map((d) => (
                        <article className="assessment" key={d.name}>
                          <div className="assessment-heading">
                            <h3>{d.name}</h3>
                            <span
                              className={
                                d.score === null ? 'unscored' : 'score'
                              }
                            >
                              {d.score === null ? '证据不足' : `${d.score} / 5`}
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
          <aside className="panel context-panel" aria-label="面试准备">
            <h2>面试准备</h2>
            <InterviewPreparation {...preparationProps} />
          </aside>
        </div>
        <footer className="page-footer">
          <span>面谈 · 让面试判断有据可依</span>
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
      <Dialog open={preparationOpen} onOpenChange={setPreparationOpen}>
        <DialogContent className="preparation-dialog" showCloseButton={false}>
          <div className="dialog-heading">
            <DialogTitle>面试准备</DialogTitle>
            <button
              className="icon-button"
              aria-label="关闭面试准备"
              onClick={() => setPreparationOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <DialogDescription>
            设置候选人与本场面试的岗位标准。
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
        canSwitch={true}
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
        open={!!pendingCandidateName}
        onOpenChange={(open) => {
          if (!open) setPendingCandidateName(null);
        }}
      >
        <AlertDialogContent initialFocus={candidateKeepButton}>
          <AlertDialogTitle>简历姓名与当前候选人不同</AlertDialogTitle>
          <AlertDialogDescription>
            默认保留当前姓名。请选择是否使用简历中识别的姓名；选择不会重新阅读简历。
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
            的文字替换现有简历，并清除旧的简历阅读、辅助评估与人工确认。面试对话和人工意见保留。
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
              替换并自动阅读
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
          <AlertDialogTitle>开始一场新的面试？</AlertDialogTitle>
          <AlertDialogDescription>
            当前面试将保留在本地记录中。新面试带入已保存的全局默认标准或默认岗位模板，清空候选人资料和对话。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>返回并保留</AlertDialogCancel>
            <AlertDialogAction onClick={() => void localAction(library.create)}>
              保存并新建
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
