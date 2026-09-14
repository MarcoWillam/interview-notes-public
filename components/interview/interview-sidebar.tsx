'use client';

import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FolderInput,
  FolderOpen,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import {
  SIDEBAR_BREAKPOINT,
  SIDEBAR_STORAGE_KEY,
  groupInterviewSessions,
  interviewCreatedAt,
  moveManualInterview,
  parseCollapsedGroupIds,
  parseSidebarCollapsed,
  parseSidebarSortMode,
  reconcileManualOrder,
  sidebarGroupCollapsedStorageKey,
  sidebarOrderStorageKey,
  sidebarSortStorageKey,
  type InterviewSessionGroup,
  type SidebarSortMode,
} from '@/lib/interview-sidebar';
import type { InterviewGroup, SavedInterview } from '@/lib/local/store';
import type { InterviewWorkspace } from '@/lib/interview-sync';
import {
  interviewStatus,
  interviewStatusLabel,
  interviewStatusOptions,
  type InterviewStatus,
} from '@/lib/interview-status';

type SidebarStatusFilter = 'all' | InterviewStatus;

function sidebarStatusStorageKey(scope: string) {
  return `interview-sidebar-status:${encodeURIComponent(scope)}`;
}

function parseSidebarStatusFilter(value: string | null): SidebarStatusFilter {
  return value && interviewStatusOptions.some((item) => item.value === value)
    ? (value as InterviewStatus)
    : 'all';
}

type Props = {
  storageScope: string;
  sessions: SavedInterview[];
  groups: InterviewGroup[];
  currentId: string;
  disabled: boolean;
  saveStatus: string;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onManage: () => void;
  onCreateGroup: (name: string) => Promise<InterviewGroup>;
  onRenameGroup: (id: string, name: string) => Promise<InterviewGroup>;
  onDeleteGroup: (id: string) => Promise<void>;
  onMoveToGroup: (interviewId: string, groupId: string | null) => Promise<void>;
  workspacePreferences?: Pick<
    InterviewWorkspace,
    'sortMode' | 'manualOrder' | 'collapsedGroupIds'
  >;
  onWorkspacePreferencesChange?: (
    value: Pick<
      InterviewWorkspace,
      'sortMode' | 'manualOrder' | 'collapsedGroupIds'
    >,
  ) => void;
};

