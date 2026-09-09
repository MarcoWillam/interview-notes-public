'use client';

import {
  ClipboardList,
  FolderOpen,
  GripVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import {
  SIDEBAR_BREAKPOINT,
  SIDEBAR_STORAGE_KEY,
  interviewCreatedAt,
  moveManualInterview,
  parseSidebarCollapsed,
  parseSidebarSortMode,
  reconcileManualOrder,
  sidebarOrderStorageKey,
  sidebarSortStorageKey,
  sortInterviewSessions,
  type SidebarSortMode,
} from '@/lib/interview-sidebar';
import type { SavedInterview } from '@/lib/local/store';

type Props = {
  storageScope: string;
  sessions: SavedInterview[];
  currentId: string;
  disabled: boolean;
  saveStatus: string;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onManage: () => void;
};

export function InterviewSidebar(props: Props) {
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SidebarSortMode>('newest');
  const [manualOrder, setManualOrder] = useState<string[]>([]);
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
          parseSidebarSortMode(
            localStorage.getItem(sidebarSortStorageKey(props.storageScope)),
          ),
        );
        const storedOrder = JSON.parse(
          localStorage.getItem(sidebarOrderStorageKey(props.storageScope)) ||
            '[]',
        );
        setManualOrder(
          Array.isArray(storedOrder)
            ? storedOrder.filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
        );
      } catch {
        setCollapsed(false);
        setSortMode('newest');
        setManualOrder([]);
      }
      update();
    });
    media.addEventListener('change', update);
    return () => {
      window.clearTimeout(initialize);
      media.removeEventListener('change', update);
    };
  }, [props.storageScope]);

  const reconciledManualOrder = useMemo(
    () => reconcileManualOrder(manualOrder, props.sessions),
    [manualOrder, props.sessions],
  );
  const displayedSessions = useMemo(
    () =>
      sortInterviewSessions(props.sessions, sortMode, reconciledManualOrder),
    [props.sessions, reconciledManualOrder, sortMode],
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
    try {
      localStorage.setItem(sidebarSortStorageKey(props.storageScope), next);
    } catch {
      // The selected mode remains active for this page session.
    }
  }

  function changeManualOrder(next: string[]) {
    setManualOrder(next);
    try {
      localStorage.setItem(
        sidebarOrderStorageKey(props.storageScope),
        JSON.stringify(next),
      );
    } catch {
      // Drag and keyboard ordering still works for this page session.
    }
  }

  const panelProps = {
    ...props,
    sessions: displayedSessions,
    sortMode,
    manualOrder: reconciledManualOrder,
    onSortModeChange: changeSortMode,
    onManualOrderChange: changeManualOrder,
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
  currentId,
  disabled,
  saveStatus,
  onCreate,
  onOpen,
  onManage,
  onCollapse,
  overlay = false,
  panelRef,
  sortMode,
  manualOrder,
  onSortModeChange,
  onManualOrderChange,
}: Props & {
  onCollapse: () => void;
  overlay?: boolean;
  panelRef?: React.Ref<HTMLElement>;
  sortMode: SidebarSortMode;
  manualOrder: string[];
  onSortModeChange: (mode: SidebarSortMode) => void;
  onManualOrderChange: (order: string[]) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  function moveWithKeyboard(id: string, offset: -1 | 1) {
    const index = manualOrder.indexOf(id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= manualOrder.length) return;
    const next = [...manualOrder];
    [next[index], next[target]] = [next[target], next[index]];
    onManualOrderChange(next);
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
      <button
        className="interview-sidebar-create"
        disabled={disabled}
        onClick={onCreate}
      >
        <Plus size={16} />
        新的面试
      </button>
      <div className="interview-sidebar-list" aria-label="本地面试列表">
        {sessions.length === 0 ? (
          <p className="interview-sidebar-empty">暂无本地记录</p>
        ) : (
          sessions.map((session) => {
            const current = session.id === currentId;
            const createdAt = interviewCreatedAt(session);
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
                    if (!current) onOpen(session.id);
                  }}
                >
                  <strong>{session.candidate || '未命名面试'}</strong>
                  <span>{session.role || '未填写岗位'}</span>
                  <time
                    dateTime={new Date(createdAt).toISOString()}
                    title="添加时间"
                  >
                    {new Date(createdAt).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
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
                        moveWithKeyboard(session.id, -1);
                      }
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        moveWithKeyboard(session.id, 1);
                      }
                    }}
                  >
                    <GripVertical size={16} />
                  </button>
                )}
              </div>
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
