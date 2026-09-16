'use client';

import { useEffect, useMemo, useState } from 'react';
import { Cloud, CopyPlus, GitCompareArrows, RotateCcw } from 'lucide-react';
import type { SavedInterview, InterviewConflict } from '@/lib/local/store';
import type {
  InterviewVersion,
  InterviewVersionSummary,
  PendingInterviewResult,
} from '@/lib/interview-sync';
import type { CloudInterviewSummary, CloudVersionReason } from '@/lib/cloud-interview';
import { changedInterviewSections } from '@/lib/interview-history';

const reasonLabels: Record<CloudVersionReason, string> = {
  'resume-read': '完成简历阅读',
  'outline-generated': '生成面试提纲',
  'outline-regenerated': '重新生成提纲',
  'follow-up-outline-generated': '生成补充追问',
  'follow-up-outline-deleted': '删除补充追问',
  'second-round-material-imported': '导入复试资料',
  'second-round-outline-generated': '生成复试提纲',
  'second-round-outline-regenerated': '重新生成复试提纲',
  'second-round-assessment-generated': '生成复试评估',
  'transcript-imported': '导入面试记录',
  'work-sample-analyzed': '完成作品分析',
  'written-test-supplemented': '补充笔试问题',
  'assessment-generated': '生成结论评估',
  'manually-confirmed': '人工确认结论',
  'periodic-edit': '编辑保存',
  restored: '恢复历史版本',
};

function VersionPreview({ value }: { value: InterviewVersion }) {
  const record = value.record;
  return (
    <div className="history-preview">
      <strong>{record.candidate || '未命名面试'}</strong>
      <span>{record.role || '未填写岗位'}</span>
      <p>
        {record.transcript
          ? `面试记录 ${record.transcript.length.toLocaleString()} 字`
          : '尚未导入面试记录'}
        {' · '}
        {record.report ? '已有结论评估' : '尚未生成结论评估'}
      </p>
    </div>
  );
}

export function InterviewHistory({
  current,
  loadVersions,
  loadVersion,
  restoreVersion,
  pending,
}: {
  current?: SavedInterview;
  loadVersions: () => Promise<InterviewVersionSummary[]>;
  loadVersion: (revision: number) => Promise<InterviewVersion>;
  restoreVersion: (revision: number) => Promise<void>;
  pending: boolean;
}) {
  const [versions, setVersions] = useState<InterviewVersionSummary[]>([]);
  const [preview, setPreview] = useState<InterviewVersion | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void loadVersions()
      .then((rows) => active && setVersions(rows))
      .catch((reason: unknown) =>
        active && setError(reason instanceof Error ? reason.message : '版本读取失败'),
      );
    return () => {
      active = false;
    };
  }, [loadVersions]);
  const changed = useMemo(
    () =>
      preview && current
        ? changedInterviewSections(current, preview.record)
        : [],
    [current, preview],
  );
  if (!current) return <p className="library-empty">请先打开一份面试记录。</p>;
  return (
    <div className="history-layout">
      {error && <p className="message error">{error}</p>}
      <div className="history-list">
        {versions.length === 0 ? (
          <p className="library-empty">还没有可恢复的关键版本。</p>
        ) : (
          versions.map((version) => (
            <button
              key={`${version.revision}-${version.createdAt}`}
              className="history-version"
              data-active={preview?.revision === version.revision || undefined}
              disabled={pending}
              onClick={() =>
                void loadVersion(version.revision)
                  .then(setPreview)
                  .catch((reason: unknown) =>
                    setError(reason instanceof Error ? reason.message : '版本读取失败'),
                  )
              }
            >
              <strong>{reasonLabels[version.reason]}</strong>
              <span>{new Date(version.createdAt).toLocaleString('zh-CN')}</span>
            </button>
          ))
        )}
      </div>
      <div className="history-detail">
        {preview ? (
          <>
            <VersionPreview value={preview} />
            <p className="small-note">
              {changed.length ? `与当前版本不同：${changed.join('、')}` : '内容与当前版本一致'}
            </p>
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => void restoreVersion(preview.revision)}
            >
              <RotateCcw size={15} /> 恢复为新版本
            </button>
          </>
        ) : (
          <p className="library-empty">选择左侧版本后可预览再恢复。</p>
        )}
      </div>
    </div>
  );
}

