'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Mic,
  FileText,
  ClipboardCheck,
  ArrowUpRight,
  ShieldCheck,
  Pause,
  Play,
  Square,
  Download,
  Plus,
  Settings2,
  ArrowRight,
  LoaderCircle,
  Check,
  CircleAlert,
  X,
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
import { useRecorder, MAX_AUDIO_BYTES } from '@/hooks/use-recorder';
import { validateInput, exportMarkdown, type Report } from '@/lib/interview';

const defaultDimensions = '专业能力、问题解决、沟通协作、岗位匹配';
const stateLabels = {
  idle: '准备就绪',
  requesting: '等待麦克风授权',
  recording: '正在录音',
  paused: '录音已暂停',
  stopping: '正在保存音频',
  stopped: '录音已结束',
};
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Home() {
  const recorder = useRecorder();
  const [tab, setTab] = useState('record');
  const [candidate, setCandidate] = useState('');
  const [role, setRole] = useState('');
  const [requirements, setRequirements] = useState('');
  const [dimensionText, setDimensionText] = useState(defaultDimensions);
  const [transcript, setTranscript] = useState('');
  const [consent, setConsent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [conclusion, setConclusion] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'transcribe' | 'analyze' | null>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [services, setServices] = useState<{
    analysis: boolean;
    transcription: boolean;
  } | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [settings, setSettings] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const active = ['recording', 'paused', 'requesting', 'stopping'].includes(
    recorder.state,
  );
  const dimensions = dimensionText
    .split(/[、,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const input = { role, requirements, transcript, dimensions };
  const hasContent = Boolean(
    dimensionText !== defaultDimensions ||
    candidate ||
    role ||
    requirements ||
    transcript ||
    conclusion ||
    recorder.blob ||
    active,
  );
  const safeName = (candidate || '未命名面试')
    .replace(/[\\/:*?"<>|\r\n]/g, '_')
    .slice(0, 60);
  const refreshServices = useCallback(async () => {
    try {
      const r = await fetch('/api/status', {
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error();
      setServices(await r.json());
      setStatusError(false);
    } catch {
      setServices(null);
      setStatusError(true);
    }
  }, []);
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- This callback updates state only after the external status request resolves.
    void refreshServices();
  }, [refreshServices]);
  useEffect(() => {
    if (!recorder.blob) {
      // oxlint-disable-next-line react/react-compiler -- Synchronize an external Blob URL resource.
      setAudioUrl('');
      return;
    }
    const url = URL.createObjectURL(recorder.blob);
    // oxlint-disable-next-line react/react-compiler -- The effect owns and releases this external Blob URL.
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recorder.blob]);
  useEffect(() => {
    if (!hasContent) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasContent]);
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
              '读取当前面试的辅助评估、人工结论及确认状态；不会开始录音、调用模型或改变结论。',
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
  function editTranscript(text: string) {
    invalidate();
    setTranscript(text);
    setReviewed(false);
  }
  async function transcribe() {
    if (!recorder.blob || busyRef.current) return;
    if (transcript.trim()) {
      setError('当前已有对话记录。请先导出备份并清空文本，再发起转写。');
      setTab('transcript');
      return;
    }
    if (recorder.blob.size > MAX_AUDIO_BYTES) {
      setError('录音超过 20 MB，请先下载后分段转写。');
      return;
    }
    busyRef.current = true;
    setBusy('transcribe');
    setError('');
    try {
      const form = new FormData();
      form.set(
        'file',
        recorder.blob,
        `interview.${recorder.blob.type.includes('mp4') ? 'm4a' : 'webm'}`,
      );
      const r = await fetch('/api/transcribe', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(130000),
      });
      const data = (await r.json()) as { text?: string; error?: string };
      if (!r.ok || !data.text)
        throw new Error(data.error || '转写失败，请重试');
      editTranscript(data.text);
      setTab('transcript');
      setNotice(
        '转写完成。请核对错字，并用“面试官：”“候选人：”标明说话人后再评估。',
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'TimeoutError'
          ? '转写超时，录音仍保留，请稍后重试。'
          : e instanceof Error
            ? e.message
            : '转写失败',
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
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
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(100000),
      });
      const data = (await r.json()) as Report & { error?: string };
      if (!r.ok) throw new Error(data.error || '生成评估失败');
      setReport(data);
      setConfirmed(false);
      setTab('report');
      setNotice('辅助评估已生成，请核实引用与判断后填写最终意见。');
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'TimeoutError'
          ? '分析超时，记录仍保留，请重试。'
          : e instanceof Error
            ? e.message
            : '分析失败',
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }
  function confirmConclusion() {
    try {
      validateInput(input);
      if (!reviewed) throw new Error('请先在对话记录页完成校对确认。');
      if (!conclusion.trim()) throw new Error('请填写面试官结论。');
      setError('');
      setConfirmed(true);
      setNotice('面试结论已在当前页面确认，请导出保存。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '请补全资料');
    }
  }
  function reset() {
    recorder.reset();
    setCandidate('');
    setRole('');
    setRequirements('');
    setDimensionText(defaultDimensions);
    setTranscript('');
    setConsent(false);
    setReviewed(false);
    setReport(null);
    setConclusion('');
    setConfirmed(false);
    setNotice('');
    setError('');
    setTab('record');
    setResetOpen(false);
  }
  function exportRecord() {
    download(
      new Blob(
        [exportMarkdown(candidate, input, report, conclusion, confirmed)],
        { type: 'text/markdown;charset=utf-8' },
      ),
      `${safeName}-面试记录.md`,
    );
  }
  const hh = String(Math.floor(recorder.seconds / 3600)).padStart(2, '0'),
    mm = String(Math.floor(recorder.seconds / 60) % 60).padStart(2, '0'),
    ss = String(recorder.seconds % 60).padStart(2, '0');
  return (
    <div className="workbench">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines size={23} />
          </span>
          <b>
            面谈<span>INTERVIEW NOTES</span>
          </b>
        </div>
        <span className="workspace-label">面试工作台</span>
        <span className="privacy-label">
          <ShieldCheck size={16} /> 当前页面 · 私密会话
        </span>
        <button
          className="icon-button"
          onClick={() => setSettings(true)}
          aria-label="查看服务配置"
        >
          <Settings2 size={19} />
        </button>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">每一份判断，都有依据</p>
            <h1>
              {candidate
                ? `${candidate}的面试记录`
                : '一次好面试，从认真倾听开始'}
              <span>。</span>
            </h1>
            <p>记录对话，梳理证据，留下更清晰的面试结论。</p>
          </div>
          <button
            className="secondary-button"
            disabled={active || !!busy}
            onClick={() => (hasContent ? setResetOpen(true) : reset())}
          >
            <Plus size={16} />
            新的面试
          </button>
        </div>
        {(error || recorder.error) && (
          <div role="alert" className="message error">
            <CircleAlert size={18} />
            <span>{error || recorder.error}</span>
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
        <div className="workspace-grid">
          <section className="main-column">
            <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
              <TabsList className="work-tabs">
                <TabsTrigger value="record">
                  <Mic />
                  面试录音
                </TabsTrigger>
                <TabsTrigger value="transcript">
                  <FileText />
                  对话记录{transcript && <span className="tab-dot" />}
                </TabsTrigger>
                <TabsTrigger value="report">
                  <ClipboardCheck />
                  结论评估{confirmed && <Check size={14} />}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="record">
                <div className="panel recorder">
                  <div className="panel-heading">
                    <h2>现场录音</h2>
                    <span
                      className={`badge ${recorder.state === 'recording' ? 'live' : ''}`}
                    >
                      {stateLabels[recorder.state]}
                    </span>
                  </div>
                  <div className="recording-center">
                    <div
                      className={`mic-emblem ${recorder.state === 'recording' ? 'live-mic' : ''}`}
                    >
                      <Mic size={32} />
                    </div>
                    <div
                      className="timer"
                      aria-label={`已录音 ${recorder.seconds} 秒`}
                    >
                      {hh}:{mm}
                      <span>:{ss}</span>
                    </div>
                    <p>
                      {recorder.state === 'recording'
                        ? '正在记录，请保持网页打开'
                        : recorder.state === 'paused'
                          ? '已暂停，准备好后继续'
                          : recorder.state === 'stopped'
                            ? '对话已记录，接下来梳理每一个细节'
                            : '让对话自然发生，把记录交给面谈'}
                    </p>
                    <div className="waveform" aria-hidden="true">
                      {Array.from({ length: 55 }, (_, i) => (
                        <i
                          key={i}
                          style={{
                            height: `${4 + (recorder.levels[i] || 0) * 50}px`,
                          }}
                        />
                      ))}
                    </div>
                    {recorder.state === 'idle' && (
                      <>
                        <label className="consent" htmlFor="record-consent">
                          <Checkbox
                            id="record-consent"
                            checked={consent}
                            onCheckedChange={(v) => setConsent(v)}
                          />
                          <span>我已告知参与者，并获得录音同意</span>
                        </label>
                        <button
                          className="primary-button"
                          disabled={!consent || !!busy}
                          onClick={() => void recorder.start()}
                        >
                          <Mic size={18} />
                          开始录音
                        </button>
                      </>
                    )}
                    {recorder.state === 'requesting' && (
                      <p className="pending">
                        <LoaderCircle className="spin" size={18} />
                        请在浏览器弹窗中允许使用麦克风
                      </p>
                    )}
                    {(recorder.state === 'recording' ||
                      recorder.state === 'paused') && (
                      <div className="button-row centered">
                        <button
                          className="secondary-button"
                          onClick={
                            recorder.state === 'paused'
                              ? recorder.resume
                              : recorder.pause
                          }
                        >
                          {recorder.state === 'paused' ? (
                            <Play size={16} />
                          ) : (
                            <Pause size={16} />
                          )}{' '}
                          {recorder.state === 'paused' ? '继续录音' : '暂停'}
                        </button>
                        <button
                          className="danger-button"
                          onClick={recorder.stop}
                        >
                          <Square size={15} />
                          结束录音
                        </button>
                      </div>
                    )}
                    {recorder.state === 'stopping' && (
                      <p className="pending">
                        <LoaderCircle className="spin" size={18} />
                        正在整理录音
                      </p>
                    )}
                    {recorder.blob && (
                      <div className="audio-result">
                        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- Newly recorded user audio has no timed captions; editable transcription is provided separately. */}
                        <audio
                          controls
                          src={audioUrl}
                          aria-label="面试录音回放"
                        />
                        <div className="button-row centered">
                          <button
                            className="secondary-button"
                            onClick={() =>
                              download(
                                recorder.blob!,
                                `${safeName}.${recorder.blob!.type.includes('mp4') ? 'm4a' : 'webm'}`,
                              )
                            }
                          >
                            <Download size={16} />
                            下载录音
                          </button>
                          <button
                            className="primary-button"
                            disabled={
                              !!busy ||
                              !services?.transcription ||
                              recorder.blob.size > MAX_AUDIO_BYTES
                            }
                            onClick={() => void transcribe()}
                          >
                            {busy === 'transcribe' ? (
                              <LoaderCircle className="spin" size={16} />
                            ) : (
                              <FileText size={16} />
                            )}{' '}
                            {busy === 'transcribe' ? '正在转写…' : '转写为文字'}
                          </button>
                        </div>
                        <p className="small-note">
                          {(recorder.blob.size / 1024 / 1024).toFixed(1)} MB ·{' '}
                          {services?.transcription
                            ? '点击转写后，音频将发送至已配置的语音服务'
                            : '转写服务待配置，可先下载录音或手动填写对话'}
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setTab('transcript')}
                        >
                          手动填写对话记录 <ArrowRight size={15} />
                        </button>
                      </div>
                    )}
                    {!recorder.blob && (
                      <p className="small-note">
                        {recorder.device} · 最长 60 分钟 / 20 MB
                      </p>
                    )}
                  </div>
                  <div className="recording-footer">
                    <span>
                      <ShieldCheck size={15} />{' '}
                      关闭前请下载，音频仅保留在当前页面
                    </span>
                    <span>建议在安静环境使用</span>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="transcript">
                <div className="panel text-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>对话记录</h2>
                      <p className="section-description">
                        保留原意，核对细节与说话人归属。
                      </p>
                    </div>
                    <span className="count">
                      {transcript.length.toLocaleString()} / 80,000 字
                    </span>
                  </div>
                  <div className="panel-body">
                    <label htmlFor="transcript" className="sr-only">
                      面试对话文本
                    </label>
                    <textarea
                      id="transcript"
                      className="transcript-input"
                      disabled={!!busy || active}
                      value={transcript}
                      maxLength={80000}
                      onChange={(e) => editTranscript(e.target.value)}
                      placeholder={
                        '在这里录入或粘贴面试对话。\n\n建议按下面的格式整理：\n面试官：请介绍一个你负责的项目。\n候选人：……\n\n不确定的内容请标注“待核实”，不要补写未说过的话。'
                      }
                    />
                    <label
                      className="review-check"
                      htmlFor="transcript-reviewed"
                    >
                      <Checkbox
                        id="transcript-reviewed"
                        checked={reviewed}
                        disabled={!transcript.trim() || !!busy || active}
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
                          ? 'AI 分析服务尚未配置'
                          : '生成评估时，将发送岗位要求和校对后的文字'}
                      </span>
                      <button
                        className="primary-button"
                        disabled={
                          !!busy || active || !services?.analysis || !reviewed
                        }
                        onClick={() => void analyze()}
                      >
                        {busy === 'analyze' ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <ClipboardCheck size={16} />
                        )}{' '}
                        {busy === 'analyze' ? '正在分析…' : '生成辅助评估'}
                      </button>
                    </div>
                    <button
                      className="text-button"
                      disabled={!transcript.trim() || active || !!busy}
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
                        前往对话记录 <ArrowRight size={15} />
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
                      disabled={!!busy || active}
                      onChange={(e) => {
                        setConclusion(e.target.value);
                        setConfirmed(false);
                      }}
                      placeholder="结合岗位要求，写下已证实的能力、尚存疑问和下一步建议。"
                    />
                    <div className="button-row">
                      <button
                        className="primary-button"
                        disabled={
                          confirmed || !!busy || active || !conclusion.trim()
                        }
                        onClick={confirmConclusion}
                      >
                        <Check size={16} />
                        {confirmed ? '已确认结论' : '确认面试结论'}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!hasContent || !!busy || active}
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
            <div className="process-strip">
              <span>
                <b>01</b> 记录真实对话
              </span>
              <ArrowUpRight size={15} />
              <span>
                <b>02</b> 校对面试记录
              </span>
              <ArrowUpRight size={15} />
              <span>
                <b>03</b> 确认评估结论
              </span>
            </div>
          </section>
          <aside className="panel context-panel">
            <p className="eyebrow">面试准备</p>
            <h2>给评估一个清晰的标准</h2>
            <fieldset disabled={!!busy || active}>
              <label>
                候选人
                <input
                  value={candidate}
                  maxLength={100}
                  onChange={(e) => {
                    invalidate();
                    setCandidate(e.target.value);
                  }}
                  placeholder="输入候选人姓名"
                />
              </label>
              <label>
                应聘岗位 <span className="required">*</span>
                <input
                  value={role}
                  maxLength={200}
                  onChange={(e) => {
                    invalidate();
                    setRole(e.target.value);
                  }}
                  placeholder="例如：产品经理"
                />
              </label>
              <label>
                岗位要求 <span className="required">*</span>
                <textarea
                  value={requirements}
                  maxLength={10000}
                  onChange={(e) => {
                    invalidate();
                    setRequirements(e.target.value);
                  }}
                  rows={5}
                  placeholder="填写核心职责、必须具备的能力和经验…"
                />
              </label>
              <div className="divider" />
              <label>
                评估维度 <span className="required">*</span>
                <textarea
                  value={dimensionText}
                  maxLength={480}
                  rows={2}
                  onChange={(e) => {
                    invalidate();
                    setDimensionText(e.target.value);
                  }}
                  aria-describedby="dimensions-help"
                />
              </label>
              <p id="dimensions-help" className="small-note">
                用顿号或换行分隔，支持 1–8 个维度。每个维度依据对话证据评估。
              </p>
            </fieldset>
            <div className="service-summary">
              <span
                className={`service-dot ${services?.analysis && services?.transcription ? 'ready' : ''}`}
              />
              <span>
                {statusError
                  ? '服务状态获取失败'
                  : services === null
                    ? '正在检查服务…'
                    : services.analysis && services.transcription
                      ? '模型服务已配置'
                      : '模型服务待配置'}
              </span>
              <button className="text-button" onClick={() => setSettings(true)}>
                查看
                <ArrowUpRight size={13} />
              </button>
            </div>
          </aside>
        </div>
        <footer className="page-footer">
          <span>面谈 · 让面试判断有据可依</span>
          <button
            className="text-button"
            disabled={!hasContent || active || !!busy}
            onClick={exportRecord}
          >
            <Download size={13} />
            导出当前记录
          </button>
        </footer>
      </main>
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
            录音与人工记录可直接使用。转写和辅助评估需要先配置服务。
          </DialogDescription>
          <div className="service-row">
            <span>语音转写</span>
            <span className="badge">
              {services?.transcription ? '已配置' : '未配置'}
            </span>
          </div>
          <div className="service-row">
            <span>AI 辅助评估</span>
            <span className="badge">
              {services?.analysis ? '已配置' : '未配置'}
            </span>
          </div>
          <p>
            请由部署者在服务端填写对应的 API
            地址、模型和密钥。密钥不会保存在浏览器中。
          </p>
          <p className="small-note">
            支持兼容 audio/transcriptions 与 chat/completions
            格式的服务。选定提供商后仍需联调验证。
          </p>
          {statusError && <p role="alert">无法获取状态，请稍后重试。</p>}
          <button
            className="secondary-button"
            onClick={() => void refreshServices()}
          >
            重新检查配置
          </button>
        </DialogContent>
      </Dialog>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>开始一场新的面试？</AlertDialogTitle>
          <AlertDialogDescription>
            当前页面的录音、文字和结论将被清除。请先下载录音并导出面试记录。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>返回并保留</AlertDialogCancel>
            <AlertDialogAction onClick={reset}>清除并新建</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
