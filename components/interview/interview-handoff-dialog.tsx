'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { Check, LoaderCircle, Send } from 'lucide-react';
import { remoteRequest } from '@/lib/remote-analysis';
import type { InterviewHandoffStage } from '@/lib/interview-handoff';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

type Handoff = {
  stage: InterviewHandoffStage;
  targetUsername: string;
  targetInterviewId: string;
  createdAt: number;
};

export function InterviewHandoffDialog({
  open,
  onOpenChange,
  sourceId,
  candidate,
  stage,
  onPrepare,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceId: string;
  candidate: string;
  stage: InterviewHandoffStage;
  onPrepare: () => Promise<{ sourceRevision: number }>;
  onSuccess?: (handoff: Handoff) => void;
}) {
  const [accounts, setAccounts] = useState<Array<{ username: string }>>([]);
  const [targetUsername, setTargetUsername] = useState('');
  const [existing, setExisting] = useState<Handoff | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const stageLabel = stage === 'second' ? '复试' : '初试';

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void Promise.resolve()
      .then(() => {
        if (disposed) return null;
        setLoading(true);
        setError('');
        setAccounts([]);
        setTargetUsername('');
        setExisting(null);
        return Promise.all([
          remoteRequest<{ accounts: Array<{ username: string }> }>(
            '/api/handoff-accounts',
          ),
          remoteRequest<{ handoffs: Handoff[] }>(
            `/api/interviews/${encodeURIComponent(sourceId)}/handoffs`,
          ),
        ]);
      })
      .then((results) => {
        if (disposed || !results) return;
        const [accountResult, handoffResult] = results;
        setAccounts(accountResult.accounts);
        setTargetUsername(accountResult.accounts[0]?.username || '');
        setExisting(
          handoffResult.handoffs.find((item) => item.stage === stage) || null,
        );
      })
      .catch((reason: unknown) => {
        if (!disposed)
          setError(
            reason instanceof Error ? reason.message : '暂时无法读取派发信息。',
          );
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [open, sourceId, stage]);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetUsername || existing) return;
    setPending(true);
    setError('');
    try {
      const { sourceRevision } = await onPrepare();
      const result = await remoteRequest<{ handoff: Handoff }>(
        `/api/interviews/${encodeURIComponent(sourceId)}/handoff`,
        {
          method: 'POST',
          body: JSON.stringify({
            targetUsername,
            stage,
            sourceRevision,
            mutationId: crypto.randomUUID(),
          }),
        },
      );
      setExisting(result.handoff);
      onSuccess?.(result.handoff);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '派发失败，请重试。');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="interview-handoff-dialog">
        <DialogTitle>派发{stageLabel}</DialogTitle>
        <DialogDescription>
          将{candidate || '当前候选人'}的资料交给另一名面试官继续处理。
        </DialogDescription>
        {existing ? (
          <output className="handoff-complete">
            <Check size={18} />
            <div>
              <strong>已派发给 {existing.targetUsername}</strong>
              <span>
                {new Date(existing.createdAt).toLocaleString('zh-CN', {
                  hour12: false,
                })}
              </span>
            </div>
          </output>
        ) : (
          <form className="handoff-form" onSubmit={submit}>
            <label>
              选择接收面试官
              <NativeSelect
                value={targetUsername}
                onChange={(event) => setTargetUsername(event.target.value)}
                disabled={loading || pending}
              >
                {accounts.length === 0 && (
                  <NativeSelectOption value="">
                    {loading ? '正在读取账号…' : '暂无可用账号'}
                  </NativeSelectOption>
                )}
                {accounts.map((account) => (
                  <NativeSelectOption
                    value={account.username}
                    key={account.username}
                  >
                    {account.username}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <div className="handoff-snapshot-note">
              <strong>接收方会获得独立副本</strong>
              <span>
                {stage === 'second'
                  ? '已生成的复试提纲会一并传递；派发后双方记录互不覆盖，原始简历附件和作品 ZIP 不会传输。'
                  : '派发后双方记录互不覆盖；原始简历附件和作品 ZIP 不会传输。'}
              </span>
            </div>
            {error && (
              <p className="remote-error" role="alert">
                {error}
              </p>
            )}
            <DialogFooter className="handoff-dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                取消
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={pending || !targetUsername || !!existing}
              >
                {pending ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Send size={16} />
                )}
                {pending ? '正在派发…' : `确认派发${stageLabel}`}
              </button>
            </DialogFooter>
          </form>
        )}
        {existing && error && (
          <p className="remote-error" role="alert">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