export function InterviewSidebar(props: Props) {
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SidebarSortMode>('newest');
  const [statusFilter, setStatusFilter] = useState<SidebarStatusFilter>('all');
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${SIDEBAR_BREAKPOINT - 1}px)`);
    const update = () => {
      setCompact(media.matches);
      if (!media.matches) setOverlayOpen(false);
    };
    const initialize = window.setTimeout(() => {
      try {
        setCollapsed(
          parseSidebarCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY)),
        );
        setSortMode(
          props.workspacePreferences?.sortMode ||
            parseSidebarSortMode(
              localStorage.getItem(sidebarSortStorageKey(props.storageScope)),
            ),
        );
        setStatusFilter(
          parseSidebarStatusFilter(
            localStorage.getItem(sidebarStatusStorageKey(props.storageScope)),
          ),
        );
        const storedOrder = JSON.parse(
          localStorage.getItem(sidebarOrderStorageKey(props.storageScope)) ||
            '[]',
        );
        setManualOrder(
          props.workspacePreferences?.manualOrder ||
            (Array.isArray(storedOrder)
            ? storedOrder.filter(
                (value): value is string => typeof value === 'string',
              )
            : []),
        );
        setCollapsedGroupIds(
          props.workspacePreferences?.collapsedGroupIds ||
            parseCollapsedGroupIds(
              localStorage.getItem(
                sidebarGroupCollapsedStorageKey(props.storageScope),
              ),
            ),
        );
      } catch {
        setCollapsed(false);
        setSortMode('newest');
        setStatusFilter('all');
        setManualOrder([]);
        setCollapsedGroupIds([]);
      }
      update();
    });
    media.addEventListener('change', update);
    return () => {
      window.clearTimeout(initialize);
      media.removeEventListener('change', update);
    };
  }, [props.storageScope]);

  useEffect(() => {
    if (!props.workspacePreferences) return;
    setSortMode(props.workspacePreferences.sortMode);
    setManualOrder(props.workspacePreferences.manualOrder);
    setCollapsedGroupIds(props.workspacePreferences.collapsedGroupIds);
  }, [props.workspacePreferences]);

  function publishWorkspace(
    next: Partial<
      Pick<InterviewWorkspace, 'sortMode' | 'manualOrder' | 'collapsedGroupIds'>
    >,
  ) {
    props.onWorkspacePreferencesChange?.({
      sortMode,
      manualOrder,
      collapsedGroupIds,
      ...next,
    });
  }

  const reconciledManualOrder = useMemo(
    () => reconcileManualOrder(manualOrder, props.sessions),
    [manualOrder, props.sessions],
  );
  const visibleSessions = useMemo(
    () =>
      statusFilter === 'all'
        ? props.sessions
        : props.sessions.filter(
            (session) => interviewStatus(session) === statusFilter,
          ),
    [props.sessions, statusFilter],
  );
  const groupedSessions = useMemo(
    () =>
      groupInterviewSessions(
        visibleSessions,
        props.groups,
        sortMode,
        reconciledManualOrder,
      ),
    [props.groups, visibleSessions, reconciledManualOrder, sortMode],
  );

  const focusSidebarTrigger = useCallback(() => {
    queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlayOpen(false);
    focusSidebarTrigger();
  }, [focusSidebarTrigger]);

  useEffect(() => {
    if (!compact || !overlayOpen) return;
    overlayRef.current
      ?.querySelector<HTMLElement>('button:not(:disabled)')
      ?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeOverlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeOverlay, compact, overlayOpen]);

  function setWideCollapsed(next: boolean) {
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      // The layout still works when browser preference storage is unavailable.
    }
  }

  function changeSortMode(next: SidebarSortMode) {
    setSortMode(next);
    publishWorkspace({ sortMode: next });
    try {
      localStorage.setItem(sidebarSortStorageKey(props.storageScope), next);
    } catch {
      // The selected mode remains active for this page session.
    }
  }

  function changeStatusFilter(next: SidebarStatusFilter) {
    setStatusFilter(next);
    try {
      localStorage.setItem(sidebarStatusStorageKey(props.storageScope), next);
    } catch {
      // The selected status remains active for this page session.
    }
  }

  function changeManualOrder(next: string[]) {
    setManualOrder(next);
    publishWorkspace({ manualOrder: next });
    try {
      localStorage.setItem(
        sidebarOrderStorageKey(props.storageScope),
        JSON.stringify(next),
      );
    } catch {
      // Drag and keyboard ordering still works for this page session.
    }
  }

  function toggleGroup(groupId: string) {
    const next = collapsedGroupIds.includes(groupId)
      ? collapsedGroupIds.filter((id) => id !== groupId)
      : [...collapsedGroupIds, groupId];
    setCollapsedGroupIds(next);
    publishWorkspace({ collapsedGroupIds: next });
    try {
      localStorage.setItem(
        sidebarGroupCollapsedStorageKey(props.storageScope),
        JSON.stringify(next),
      );
    } catch {
      // Group collapse still works for this page session.
    }
  }

  const panelProps = {
    ...props,
    sections: groupedSessions,
    sortMode,
    statusFilter,
    manualOrder: reconciledManualOrder,
    collapsedGroupIds,
    onSortModeChange: changeSortMode,
    onStatusFilterChange: changeStatusFilter,
    onManualOrderChange: changeManualOrder,
    onToggleGroup: toggleGroup,
  };

  const railVisible = compact || collapsed;
  return (
    <>
      {railVisible && (
        <nav className="interview-sidebar-rail" aria-label="面试记录快捷操作">
          <button
            ref={triggerRef}
            className="sidebar-icon-button"
            aria-label="展开面试记录"
            aria-expanded={compact ? overlayOpen : !collapsed}
            onClick={() => {
              if (compact) setOverlayOpen(true);
              else setWideCollapsed(false);
            }}
          >
            <PanelLeftOpen size={19} />
          </button>
          <button
            className="sidebar-icon-button"
            aria-label="新的面试"
            title="新的面试"
            disabled={props.disabled}
            onClick={props.onCreate}
          >
            <Plus size={19} />
          </button>
          <span className="sidebar-rail-spacer" />
          <button
            className="sidebar-icon-button"
            aria-label="记录管理"
            title="记录管理"
            disabled={props.disabled}
            onClick={props.onManage}
          >
            <FolderOpen size={18} />
          </button>
        </nav>
      )}

      {!compact && !collapsed && (
        <SidebarPanel
          {...panelProps}
          onCollapse={() => setWideCollapsed(true)}
        />
      )}

      {compact && overlayOpen && (
        <div className="interview-sidebar-overlay">
          <button
            className="interview-sidebar-backdrop"
            aria-label="关闭面试记录"
            onClick={closeOverlay}
          />
          <SidebarPanel
            {...panelProps}
            panelRef={overlayRef}
            overlay
            onCollapse={closeOverlay}
            onCreate={() => {
              props.onCreate();
              closeOverlay();
            }}
            onOpen={(id) => {
              props.onOpen(id);
              closeOverlay();
            }}
            onManage={() => {
              props.onManage();
              closeOverlay();
            }}
          />
        </div>
      )}
    </>
  );
}

function SidebarPanel({
  sessions,
  groups,
  currentId,
  disabled,
  saveStatus,
  onCreate,
  onOpen,
  onManage,
  onCollapse,
  overlay = false,
  panelRef,
  sections,
  sortMode,
  statusFilter,
  manualOrder,
  collapsedGroupIds,
  onSortModeChange,
  onStatusFilterChange,
  onManualOrderChange,
  onToggleGroup,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveToGroup,
}: Props & {
  onCollapse: () => void;
  overlay?: boolean;
  panelRef?: React.Ref<HTMLElement>;
  sections: InterviewSessionGroup[];
  sortMode: SidebarSortMode;
  statusFilter: SidebarStatusFilter;
  manualOrder: string[];
  collapsedGroupIds: string[];
  onSortModeChange: (mode: SidebarSortMode) => void;
  onStatusFilterChange: (status: SidebarStatusFilter) => void;
  onManualOrderChange: (order: string[]) => void;
  onToggleGroup: (groupId: string) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupAction, setGroupAction] = useState<{
    id: string;
    mode: 'menu' | 'rename' | 'delete';
  } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [groupError, setGroupError] = useState('');

  async function runGroupAction(action: () => Promise<unknown>) {
    setGroupError('');
    try {
      await action();
      return true;
    } catch (error) {
      setGroupError(
        error instanceof Error ? error.message : '分组操作失败，请重试',
      );
      return false;
    }
  }

  function moveWithKeyboard(
    id: string,
    offset: -1 | 1,
    sectionSessions: SavedInterview[],
  ) {
    const sectionIndex = sectionSessions.findIndex((row) => row.id === id);
    const target = sectionSessions[sectionIndex + offset];
    if (sectionIndex < 0 || !target) return;
    const index = manualOrder.indexOf(id);
    const targetIndex = manualOrder.indexOf(target.id);
    if (index < 0 || targetIndex < 0) return;
    const next = [...manualOrder];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onManualOrderChange(next);
  }

  function normalizedGroupId(session: SavedInterview) {
    return session.groupId && groups.some(({ id }) => id === session.groupId)
      ? session.groupId
      : null;
  }

  function renderSession(
    session: SavedInterview,
    section: InterviewSessionGroup,
  ) {
    const current = session.id === currentId;
    const status = interviewStatus(session);
    const createdAt = interviewCreatedAt(session);
    const sessionGroupId = normalizedGroupId(session);
    const moveMenuOpen = movingId === session.id;
    return (
      <div
        key={session.id}
        className={`interview-sidebar-record-row${
          draggedId === session.id ? ' is-dragging' : ''
        }`}
        onDragOver={(event) => {
          if (sortMode === 'manual') event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (sortMode !== 'manual') return;
          const activeId =
            draggedId || event.dataTransfer.getData('text/plain');
          const active = sessions.find((row) => row.id === activeId);
          if (!active || normalizedGroupId(active) !== sessionGroupId) return;
          onManualOrderChange(
            moveManualInterview(manualOrder, activeId, session.id),
          );
          setDraggedId(null);
        }}
      >
        <button
          className="interview-sidebar-record"
          aria-current={current ? 'page' : undefined}
          disabled={disabled}
          onClick={() => {
            setMovingId(null);
            if (!current) onOpen(session.id);
          }}
        >
          <span className="interview-sidebar-record-heading">
            <strong>{session.candidate || '未命名面试'}</strong>
            <span className="interview-status-badge" data-status={status}>
              {interviewStatusLabel(status)}
            </span>
          </span>
          <span>{session.role || '未填写岗位'}</span>
          <time dateTime={new Date(createdAt).toISOString()} title="添加时间">
            {new Date(createdAt).toLocaleString('zh-CN', {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </button>
        <div className="interview-sidebar-record-actions">
          <button
            type="button"
            className="interview-sidebar-row-action"
            disabled={disabled}
            aria-label={`移动${session.candidate || '未命名面试'}到分组`}
            title="移动到分组"
            aria-expanded={moveMenuOpen}
            onClick={() => {
              setGroupError('');
              setMovingId(moveMenuOpen ? null : session.id);
              setGroupAction(null);
            }}
          >
            <FolderInput size={15} />
          </button>
          {sortMode === 'manual' && (
            <button
              type="button"
              className="interview-sidebar-drag-handle"
              draggable={sortMode === 'manual'}
              disabled={disabled}
              aria-label={`调整${session.candidate || '未命名面试'}顺序`}
              title="拖动排序，也可使用上下方向键"
              onDragStart={(event) => {
                setDraggedId(session.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', session.id);
              }}
              onDragEnd={() => setDraggedId(null)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveWithKeyboard(session.id, -1, section.sessions);
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveWithKeyboard(session.id, 1, section.sessions);
                }
              }}
            >
              <GripVertical size={16} />
            </button>
          )}
        </div>
        {moveMenuOpen && (
          <div className="interview-sidebar-move-menu">
            <label htmlFor={`move-interview-${session.id}`}>移动到分组</label>
            <NativeSelect
              id={`move-interview-${session.id}`}
              className="interview-sidebar-group-select"
              size="sm"
              value={sessionGroupId || ''}
              disabled={disabled}
              onChange={async (event) => {
                const groupId = event.currentTarget.value || null;
                if (groupId === sessionGroupId) {
                  setMovingId(null);
                  return;
                }
                if (
                  await runGroupAction(() => onMoveToGroup(session.id, groupId))
                )
                  setMovingId(null);
              }}
            >
              <option value="">未分组</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>
    );
  }

  return (
    <aside
      ref={panelRef}
      className={`interview-sidebar-panel${overlay ? ' is-overlay' : ''}`}
      aria-label="本地面试记录"
    >
      <div className="interview-sidebar-heading">
        <span>
          <ClipboardList size={17} />
          面试记录
        </span>
        <button
          className="sidebar-icon-button"
          aria-label={overlay ? '关闭面试记录' : '收起面试记录'}
          onClick={onCollapse}
        >
          <PanelLeftClose size={18} />
        </button>
      </div>
      <label
        className="interview-sidebar-sort"
        htmlFor="interview-sidebar-sort"
      >
        <span>排序</span>
        <NativeSelect
          className="interview-sidebar-sort-control"
          size="sm"
          id="interview-sidebar-sort"
          aria-label="记录排序"
          value={sortMode}
          onChange={(event) =>
            onSortModeChange(parseSidebarSortMode(event.currentTarget.value))
          }
        >
          <option value="newest">最近添加</option>
          <option value="oldest">最早添加</option>
          <option value="manual">自定义排序</option>
        </NativeSelect>
      </label>
      <label
        className="interview-sidebar-sort interview-sidebar-status-filter"
        htmlFor="interview-sidebar-status-filter"
      >
        <span>状态</span>
        <NativeSelect
          className="interview-sidebar-sort-control"
          size="sm"
          id="interview-sidebar-status-filter"
          aria-label="面试状态筛选"
          value={statusFilter}
          onChange={(event) =>
            onStatusFilterChange(
              parseSidebarStatusFilter(event.currentTarget.value),
            )
          }
        >
          <option value="all">全部状态</option>
          {interviewStatusOptions.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <button
        className="interview-sidebar-create"
        disabled={disabled}
        onClick={onCreate}
      >
        <Plus size={16} />
        新的面试
      </button>
      <button
        className="interview-sidebar-add-group"
        disabled={disabled}
        aria-expanded={newGroupOpen}
        onClick={() => {
          setNewGroupOpen((open) => !open);
          setGroupAction(null);
          setMovingId(null);
          setGroupError('');
        }}
      >
        <FolderPlus size={15} />
        新建分组
      </button>
      {newGroupOpen && (
        <form
          className="interview-sidebar-group-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await runGroupAction(() => onCreateGroup(newGroupName))) {
              setNewGroupName('');
              setNewGroupOpen(false);
            }
          }}
        >
          <label htmlFor="interview-sidebar-new-group">分组名称</label>
          <div>
            <input
              id="interview-sidebar-new-group"
              value={newGroupName}
              maxLength={40}
              placeholder="例如：2027 届校招"
              onChange={(event) => setNewGroupName(event.currentTarget.value)}
            />
            <button type="submit" disabled={disabled} aria-label="保存新分组">
              <Check size={15} />
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-label="取消新建分组"
              onClick={() => {
                setNewGroupName('');
                setNewGroupOpen(false);
                setGroupError('');
              }}
            >
              <X size={15} />
            </button>
          </div>
        </form>
      )}
      {groupError && (
        <p className="interview-sidebar-group-error" role="alert">
          {groupError}
        </p>
      )}
      <div className="interview-sidebar-list" aria-label="本地面试列表">
        {sessions.length === 0 ? (
          <p className="interview-sidebar-empty">暂无本地记录</p>
        ) : (
          sections.map((section) => {
            const storageId = section.id || '__ungrouped__';
            const collapsed = collapsedGroupIds.includes(storageId);
            const showHeader = groups.length > 0;
            const actionOpen = groupAction?.id === section.id;
            return (
              <section
                key={storageId}
                className="interview-sidebar-group"
                aria-label={`${section.name}，${section.sessions.length} 条记录`}
              >
                {showHeader && (
                  <>
                    <div className="interview-sidebar-group-header">
                      <button
                        type="button"
                        className="interview-sidebar-group-toggle"
                        aria-expanded={!collapsed}
                        onClick={() => onToggleGroup(storageId)}
                      >
                        {collapsed ? (
                          <ChevronRight size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                        <strong>{section.name}</strong>
                        <span>{section.sessions.length}</span>
                      </button>
                      {section.id && (
                        <button
                          type="button"
                          className="interview-sidebar-group-more"
                          aria-label={`管理分组${section.name}`}
                          aria-expanded={actionOpen}
                          disabled={disabled}
                          onClick={() => {
                            setMovingId(null);
                            setGroupError('');
                            setGroupAction(
                              actionOpen
                                ? null
                                : { id: section.id!, mode: 'menu' },
                            );
                          }}
                        >
                          <MoreHorizontal size={15} />
                        </button>
                      )}
                    </div>
                    {section.id && actionOpen && (
                      <div className="interview-sidebar-group-actions">
                        {groupAction.mode === 'rename' ? (
                          <form
                            className="interview-sidebar-group-form"
                            onSubmit={async (event) => {
                              event.preventDefault();
                              if (
                                await runGroupAction(() =>
                                  onRenameGroup(section.id!, renameName),
                                )
                              )
                                setGroupAction(null);
                            }}
                          >
                            <label htmlFor={`rename-group-${section.id}`}>
                              重命名
                            </label>
                            <div>
                              <input
                                id={`rename-group-${section.id}`}
                                value={renameName}
                                maxLength={40}
                                onChange={(event) =>
                                  setRenameName(event.currentTarget.value)
                                }
                              />
                              <button
                                type="submit"
                                disabled={disabled}
                                aria-label="保存分组名称"
                              >
                                <Check size={15} />
                              </button>
                              <button
                                type="button"
                                disabled={disabled}
                                aria-label="取消重命名"
                                onClick={() => setGroupAction(null)}
                              >
                                <X size={15} />
                              </button>
                            </div>
                          </form>
                        ) : groupAction.mode === 'delete' ? (
                          <div className="interview-sidebar-delete-group">
                            <p>删除分组后，记录将移回“未分组”。</p>
                            <div>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={async () => {
                                  if (
                                    await runGroupAction(() =>
                                      onDeleteGroup(section.id!),
                                    )
                                  )
                                    setGroupAction(null);
                                }}
                              >
                                确认删除
                              </button>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => setGroupAction(null)}
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                setRenameName(section.name);
                                setGroupAction({
                                  id: section.id!,
                                  mode: 'rename',
                                });
                              }}
                            >
                              <Pencil size={14} /> 重命名
                            </button>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() =>
                                setGroupAction({
                                  id: section.id!,
                                  mode: 'delete',
                                })
                              }
                            >
                              <Trash2 size={14} /> 删除分组
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
                {!collapsed && (
                  <div className="interview-sidebar-group-records">
                    {section.sessions.length ? (
                      section.sessions.map((session) =>
                        renderSession(session, section),
                      )
                    ) : (
                      <p className="interview-sidebar-group-empty">暂无记录</p>
                    )}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
      <div className="interview-sidebar-footer">
        <span>{saveStatus}</span>
        <button disabled={disabled} onClick={onManage}>
          <FolderOpen size={16} />
          记录管理
        </button>
      </div>
    </aside>
  );
}
