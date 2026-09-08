'use client';
import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Settings2 } from 'lucide-react';
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
import { normalizeStandards, type GlobalSettings } from '@/lib/standards';
import type { Preference } from '@/lib/local/store';
import { StandardsFields } from './standards-fields';

export function GlobalPreferences({
  initialSettings,
  initialTemplates,
  onSave,
  onClose,
}: {
  initialSettings: GlobalSettings;
  initialTemplates: Preference[];
  onSave: (settings: GlobalSettings, templates: Preference[]) => Promise<void>;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState(() =>
    structuredClone(initialSettings),
  );
  const [templates, setTemplates] = useState(() =>
    structuredClone(initialTemplates),
  );
  const [selected, setSelected] = useState('');
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify([initialSettings, initialTemplates]),
  );
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [discard, setDiscard] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const dirty = baseline !== JSON.stringify([settings, templates]);
  const template = templates.find((p) => p.id === selected);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function close() {
    if (running.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  function updateTemplate(value: Preference) {
    setTemplates((items) => items.map((p) => (p.id === value.id ? value : p)));
    setNotice('');
  }
  async function save() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      await onSave(settings, templates);
      setBaseline(JSON.stringify([settings, templates]));
      setNotice(
        '全局设置已保存，下次新建面试时生效。当前面试及历史记录保持原标准。',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '全局设置保存失败，请重试');
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(v) => {
          if (!v) close();
        }}
      >
        <DialogContent className="global-dialog" showCloseButton={false}>
          <div className="dialog-heading">
            <DialogTitle>
              <Settings2 size={20} /> 全局面试设置
            </DialogTitle>
            <button
              className="icon-button"
              aria-label="关闭全局设置"
              onClick={close}
              disabled={pending}
            >
              <X size={18} />
            </button>
          </div>
          <DialogDescription>
            统一管理岗位模板与通用标准，仅保存在当前浏览器。每场面试使用独立快照，修改全局设置不会改动历史结论。
          </DialogDescription>
          <fieldset disabled={pending} className="global-settings-body">
            <label className="default-template-field">
              新面试默认使用
              <select
                value={settings.defaultTemplateId || ''}
                onChange={(e) => {
                  setSettings({
                    ...settings,
                    defaultTemplateId: e.target.value || null,
                  });
                  setNotice('');
                }}
              >
                <option value="">通用默认标准（岗位留空）</option>
                {templates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || '未命名模板'}
                  </option>
                ))}
              </select>
            </label>
            <p className="small-note">
              选中岗位模板后，新面试使用该模板的完整标准；不选模板则使用下面的通用标准。
            </p>
            <div className="global-editor-grid">
              <nav className="template-navigation" aria-label="全局偏好分类">
                <button
                  className={!selected ? 'selected' : ''}
                  onClick={() => setSelected('')}
                >
                  通用默认标准
                </button>
                <p>岗位模板</p>
                {templates.map((p) => (
                  <button
                    key={p.id}
                    className={selected === p.id ? 'selected' : ''}
                    onClick={() => setSelected(p.id)}
                  >
                    {p.name || '未命名模板'}
                    {settings.defaultTemplateId === p.id && (
                      <span className="badge">默认</span>
                    )}
                  </button>
                ))}
                <button
                  onClick={() => {
                    const id = crypto.randomUUID();
                    setTemplates([
                      ...templates,
                      {
                        ...normalizeStandards(settings.defaults),
                        id,
                        name: '',
                        role: '',
                        requirements: '',
                      },
                    ]);
                    setSelected(id);
                    setNotice('');
                  }}
                >
                  <Plus size={15} /> 新建岗位模板
                </button>
              </nav>
              <section className="global-editor-fields">
                <div className="dialog-heading">
                  <h3>{template ? '编辑岗位模板' : '通用默认标准'}</h3>
                  {template && (
                    <button
                      className="icon-button"
                      aria-label="删除当前模板"
                      onClick={() => setDeleting(template.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                {template ? (
                  <>
                    <label>
                      模板名称
                      <input
                        maxLength={80}
                        value={template.name}
                        onChange={(e) =>
                          updateTemplate({ ...template, name: e.target.value })
                        }
                        placeholder="例如：产品经理 · 一面"
                      />
                    </label>
                    <StandardsFields
                      value={normalizeStandards(template)}
                      onChange={(value) =>
                        updateTemplate({
                          ...value,
                          id: template.id,
                          name: template.name,
                        })
                      }
                    />
                  </>
                ) : (
                  <StandardsFields
                    includeRole={false}
                    value={settings.defaults}
                    onChange={(defaults) => {
                      setSettings({ ...settings, defaults });
                      setNotice('');
                    }}
                  />
                )}
              </section>
            </div>
          </fieldset>
          {error && (
            <p className="message error" role="alert">
              {error}
            </p>
          )}
          {notice && <output className="message">{notice}</output>}
          <div className="global-settings-footer">
            <span className="small-note">
              {dirty ? '有未保存的修改' : '设置已保存'} · 不影响当前面试
            </span>
            <button
              className="primary-button"
              disabled={pending || !dirty}
              onClick={() => void save()}
            >
              {pending ? '正在保存…' : '保存全局设置'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogTitle>放弃未保存的设置？</AlertDialogTitle>
          <AlertDialogDescription>
            此次修改尚未生效，已保存的模板和面试记录会保留。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>
              放弃修改并关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>移除这个岗位模板？</AlertDialogTitle>
          <AlertDialogDescription>
            保存全局设置后生效，历史面试不受影响。若它是默认模板，新面试将回退到通用标准。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setTemplates(templates.filter((p) => p.id !== deleting));
                if (settings.defaultTemplateId === deleting)
                  setSettings({ ...settings, defaultTemplateId: null });
                setSelected('');
                setDeleting(null);
                setNotice('');
              }}
            >
              移除模板
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
