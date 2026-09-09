'use client';

import {
  ClipboardList,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SIDEBAR_BREAKPOINT,
  SIDEBAR_STORAGE_KEY,
  parseSidebarCollapsed,
} from '@/lib/interview-sidebar';
import type { SavedInterview } from '@/lib/local/store';

type Props = {
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      setCollapsed(
        parseSidebarCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY)),
      );
    } catch {
      setCollapsed(false);
    }
    const media = window.matchMedia(
      `(max-width: ${SIDEBAR_BREAKPOINT - 1}px)`,
    );
    const update = () => {
      setCompact(media.matches);
      if (!media.matches) setOverlayOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

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
          {...props}
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
            {...props}
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
}: Props & {
  onCollapse: () => void;
  overlay?: boolean;
  panelRef?: React.Ref<HTMLElement>;
}) {
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
            return (
              <button
                key={session.id}
                className="interview-sidebar-record"
                aria-current={current ? 'page' : undefined}
                disabled={disabled}
                onClick={() => {
                  if (!current) onOpen(session.id);
                }}
              >
                <strong>{session.candidate || '未命名面试'}</strong>
                <span>{session.role || '未填写岗位'}</span>
                <time dateTime={new Date(session.updatedAt).toISOString()}>
                  {new Date(session.updatedAt).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </button>
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
