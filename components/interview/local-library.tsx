'use client';
import { useRef, useState } from 'react';
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
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Download, Trash2, FolderOpen, X } from 'lucide-react';
import type { useInterviewLibrary } from '@/hooks/use-interview-library';
import { localStore } from '@/lib/local/store';
type Library = ReturnType<typeof useInterviewLibrary>;
export function LocalLibrary({
  open,
  onClose,
  library,
  onError,
  download,
  canSwitch,
  assertIdle,
}: {
  open: boolean;
  onClose: () => void;
  library: Library;
  onError: (message: string) => void;
  download: (blob: Blob, name: string) => void;
  canSwitch: boolean;
  assertIdle: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  async function act(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError('');
    try {
      assertIdle();
      await task();
    } catch (e) {
      const message = e instanceof Error ? e.message : '本地操作失败';
      setError(message);
      onError(message);
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v && !pending) onClose();
        }}
      >
        <DialogContent className="library-dialog" showCloseButton={false}>
          <div className="dialog-heading">
            <DialogTitle>这台电脑上的面试</DialogTitle>
            <button
              className="icon-button"
              aria-label="关闭本地记录"
              disabled={pending}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
          <DialogDescription>
            保存在当前浏览器，不占本站服务器存储。换设备或清除站点数据后无法访问，请导出重要记录备份。
          </DialogDescription>
          {error && (
            <p className="message error" role="alert">
              {error}
            </p>
          )}
          {!canSwitch && (
            <p className="small-note">
              当前录音尚未完整保存；请关闭此窗口下载备份或重试保存后再打开其他面试。仍可删除旧记录释放空间。
            </p>
          )}
          <div className="storage-overview">
            <span>
              站点约占用 {(library.storage.usage / 1024 / 1024).toFixed(1)} MB
            </span>
            <button
              className="text-button"
              disabled={pending || library.storage.persistent}
              onClick={() => void act(library.persist)}
            >
              {library.storage.persistent ? '已启用持久保存' : '申请持久保存'}
            </button>
          </div>
          <p className="small-note">
            浏览器可能拒绝持久保存申请；无痕窗口关闭后数据会被清除。保存期间请勿清除站点数据。
          </p>
          <div className="local-list">
            {library.sessions.length === 0 ? (
              <p>暂无本地记录。</p>
            ) : (
              library.sessions.map((row) => {
                const audio = library.audio.find((a) => a.id === row.id);
                return (
                  <article key={row.id} className="local-row">
                    <div>
                      <strong>
                        {row.candidate || '未命名面试'}
                        {row.id === library.id && (
                          <span className="badge">当前</span>
                        )}
                      </strong>
                      <p>
                        {row.role || '未填写岗位'} ·{' '}
                        {new Date(row.updatedAt).toLocaleString('zh-CN')}
                      </p>
                      <span className="small-note">
                        {audio
                          ? `${(audio.bytes / 1024 / 1024).toFixed(1)} MB 音频 · ${audio.complete ? '录音已完整保存' : '中断或部分录音'}`
                          : `${row.transcript.length.toLocaleString()} 字面试记录`}
                      </span>
                    </div>
                    <div className="button-row">
                      <button
                        className="secondary-button"
                        disabled={
                          pending || !canSwitch || row.id === library.id
                        }
                        onClick={() =>
                          void act(async () => {
                            await library.open(row.id);
                            onClose();
                          })
                        }
                      >
                        <FolderOpen size={14} />
                        打开
                      </button>
                      {audio && audio.bytes > 0 && (
                        <button
                          className="icon-button"
                          aria-label={`下载 ${row.candidate || '未命名面试'} 录音`}
                          disabled={pending}
                          onClick={() =>
                            void act(async () => {
                              const blob = await localStore().readAudio(row.id);
                              if (!blob) throw new Error('录音无法读取');
                              download(
                                blob,
                                `${(row.candidate || '面试').replace(/[\\/:*?"<>|]/g, '_')}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`,
                              );
                            })
                          }
                        >
                          <Download size={16} />
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={`删除 ${row.candidate || '未命名面试'} 本地记录`}
                        disabled={pending}
                        onClick={() => setDeleting(row.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>删除这场本地面试？</AlertDialogTitle>
          <AlertDialogDescription>
            将删除这场面试的简历文字、对话、结论和本地录音。已下载的文件和偏好模板会保留。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = deleting!;
                setDeleting(null);
                void act(() => library.remove(id));
              }}
            >
              删除本地记录
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
