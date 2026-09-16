'use client';

import { useMemo, useState } from 'react';
import { FileText, LoaderCircle, Upload } from 'lucide-react';
import { importResume } from '../../lib/import-resume';
import { importTranscript } from '../../lib/import-transcript';
import {
  parsePriorRoundDocument,
  type PriorRoundImport,
} from '../../lib/second-round';
import type { Preference } from '../../lib/local/store';
import { normalizeStandards } from '../../lib/standards';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { NativeSelect } from '../ui/native-select';

export type SecondRoundCreateSeed = {
  candidate: string;
  sourceTemplateId: string;
  priorRound: PriorRoundImport;
  resumeText: string;
  resumeName: string;
};

export function SecondRoundCreateDialog({
  open,
  templates,
  defaultTemplateId,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  templates: readonly Preference[];
  defaultTemplateId: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (seed: SecondRoundCreateSeed) => void | Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [priorText, setPriorText] = useState('');
  const [priorName, setPriorName] = useState('');
  const [candidate, setCandidate] = useState('');
  const [templateId, setTemplateId] = useState(defaultTemplateId);
  const [resumeText, setResumeText] = useState('');
  const [resumeName, setResumeName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const priorRound = useMemo(() => {
    if (!priorText.trim()) return null;
    try {
      return parsePriorRoundDocument(priorText, priorName || '粘贴的初试资料');
    } catch {
      return null;
    }
  }, [priorName, priorText]);
  const selectedTemplate =
    templates.find(({ id }) => id === templateId) || templates[0];
  const effectiveResume = priorRound?.embeddedResumeText || resumeText;

  function reset() {
    setStep(1);
    setPriorText('');
    setPriorName('');
    setCandidate('');
    setTemplateId(defaultTemplateId);
    setResumeText('');
    setResumeName('');
    setError('');
  }

  function changeOpen(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function readPrior(file: File) {
    setBusy(true);
    setError('');
    try {
      const text = await importTranscript(file);
      setPriorText(text);
      setPriorName(file.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '初试资料读取失败。');
    } finally {
      setBusy(false);
    }
  }

  async function readResume(file: File) {
    setBusy(true);
    setError('');
    try {
      setResumeText(await importResume(file));
      setResumeName(file.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '简历提取失败。');
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setError('');
    if (step === 1) {
      if (!priorRound) return setError('请先导入或粘贴有效的初试资料。');
      if (priorRound.candidate) setCandidate(priorRound.candidate);
      if (priorRound.role) {
        const match = templates.find(({ role }) => role === priorRound.role);
        if (match) setTemplateId(match.id);
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!effectiveResume.trim())
        return setError('外部初试资料必须上传并成功解析候选人简历。');
      setStep(3);
    }
  }

  async function create() {
    if (!priorRound || !selectedTemplate || !effectiveResume.trim()) return;
    if (!candidate.trim()) return setError('请填写候选人姓名。');
    setBusy(true);
    setError('');
    try {
      normalizeStandards(selectedTemplate);
      await onCreate({
        candidate: candidate.trim(),
        sourceTemplateId: selectedTemplate.id,
        priorRound,
        resumeText: effectiveResume,
        resumeName:
          priorRound.source === 'bole-markdown' ? priorRound.name : resumeName,
      });
      changeOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '复试记录创建失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="second-round-create-dialog">
        <DialogHeader>
          <span className="second-round-step">第 {step} / 3 步</span>
          <DialogTitle>新建复试</DialogTitle>
          <DialogDescription>
            导入初试资料和简历后，生成避免重复初试的复试提纲。
          </DialogDescription>
        </DialogHeader>
        <div className="second-round-create-body">
          {step === 1 && (
            <>
              <label className="transcript-upload" htmlFor="prior-round-file">
                <FileText size={22} />
                <strong>{busy ? '正在读取…' : '导入初试资料'}</strong>
                <span>支持伯乐 AI 或其他来源的 .md、.txt</span>
                <input
                  id="prior-round-file"
                  type="file"
                  accept=".md,.txt"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void readPrior(file);
                  }}
                />
              </label>
              <label className="field-title" htmlFor="prior-round-text">
                或直接粘贴初试记录
              </label>
              <textarea
                id="prior-round-text"
                rows={10}
                maxLength={80000}
                value={priorText}
                disabled={busy}
                onChange={(event) => {
                  setPriorText(event.target.value);
                  setPriorName('手动粘贴 / 输入');
                }}
                placeholder="粘贴初试对话、面试笔记、评分表或面试官结论。"
              />
              {priorRound && (
                <p className="small-note">
                  已识别为
                  {priorRound.source === 'bole-markdown'
                    ? '伯乐 AI 导出记录'
                    : '外部初试资料'}
                  {priorRound.embeddedResumeText ? ' · 已包含简历' : ''}
                </p>
              )}
            </>
          )}
          {step === 2 && (
            <>
              {priorRound?.embeddedResumeText ? (
                <div className="second-round-resume-ready">
                  <strong>已从伯乐 AI 初试记录读取简历</strong>
                  <span>
                    {priorRound.embeddedResumeText.length} 字符，无需重复上传。
                  </span>
                </div>
              ) : (
                <label
                  className="transcript-upload"
                  htmlFor="second-round-resume"
                >
                  <Upload size={22} />
                  <strong>
                    {busy ? '正在提取…' : '上传候选人简历（必填）'}
                  </strong>
                  <span>Word（.doc / .docx）或文字版 PDF · 最大 5 MB</span>
                  <input
                    id="second-round-resume"
                    type="file"
                    accept=".doc,.docx,.pdf"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void readResume(file);
                    }}
                  />
                </label>
              )}
              {resumeName && <p className="small-note">已提取：{resumeName}</p>}
              <details className="resume-body-details">
                <summary>查看简历正文 · {effectiveResume.length} 字符</summary>
                <textarea readOnly rows={10} value={effectiveResume} />
              </details>
            </>
          )}
          {step === 3 && (
            <div className="second-round-confirmation">
              <label className="field-title" htmlFor="second-round-candidate">
                候选人姓名
              </label>
              <input
                id="second-round-candidate"
                value={candidate}
                maxLength={80}
                onChange={(event) => setCandidate(event.target.value)}
              />
              <label className="field-title" htmlFor="second-round-template">
                复试岗位
              </label>
              <NativeSelect
                id="second-round-template"
                className="form-native-select"
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </NativeSelect>
              <dl>
                <div>
                  <dt>初试资料</dt>
                  <dd>{priorRound?.name}</dd>
                </div>
                <div>
                  <dt>资料来源</dt>
                  <dd>
                    {priorRound?.source === 'bole-markdown'
                      ? '伯乐 AI'
                      : '外部记录'}
                  </dd>
                </div>
                <div>
                  <dt>候选人简历</dt>
                  <dd>已提取 {effectiveResume.length} 字符</dd>
                </div>
                <div>
                  <dt>复试提纲</dt>
                  <dd>6 道必问 + 最多 3 道候选题 · 45–60 分钟</dd>
                </div>
              </dl>
            </div>
          )}
          {error && (
            <p className="follow-up-outline-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => (step === 1 ? changeOpen(false) : setStep(step - 1))}
          >
            {step === 1 ? '取消' : '上一步'}
          </button>
          {step < 3 ? (
            <button className="primary-button" disabled={busy} onClick={next}>
              下一步
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={busy || !candidate.trim() || !effectiveResume.trim()}
              onClick={() => void create()}
            >
              {busy && <LoaderCircle className="spin" size={15} />}{' '}
              创建并进入复试
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
