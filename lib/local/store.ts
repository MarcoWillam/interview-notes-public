import {
  defaultStandards,
  normalizeStandards,
  validateStandards,
  type GlobalSettings,
  type InterviewStandards,
} from '../standards.ts';
import {
  BUILTIN_TEMPLATE_IDS,
  builtInRoleTemplates,
  replacementForLegacyBuiltInRoleTemplate,
  replacementForPreviousBuiltInRoleTemplate,
} from '../default-role-templates.ts';
export type SavedInterview = {
  id: string;
  groupId?: string | null;
  createdAt?: number;
  updatedAt: number;
  candidate: string;
  role: string;
  requirements: string;
  dimensionText: string;
  focus: string;
  resumeText: string;
  resumeName: string;
  /** Historical records only; current drafts no longer require verification. */
  resumeChecked?: boolean;
  resumeReading?: import('../resume-reading.ts').ResumeReading | null;
  transcript: string;
  transcriptName?: string;
  reviewed: boolean;
  report: import('../interview.ts').Report | null;
  conclusion: string;
  confirmed: boolean;
  scoringGuidance?: string;
  reportRequirements?: string;
  sourceTemplateId?: string | null;
  templateModified?: boolean;
  hasWrittenTest?: boolean;
  writtenTestConfirmed?: boolean;
  workSample?: import('../work-sample.ts').WorkSampleAssessment | null;
  workSampleJobId?: string;
};
export type InterviewGroup = {
  id: string;
  name: string;
  createdAt: number;
  order: number;
};
export type NewInterviewSeed = {
  standards: InterviewStandards;
  sourceTemplateId: string;
};
export type AudioRecord = {
  id: string;
  mimeType: string;
  bytes: number;
  seconds: number;
  complete: boolean;
  ended: boolean;
};
export type Preference = {
  id: string;
  name: string;
  role: string;
  requirements: string;
  dimensionText: string;
  focus: string;
  scoringGuidance?: string;
  reportRequirements?: string;
};
const builtInTemplateOrder = new Map<string, number>(
  builtInRoleTemplates.map(({ id }, index) => [id, index]),
);
function sortPreferences(templates: Preference[]) {
  return templates.sort((a, b) => {
    const left = builtInTemplateOrder.get(a.id);
    const right = builtInTemplateOrder.get(b.id);
    if (left !== undefined || right !== undefined)
      return (
        (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER)
      );
    return a.id.localeCompare(b.id);
  });
}
export function createLocalStore(
  factory: IDBFactory,
  name = 'interview-notes-local',
) {
  const connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 7);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('interviews', { keyPath: 'id' });
        db.createObjectStore('audio', { keyPath: 'id' });
        db.createObjectStore('preferences', { keyPath: 'id' });
        db.createObjectStore('chunks', {
          keyPath: ['id', 'sequence'],
        }).createIndex('session', 'id');
      }
      if (event.oldVersion < 2)
        db.createObjectStore('settings', { keyPath: 'id' });
      if (event.oldVersion < 5)
        db.createObjectStore('interviewGroups', { keyPath: 'id' });
      const migrateBuiltInTemplates = (addMissing: boolean) => {
        const preferences = request.transaction!.objectStore('preferences');
        for (const template of builtInRoleTemplates) {
          const existing = preferences.get(template.id);
          existing.onsuccess = () => {
            if (existing.result === undefined) {
              if (addMissing) preferences.add(template);
              return;
            }
            const replacement = replacementForLegacyBuiltInRoleTemplate(
              existing.result,
            );
            if (replacement) preferences.put(replacement);
          };
        }
      };
      if (event.oldVersion < 3) migrateBuiltInTemplates(true);
      else if (event.oldVersion < 4) {
        migrateBuiltInTemplates(false);
      }
      if (event.oldVersion < 6) {
        const transaction = request.transaction!;
        const preferences = transaction.objectStore('preferences');
        const settings = transaction.objectStore('settings');
        if (event.oldVersion >= 3) {
          const engineering = builtInRoleTemplates.find(
            ({ id }) => id === BUILTIN_TEMPLATE_IDS.aiEngineering,
          )!;
          const existing = preferences.get(engineering.id);
          existing.onsuccess = () => {
            if (existing.result === undefined) preferences.add(engineering);
          };
        }
        const savedSettings = settings.get('global');
        savedSettings.onsuccess = () => {
          const current = savedSettings.result as GlobalSettings | undefined;
          const saveAiProductManagerDefault = () => {
            const template = preferences.get(
              BUILTIN_TEMPLATE_IDS.aiProductManager,
            );
            template.onsuccess = () => {
              if (template.result === undefined) {
                const approved = builtInRoleTemplates.find(
                  ({ id }) => id === BUILTIN_TEMPLATE_IDS.aiProductManager,
                )!;
                preferences.add(approved);
              }
              settings.put({
                id: 'global',
                defaultTemplateId: BUILTIN_TEMPLATE_IDS.aiProductManager,
                defaults: normalizeStandards(
                  current?.defaults || defaultStandards,
                ),
              } satisfies GlobalSettings);
            };
          };
          if (!current?.defaultTemplateId) {
            saveAiProductManagerDefault();
            return;
          }
          const selected = preferences.get(current.defaultTemplateId);
          selected.onsuccess = () => {
            if (selected.result === undefined) saveAiProductManagerDefault();
          };
        };
      }
      if (event.oldVersion < 7) {
        const preferences = request.transaction!.objectStore('preferences');
        for (const template of builtInRoleTemplates.slice(0, 2)) {
          const existing = preferences.get(template.id);
          existing.onsuccess = () => {
            const replacement = replacementForPreviousBuiltInRoleTemplate(
              existing.result,
            );
            if (replacement) preferences.put(replacement);
          };
        }
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭旧版工作台标签后重试'));
  });
  async function run<T>(
    names: string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction, result: (value: T) => void) => void,
  ): Promise<T> {
    const db = await connection;
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error || new Error('本地保存失败'));
      tx.onerror = () => reject(tx.error || new Error('本地存储不可用'));
      try {
        work(tx, (v) => {
          value = v;
        });
      } catch (e) {
        tx.abort();
        reject(e);
      }
    });
  }
  const read = <T>(store: string, id: string) =>
    run<T | undefined>([store], 'readonly', (tx, result) => {
      const r = tx.objectStore(store).get(id);
      r.onsuccess = () => result(r.result as T | undefined);
    });
  const all = <T>(store: string) =>
    run<T[]>([store], 'readonly', (tx, result) => {
      const r = tx.objectStore(store).getAll();
      r.onsuccess = () => result(r.result as T[]);
    });
  const put = (store: string, value: unknown) =>
    run<void>([store], 'readwrite', (tx) => {
      tx.objectStore(store).put(value);
    });
  return {
    savePreferencesConfig: async (
      settings: GlobalSettings,
      templates: Preference[],
    ) => {
      validateStandards(settings.defaults, false);
      if (!templates.length) throw new Error('至少保留一个岗位模板');
      const ids = new Set<string>(),
        names = new Set<string>();
      for (const template of templates) {
        validateStandards(normalizeStandards(template), true);
        if (
          !template.name.trim() ||
          template.name.length > 80 ||
          ids.has(template.id) ||
          names.has(template.name.trim())
        )
          throw new Error('模板名称不能为空、超过 80 字或重复');
        ids.add(template.id);
        names.add(template.name.trim());
      }
      if (!settings.defaultTemplateId || !ids.has(settings.defaultTemplateId))
        throw new Error('默认模板已不存在，请重新选择');
      const savedSettings: GlobalSettings = {
        ...settings,
        id: 'global',
        defaults: {
          ...normalizeStandards(settings.defaults),
          role: '',
          requirements: '',
        },
      };
      const savedTemplates = templates.map((template) => ({
        ...normalizeStandards(template),
        id: template.id,
        name: template.name.trim(),
      }));
      await run<void>(['settings', 'preferences'], 'readwrite', (tx) => {
        tx.objectStore('preferences').clear();
        savedTemplates.forEach((template) =>
          tx.objectStore('preferences').put(template),
        );
        tx.objectStore('settings').put(savedSettings);
      });
      return { settings: savedSettings, templates: savedTemplates };
    },
    getSettings: () => read<GlobalSettings>('settings', 'global'),
    saveSettings: async (value: GlobalSettings) => {
      validateStandards(value.defaults, false);
      if (!value.defaultTemplateId) throw new Error('请选择默认模板');
      const defaultTemplateId = value.defaultTemplateId;
      return run<void>(['settings', 'preferences'], 'readwrite', (tx) => {
        const save = () =>
          tx.objectStore('settings').put({
            ...value,
            id: 'global',
            defaults: {
              ...normalizeStandards(value.defaults),
              role: '',
              requirements: '',
            },
          });
        const r = tx.objectStore('preferences').get(defaultTemplateId);
        r.onsuccess = () => {
          if (r.result) save();
          else tx.abort();
        };
      });
    },
    getNewInterviewSeed: async (): Promise<NewInterviewSeed> => {
      const [settings, templates] = await Promise.all([
        read<GlobalSettings>('settings', 'global'),
        all<Preference>('preferences'),
      ]);
      const template =
        templates.find(({ id }) => id === settings?.defaultTemplateId) ||
        templates.find(
          ({ id }) => id === BUILTIN_TEMPLATE_IDS.aiProductManager,
        ) ||
        templates[0];
      if (!template) throw new Error('至少保留一个岗位模板');
      return {
        standards: normalizeStandards(template),
        sourceTemplateId: template.id,
      };
    },
    saveInterview: (value: SavedInterview) => put('interviews', value),
    saveInterviewDraft: (value: SavedInterview) =>
      run<void>(['interviews'], 'readwrite', (tx) => {
        const interviews = tx.objectStore('interviews');
        const current = interviews.get(value.id);
        current.onsuccess = () => {
          const groupId = (current.result as SavedInterview | undefined)
            ?.groupId;
          interviews.put(groupId === undefined ? value : { ...value, groupId });
        };
      }),
    getInterview: (id: string) => read<SavedInterview>('interviews', id),
    listInterviews: () => all<SavedInterview>('interviews'),
    listInterviewGroups: async () =>
      (await all<InterviewGroup>('interviewGroups')).sort(
        (a, b) =>
          a.order - b.order ||
          a.createdAt - b.createdAt ||
          a.id.localeCompare(b.id),
      ),
    saveInterviewGroup: async (value: InterviewGroup) => {
      const name = value.name.trim();
      if (!name || name.length > 40)
        throw new Error('分组名称长度需为 1–40 个字符');
      if (!value.id || !Number.isFinite(value.createdAt))
        throw new Error('分组信息无效');
      const groups = await all<InterviewGroup>('interviewGroups');
      const normalizedName = name.toLocaleLowerCase();
      if (
        groups.some(
          (group) =>
            group.id !== value.id &&
            group.name.trim().toLocaleLowerCase() === normalizedName,
        )
      )
        throw new Error('分组名称已存在');
      const saved = {
        ...value,
        name,
        order: Number.isFinite(value.order) ? value.order : groups.length,
      };
      await put('interviewGroups', saved);
      return saved;
    },
    deleteInterviewGroup: (id: string) =>
      run<void>(['interviewGroups', 'interviews'], 'readwrite', (tx) => {
        tx.objectStore('interviewGroups').delete(id);
        const interviews = tx.objectStore('interviews');
        const records = interviews.getAll();
        records.onsuccess = () => {
          for (const record of records.result as SavedInterview[]) {
            if (record.groupId === id)
              interviews.put({ ...record, groupId: null });
          }
        };
      }),
    moveInterviewToGroup: async (
      interviewId: string,
      groupId: string | null,
    ) => {
      if (groupId && !(await read<InterviewGroup>('interviewGroups', groupId)))
        throw new Error('分组已不存在，请刷新后重试');
      const interview = await read<SavedInterview>('interviews', interviewId);
      if (!interview) throw new Error('面试记录已不存在');
      await put('interviews', { ...interview, groupId });
    },
    listAudio: () => all<AudioRecord>('audio'),
    getAudio: (id: string) => read<AudioRecord>('audio', id),
    discardEmptyAudio: (id: string) =>
      run<void>(['audio'], 'readwrite', (tx) => {
        const r = tx.objectStore('audio').get(id);
        r.onsuccess = () => {
          if (r.result && r.result.bytes === 0)
            tx.objectStore('audio').delete(id);
        };
      }),
    beginAudio: (id: string, mimeType: string) =>
      run<void>(['audio'], 'readwrite', (tx) => {
        // add, never put: starting a recording must not overwrite an existing one.
        tx.objectStore('audio').add({
          id,
          mimeType,
          bytes: 0,
          seconds: 0,
          complete: false,
          ended: false,
        } satisfies AudioRecord);
      }),
    appendAudio: (id: string, sequence: number, blob: Blob, seconds: number) =>
      run<void>(['audio', 'chunks'], 'readwrite', (tx) => {
        const r = tx.objectStore('audio').get(id);
        r.onsuccess = () => {
          if (!r.result) {
            tx.abort();
            return;
          }
          tx.objectStore('chunks').add({ id, sequence, blob });
          tx.objectStore('audio').put({
            ...r.result,
            bytes: (r.result as AudioRecord).bytes + blob.size,
            seconds,
          });
        };
      }),
    finishAudio: (id: string, seconds: number, complete: boolean) =>
      run<void>(['audio'], 'readwrite', (tx) => {
        const r = tx.objectStore('audio').get(id);
        r.onsuccess = () => {
          if (r.result)
            tx.objectStore('audio').put({
              ...r.result,
              seconds,
              complete,
              ended: true,
            });
        };
      }),
    readAudio: (id: string) =>
      run<Blob | null>(['audio', 'chunks'], 'readonly', (tx, result) => {
        let meta: AudioRecord | undefined;
        let chunks: { blob: Blob }[] | undefined;
        const finish = () => {
          if (chunks)
            result(
              meta && chunks.length
                ? new Blob(
                    chunks.map((c) => c.blob),
                    { type: meta.mimeType },
                  )
                : null,
            );
        };
        const m = tx.objectStore('audio').get(id);
        m.onsuccess = () => {
          meta = m.result as AudioRecord | undefined;
          finish();
        };
        const c = tx.objectStore('chunks').index('session').getAll(id);
        c.onsuccess = () => {
          chunks = c.result as { blob: Blob }[];
          finish();
        };
      }),
    deleteInterview: (id: string) =>
      run<void>(['interviews', 'audio', 'chunks'], 'readwrite', (tx) => {
        tx.objectStore('interviews').delete(id);
        tx.objectStore('audio').delete(id);
        const cursor = tx
          .objectStore('chunks')
          .index('session')
          .openKeyCursor(id);
        cursor.onsuccess = () => {
          if (cursor.result) {
            tx.objectStore('chunks').delete(cursor.result.primaryKey);
            cursor.result.continue();
          }
        };
      }),
    savePreference: (value: Preference) => put('preferences', value),
    listPreferences: async () => {
      return sortPreferences(await all<Preference>('preferences'));
    },
    deletePreference: async (id: string) => {
      const [templates, settings] = await Promise.all([
        all<Preference>('preferences'),
        read<GlobalSettings>('settings', 'global'),
      ]);
      if (!templates.some((template) => template.id === id)) return;
      const remaining = sortPreferences(
        templates.filter((template) => template.id !== id),
      );
      if (!remaining.length) throw new Error('至少保留一个岗位模板');
      const fallback =
        remaining.find(
          ({ id: templateId }) =>
            templateId === BUILTIN_TEMPLATE_IDS.aiProductManager,
        ) || remaining[0];
      return run<void>(['preferences', 'settings'], 'readwrite', (tx) => {
        tx.objectStore('preferences').delete(id);
        if (settings?.defaultTemplateId === id)
          tx.objectStore('settings').put({
            ...settings,
            defaultTemplateId: fallback.id,
          });
      });
    },
  };
}
export type LocalStore = ReturnType<typeof createLocalStore>;
let store: LocalStore | undefined;
let scope = '';
export function configureLocalStore(account: string) {
  if (scope === account) return;
  scope = account;
  store = undefined;
}
export function localScope() {
  return scope;
}
export function localStore() {
  return (store ??= createLocalStore(
    indexedDB,
    scope ? 'interview-notes-local-' + scope : undefined,
  ));
}
