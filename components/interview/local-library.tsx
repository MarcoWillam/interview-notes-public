'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Download, Trash2, X } from 'lucide-react';
import type { useInterviewLibrary } from '@/hooks/use-interview-library';
import { localStore } from '@/lib/local/store';
import type { CloudInterviewSummary } from '@/lib/cloud-interview';
import { InterviewConflicts, InterviewHistory, InterviewTrash } from './interview-history';

type Library = ReturnType<typeof useInterviewLibrary>;
type Tab = 'records' | 'history' | 'conflicts' | 'trash';

export function LocalLibrary({
  open,
  onClose,
  library,
  onError,
  download,
  assertIdle,
}: {
  open: boolean;
  onClose: () => void;
  library: Library;
  onError: (message: string) => void;
  download: (blob: Blob, name: string) => void;
  assertIdle: () => void;
}) {
  const [tab, setTab] = useState<Tab>('records');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [trash, setTrash] = useState<CloudInterviewSummary[]>([]);
  const running = useRef(false);

  async function act(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError('');
    try {
      assertIdle();
      await task();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '记录操作失败';
      setError(message);
      onError(message);
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    if (!open || tab !== 'trash' || !library.cloud) return;
    void library.loadTrash().then(setTrash).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : '回收站读取失败'),
    );
  }, [open, tab, library.cloud]);

  const current = library.sessions.find((row) => row.id === library.id);
  const tabs: Array<[Tab, string, number?]> = [
    ['records', '当前记录'],
    ...(library.cloud
      ? ([
          ['history', '版本历史'],
          ['conflicts', '冲突', library.conflictCount],
          ['trash', '回收站'],
        ] as Array<[Tab, string, number?]>)
      : []),
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={(value) => !value && !pending && onClose()}>
        <DialogContent className="library-dialog" showCloseButton={false}>
          <div className="dialog-heading">
            <div>
              <DialogTitle>记录管理</DialogTitle>
              <DialogDescription>
                {library.cloud
                  ? '面试记录已按账号保存，可查看历史版本、同步冲突和回收站。'
                  : '本地预览的数据只保存在当前浏览器。'}
              </DialogDescription>
            </div>
            <button className="icon-button" aria-label="关闭记录管理" disabled={pending} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="library-tabs" role="tablist" aria-label="记录管理分类">
            {tabs.map(([value, label, count]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                data-active={tab === value || undefined}
                disabled={pending}
                onClick={() => setTab(value)}
              >
                {label}
                {!!count && <span>{count}</span>}
              </button>
            ))}
          </div>
          {error && <p className="message error" role="alert">{error}</p>}
          <div className="library-tab-body">
            {tab === 'records' && (
              <RecordList
                library={library}
                pending={pending}
                act={act}
                download={download}
                onDelete={setDeleting}
              />
            )}
            {tab === 'history' && (
              <InterviewHistory
                key={library.id}
                current={current}
                loadVersions={() => library.loadVersions(library.id)}
                loadVersion={(revision) => library.loadVersion(library.id, revision)}
                restoreVersion={(revision) => act(() => library.restoreVersion(library.id, revision))}
                pending={pending}
              />
            )}
            {tab === 'conflicts' && (
              <InterviewConflicts
                conflicts={library.conflicts}
                pending={pending}
                resolve={(conflictId, action) => act(() => library.resolveConflict(conflictId, action))}
              />
            )}
            {tab === 'trash' && (
              <InterviewTrash
                rows={trash}
                pending={pending}
                restore={(row) =>
                  act(async () => {
                    await library.restoreDeleted(row.id, row.revision);
                    setTrash(await library.loadTrash());
                  })
                }
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleting} onOpenChange={(value) => !value && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>{library.cloud ? '将这场面试移到回收站？' : '删除这场本地面试？'}</AlertDialogTitle>
          <AlertDialogDescription>
            {library.cloud
              ? '文字档案将在回收站保留 30 天。本机录音会立即删除，且不能从云端恢复。'
              : '将删除这场面试的简历文字、对话、结论和本地录音。'}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deleting!;
                setDeleting(null);
                void act(() => library.remove(target));
              }}
            >
              {library.cloud ? '移到回收站' : '删除本地记录'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RecordList({
  library,
  pending,
  act,
  download,
  onDelete,
}: {
  library: Library;
  pending: boolean;
  act: (task: () => Promise<void>) => Promise<void>;
  download: (blob: Blob, name: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <div className="storage-overview">
        <span>当前浏览器约占用 {(library.storage.usage / 1024 / 1024).toFixed(1)} MB</span>
        <button className="text-button" disabled={pending || library.storage.persistent} onClick={() => void act(library.persist)}>
          {library.storage.persistent ? '已启用持久保存' : '申请持久保存'}
        </button>
      </div>
      <p className="small-note">
        {library.cloud
          ? '文字、提纲与评估会同步到本人账号；原始简历、作品 ZIP 和录音仍保存在上传它们的电脑。'
          : '浏览器可能拒绝持久保存申请；无痕窗口关闭后数据会被清除。'}
      </p>
      <div className="local-list">
        {library.sessions.length === 0 ? (
          <p className="library-empty">暂无面试记录。</p>
        ) : (
          library.sessions.map((row) => {
            const audio = library.audio.find((item) => item.id === row.id);
            return (
              <article key={row.id} className="local-row">
                <div>
                  <strong>
                    {row.candidate || '未命名面试'}
                    {row.id === library.id && <span className="badge">当前</span>}
                  </strong>
                  <p>{row.role || '未填写岗位'} · {new Date(row.updatedAt).toLocaleString('zh-CN')}</p>
                  <span className="small-note">
                    {audio ? `${(audio.bytes / 1024 / 1024).toFixed(1)} MB 本地音频` : `${row.transcript.length.toLocaleString()} 字面试记录`}
                  </span>
                </div>
                <div className="button-row">
                  {audio && audio.bytes > 0 && (
                    <button
                      className="icon-button"
                      aria-label={`下载 ${row.candidate || '未命名面试'} 录音`}
                      disabled={pending}
                      onClick={() =>
                        void act(async () => {
                          const blob = await localStore().readAudio(row.id);
                          if (!blob) throw new Error('录音无法读取');
                          download(blob, `${(row.candidate || '面试').replace(/[\\/:*?"<>|]/g, '_')}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
                        })
                      }
                    >
                      <Download size={16} />
                    </button>
                  )}
                  <button className="icon-button" aria-label={`删除 ${row.candidate || '未命名面试'} 记录`} disabled={pending} onClick={() => onDelete(row.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}
