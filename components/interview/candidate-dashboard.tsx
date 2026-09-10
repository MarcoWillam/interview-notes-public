'use client';

import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import {
  interviewStatus,
  interviewStatusLabel,
  interviewStatusOptions,
  type InterviewStatus,
} from '@/lib/interview-status';
import type { InterviewGroup, SavedInterview } from '@/lib/local/store';

type DashboardStatusFilter = 'all' | InterviewStatus;
type DashboardTimeFilter = 'all' | 'today' | '7-days' | '30-days';

type Props = {
  sessions: SavedInterview[];
  groups: InterviewGroup[];
  disabled: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
};

function timeCutoff(value: DashboardTimeFilter, now = new Date()) {
  if (value === 'all') return 0;
  if (value === 'today')
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = value === '7-days' ? 7 : 30;
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

export function CandidateDashboard({
  sessions,
  groups,
  disabled,
  onCreate,
  onOpen,
}: Props) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState<DashboardStatusFilter>('all');
  const [group, setGroup] = useState('all');
  const [time, setTime] = useState<DashboardTimeFilter>('all');
  const roleOptions = useMemo(
    () =>
      [...new Set(sessions.map((row) => row.role.trim()).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, 'zh-CN'),
      ),
    [sessions],
  );
  const counts = useMemo(() => {
    const result: Record<InterviewStatus, number> = {
      preparing: 0,
      'needs-review': 0,
      'needs-assessment': 0,
      'needs-confirmation': 0,
      completed: 0,
    };
    sessions.forEach((row) => result[interviewStatus(row)]++);
    return result;
  }, [sessions]);
  const groupNames = useMemo(
    () => new Map(groups.map((item) => [item.id, item.name])),
    [groups],
  );
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const cutoff = timeCutoff(time);
    return sessions
      .filter((row) => {
        const rowStatus = interviewStatus(row);
        if (
          normalizedQuery &&
          !`${row.candidate} ${row.role}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)
        )
          return false;
        if (role !== 'all' && row.role !== role) return false;
        if (status !== 'all' && rowStatus !== status) return false;
        if (group === 'ungrouped' && row.groupId) return false;
        if (group !== 'all' && group !== 'ungrouped' && row.groupId !== group)
          return false;
        return row.updatedAt >= cutoff;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }, [group, query, role, sessions, status, time]);

  const cards: Array<{
    label: string;
    value: number;
    filter: DashboardStatusFilter;
    icon: typeof Users;
  }> = [
    { label: '全部候选人', value: sessions.length, filter: 'all', icon: Users },
    {
      label: '待评估',
      value: counts['needs-assessment'],
      filter: 'needs-assessment',
      icon: ClipboardCheck,
    },
    {
      label: '待确认',
      value: counts['needs-confirmation'],
      filter: 'needs-confirmation',
      icon: CircleDot,
    },
    {
      label: '已完成',
      value: counts.completed,
      filter: 'completed',
      icon: CheckCircle2,
    },
  ];

  return (
    <main className="candidate-dashboard" aria-label="候选人看板">
      <div className="candidate-dashboard-heading">
        <div>
          <h1>候选人看板</h1>
          <p>汇总当前账号在这台设备上的面试进度。</p>
        </div>
        <button
          type="button"
          className="primary-button"
          disabled={disabled}
          onClick={onCreate}
        >
          <Plus size={16} /> 新的面试
        </button>
      </div>

      <section
        className="candidate-dashboard-cards"
        aria-label="候选人状态汇总"
      >
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              type="button"
              key={card.label}
              className="candidate-dashboard-card"
              aria-pressed={status === card.filter}
              onClick={() => setStatus(card.filter)}
            >
              <span>
                <Icon size={18} /> {card.label}
              </span>
              <strong>{card.value}</strong>
            </button>
          );
        })}
      </section>

      <section className="candidate-dashboard-list">
        <div className="candidate-dashboard-list-heading">
          <div>
            <h2>最近面试</h2>
            <p>共 {filtered.length} 条符合条件的记录</p>
          </div>
          <div className="candidate-dashboard-filters">
            <label className="candidate-dashboard-search">
              <span className="sr-only">搜索候选人</span>
              <Search size={15} />
              <input
                type="search"
                value={query}
                placeholder="搜索候选人"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <NativeSelect
              className="dashboard-filter-select"
              size="sm"
              aria-label="岗位"
              value={role}
              onChange={(event) => setRole(event.currentTarget.value)}
            >
              <option value="all">全部岗位</option>
              {roleOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="dashboard-filter-select"
              size="sm"
              aria-label="状态"
              value={status}
              onChange={(event) =>
                setStatus(event.currentTarget.value as DashboardStatusFilter)
              }
            >
              <option value="all">全部状态</option>
              {interviewStatusOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="dashboard-filter-select"
              size="sm"
              aria-label="分组"
              value={group}
              onChange={(event) => setGroup(event.currentTarget.value)}
            >
              <option value="all">全部分组</option>
              <option value="ungrouped">未分组</option>
              {groups.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="dashboard-filter-select"
              size="sm"
              aria-label="时间"
              value={time}
              onChange={(event) =>
                setTime(event.currentTarget.value as DashboardTimeFilter)
              }
            >
              <option value="all">全部时间</option>
              <option value="today">今天更新</option>
              <option value="7-days">近 7 天</option>
              <option value="30-days">近 30 天</option>
            </NativeSelect>
          </div>
        </div>

        {filtered.length ? (
          <div className="candidate-dashboard-table">
            <div className="candidate-dashboard-table-head">
              <span>候选人</span>
              <span>岗位</span>
              <span>状态</span>
              <span>分组</span>
              <span>最后更新</span>
              <span aria-hidden="true" />
            </div>
            {filtered.map((row) => {
              const rowStatus = interviewStatus(row);
              return (
                <button
                  type="button"
                  className="candidate-dashboard-row"
                  key={row.id}
                  disabled={disabled}
                  onClick={() => onOpen(row.id)}
                >
                  <strong>{row.candidate || '未命名面试'}</strong>
                  <span>{row.role || '未填写岗位'}</span>
                  <span>
                    <span
                      className="interview-status-badge"
                      data-status={rowStatus}
                    >
                      {interviewStatusLabel(rowStatus)}
                    </span>
                  </span>
                  <span>
                    {(row.groupId && groupNames.get(row.groupId)) || '未分组'}
                  </span>
                  <time dateTime={new Date(row.updatedAt).toISOString()}>
                    {new Date(row.updatedAt).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  <span className="candidate-dashboard-open" aria-hidden="true">
                    <ArrowRight size={16} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="candidate-dashboard-empty">
            <Users size={26} />
            <h3>
              {sessions.length ? '没有符合条件的记录' : '还没有候选人记录'}
            </h3>
            <p>
              {sessions.length
                ? '调整筛选条件后再查看。'
                : '创建一场面试后，候选人进度会显示在这里。'}
            </p>
            {!sessions.length && (
              <button
                type="button"
                className="secondary-button"
                disabled={disabled}
                onClick={onCreate}
              >
                <Plus size={15} /> 新的面试
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