export function InterviewConflicts({
  conflicts,
  resolve,
  pending,
}: {
  conflicts: InterviewConflict[];
  resolve: (
    id: string,
    action: 'keep-cloud' | 'duplicate-local' | 'replace-cloud',
  ) => Promise<void>;
  pending: boolean;
}) {
  if (!conflicts.length)
    return <p className="library-empty">没有需要处理的同步冲突。</p>;
  return (
    <div className="conflict-list">
      {conflicts.map((conflict) => {
        const changed = changedInterviewSections(
          conflict.local,
          conflict.remote,
        );
        return (
          <article className="conflict-card" key={conflict.id}>
            <div className="conflict-heading">
              <GitCompareArrows size={17} />
              <strong>{conflict.local.candidate || '未命名面试'}</strong>
            </div>
            <p>云端在本机编辑期间产生了新版本，本地副本已完整保留。</p>
            <span className="small-note">
              可能变化的区块：{changed.length ? changed.join('、') : '记录内容'}
            </span>
            <div className="button-row">
              <button disabled={pending} className="text-button" onClick={() => void resolve(conflict.id, 'keep-cloud')}>
                <Cloud size={14} /> 保留云端
              </button>
              <button disabled={pending} className="secondary-button" onClick={() => void resolve(conflict.id, 'duplicate-local')}>
                <CopyPlus size={14} /> 本地副本另存
              </button>
              <button disabled={pending} className="secondary-button" onClick={() => void resolve(conflict.id, 'replace-cloud')}>
                用本地副本更新云端
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function InterviewTrash({
  rows,
  restore,
  pending,
}: {
  rows: CloudInterviewSummary[];
  restore: (row: CloudInterviewSummary) => Promise<void>;
  pending: boolean;
}) {
  if (!rows.length)
    return <p className="library-empty">回收站为空。删除的记录会保留 30 天。</p>;
  return (
    <div className="local-list">
      {rows.map((row) => (
        <article key={row.id} className="local-row">
          <div>
            <strong>{row.candidate || '未命名面试'}</strong>
            <p>{row.role || '未填写岗位'}</p>
            <span className="small-note">
              删除于 {new Date(row.deletedAt || row.updatedAt).toLocaleString('zh-CN')}
            </span>
          </div>
          <button className="secondary-button" disabled={pending} onClick={() => void restore(row)}>
            <RotateCcw size={15} /> 恢复
          </button>
        </article>
      ))}
    </div>
  );
}

const resultKindLabels: Record<string, string> = {
  resume: '简历阅读与提纲',
  'written-test': '笔试复盘补充',
  'work-sample': '作品分析',
  outline: '重新生成提纲',
  interview: '结论评估',
};

export function InterviewPendingResults({
  rows,
  apply,
  discard,
  pending,
}: {
  rows: PendingInterviewResult[];
  apply: (row: PendingInterviewResult) => Promise<void>;
  discard: (row: PendingInterviewResult) => Promise<void>;
  pending: boolean;
}) {
  const active = rows.filter((row) => row.state === 'pending');
  if (!active.length)
    return <p className="library-empty">当前记录没有待确认的 Codex 结果。</p>;
  return (
    <div className="conflict-list">
      {active.map((row) => (
        <article className="conflict-card" key={row.jobId}>
          <strong>{resultKindLabels[row.kind] || 'Codex 分析结果'}</strong>
          <p>分析期间相关资料发生变化，因此结果没有直接覆盖当前记录。</p>
          <span className="small-note">
            完成于 {new Date(row.updatedAt).toLocaleString('zh-CN')}
          </span>
          <div className="button-row">
            <button className="text-button" disabled={pending} onClick={() => void discard(row)}>
              放弃结果
            </button>
            <button className="secondary-button" disabled={pending} onClick={() => void apply(row)}>
              确认并应用
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
