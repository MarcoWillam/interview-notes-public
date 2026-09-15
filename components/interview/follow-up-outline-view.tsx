'use client';

import { useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  normalizeRequestedFocus,
  type FollowUpOutlineGroup,
  type FollowUpOutlineQuestion,
} from '@/lib/follow-up-outline';

type CallbackResult = boolean | Promise<boolean>;

function characterCount(value: string) {
  return Array.from(value).length;
}

function formatCreatedAt(value: number) {
  return new Date(value).toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function FollowUpQuestionCard({
  question,
  number,
}: {
  question: FollowUpOutlineQuestion;
  number: number;
}) {
  return (
    <article className="interview-question-card follow-up-outline-question">
      <h5>{`${number}. ${question.question}`}</h5>
      <details>
        <summary>验证目标、观察信号与追问</summary>
        <p>
          <strong>验证目标：</strong>
          {question.goal}
        </p>
        {question.resumeEvidence && (
          <blockquote>
            <strong>简历依据</strong>
            {question.resumeEvidence}
          </blockquote>
        )}
        <p className="question-detail-label">重点观察</p>
        <ul>
          {question.listenFor.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <p className="question-detail-label">风险信号</p>
        <ul>
          {question.riskSignals.map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
        <p className="question-detail-label">条件追问</p>
        <ul>
          {question.probes.map((probe) => (
            <li key={`${probe.condition}-${probe.question}`}>
              当{probe.condition}时：{probe.question}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export function FollowUpOutlineView({
  groups = [],
  busy = false,
  draft = '',
  onGenerate,
  onDelete,
}: {
  groups?: readonly FollowUpOutlineGroup[];
  busy?: boolean;
  draft?: string;
  onGenerate?: (requestedFocus: string) => CallbackResult;
  onDelete?: (groupId: string) => CallbackResult;
}) {
  const [open, setOpen] = useState(false);
  const [requestedFocus, setRequestedFocus] = useState(draft);
  const [deleting, setDeleting] = useState<FollowUpOutlineGroup | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const disabled = busy || submitting;
  const orderedGroups = [...groups].sort(
    (left, right) => left.createdAt - right.createdAt,
  );

  function closeGeneration() {
    if (disabled) return;
    setOpen(false);
    setError('');
  }

  async function generate() {
    let normalized: string;
    try {
      normalized = normalizeRequestedFocus(requestedFocus);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '请填写 2–200 个字符。',
      );
      textareaRef.current?.focus();
      return;
    }
    if (!onGenerate || disabled) return;
    setSubmitting(true);
    setError('');
    try {
      const accepted = await onGenerate(normalized);
      if (!accepted) {
        setError('补充追问暂未生成，请检查后重试。');
        textareaRef.current?.focus();
        return;
      }
      setRequestedFocus('');
      setOpen(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '补充追问生成失败，请重试。',
      );
      textareaRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteGroup() {
    if (!deleting || !onDelete || disabled) return;
    setSubmitting(true);
    setError('');
    try {
      const accepted = await onDelete(deleting.id);
      if (accepted) setDeleting(null);
      else setError('删除本组失败，请重试。');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '删除本组失败，请重试。',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="follow-up-outline"
      aria-labelledby="follow-up-outline-title"
    >
      <header className="follow-up-outline-heading">
        <div>
          <h4 id="follow-up-outline-title">补充追问</h4>
          <p>针对岗位关注点额外准备 2 道问题，不会修改原面试提纲。</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || !onGenerate}
          onClick={() => {
            setError('');
            setOpen(true);
          }}
        >
          {busy ? '正在生成…' : '补充追问'}
        </button>
      </header>

      {orderedGroups.length > 0 && (
        <div className="follow-up-outline-groups">
          {orderedGroups.map((group, groupIndex) => (
            <section
              className={`follow-up-outline-group follow-up-outline-group-${groupIndex % 4}`}
              key={group.id}
            >
              <header className="follow-up-outline-group-heading">
                <div>
                  <h5>{group.requestedFocus}</h5>
                  <time dateTime={new Date(group.createdAt).toISOString()}>
                    {formatCreatedAt(group.createdAt)}
                  </time>
                </div>
                <button
                  type="button"
                  className="text-button follow-up-outline-delete"
                  disabled={disabled || !onDelete}
                  onClick={() => {
                    setError('');
                    setDeleting(group);
                  }}
                >
                  删除本组
                </button>
              </header>
              <p className="small-note">固定 2 道补充问题 · 与原提纲分开保存</p>
              <div className="interview-question-list">
                {group.questions.map((question, index) => (
                  <FollowUpQuestionCard
                    question={question}
                    number={index + 1}
                    key={question.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) =>
          nextOpen ? setOpen(true) : closeGeneration()
        }
      >
        <DialogContent
          className="follow-up-outline-dialog"
          showCloseButton={!disabled}
        >
          <DialogTitle>补充追问</DialogTitle>
          <DialogDescription>
            Codex 会参考岗位要求、简历自述和现有面试提纲，固定生成 2
            道补充问题；结果独立保存，不会修改原面试提纲。
          </DialogDescription>
          {error && (
            <p className="follow-up-outline-error" role="alert">
              {error}
            </p>
          )}
          <label
            className="follow-up-outline-field"
            htmlFor="follow-up-requested-focus"
          >
            需要补问的维度或关注点
            <textarea
              id="follow-up-requested-focus"
              ref={textareaRef}
              rows={4}
              maxLength={200}
              value={requestedFocus}
              disabled={disabled}
              aria-describedby="follow-up-requested-focus-count"
              aria-invalid={!!error}
              onChange={(event) => {
                setRequestedFocus(event.target.value);
                setError('');
              }}
              placeholder="例如：候选人如何主动识别问题并推动落地"
            />
          </label>
          <p className="small-note" id="follow-up-requested-focus-count">
            {characterCount(requestedFocus)} / 200 字
          </p>
          <DialogFooter>
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={closeGeneration}
            >
              取消
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={disabled || !onGenerate}
              onClick={() => void generate()}
            >
              {disabled ? '正在生成…' : '生成 2 道补充问题'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !disabled) {
            setDeleting(null);
            setError('');
          }
        }}
      >
        <AlertDialogContent className="follow-up-outline-delete-dialog">
          <AlertDialogTitle>删除这组补充追问？</AlertDialogTitle>
          <AlertDialogDescription>
            将删除“{deleting?.requestedFocus}”生成的固定 2
            道问题，不会修改原面试提纲。
          </AlertDialogDescription>
          {error && (
            <p className="follow-up-outline-error" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disabled}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || !onDelete}
              onClick={() => void deleteGroup()}
            >
              删除本组
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
