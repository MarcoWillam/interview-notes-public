import {
  defaultStandards,
  normalizeStandards,
  validateStandards,
  type GlobalSettings,
} from '../standards.ts';
import { builtInRoleTemplates } from '../default-role-templates.ts';
export type SavedInterview = {
  id: string;
  updatedAt: number;
  candidate: string;
  role: string;
  requirements: string;
  dimensionText: string;
  focus: string;
  resumeText: string;
  resumeName: string;
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
export function createLocalStore(
  factory: IDBFactory,
  name = 'interview-notes-local',
) {
  const connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, 3);
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
      if (event.oldVersion < 3) {
        const preferences = request.transaction!.objectStore('preferences');
        for (const template of builtInRoleTemplates) {
          const existing = preferences.get(template.id);
          existing.onsuccess = () => {
            if (existing.result === undefined) preferences.add(template);
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
      if (settings.defaultTemplateId && !ids.has(settings.defaultTemplateId))
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
        if (!value.defaultTemplateId) {
          save();
          return;
        }
        const r = tx.objectStore('preferences').get(value.defaultTemplateId);
        r.onsuccess = () => {
          if (r.result) save();
          else tx.abort();
        };
      });
    },
    getNewInterviewStandards: async () => {
      const settings = await read<GlobalSettings>('settings', 'global');
      const template = settings?.defaultTemplateId
        ? await read<Preference>('preferences', settings.defaultTemplateId)
        : undefined;
      return normalizeStandards(
        template || settings?.defaults || defaultStandards,
      );
    },
    saveInterview: (value: SavedInterview) => put('interviews', value),
    getInterview: (id: string) => read<SavedInterview>('interviews', id),
    listInterviews: () => all<SavedInterview>('interviews'),
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
    listPreferences: () => all<Preference>('preferences'),
    deletePreference: (id: string) =>
      run<void>(['preferences', 'settings'], 'readwrite', (tx) => {
        tx.objectStore('preferences').delete(id);
        const r = tx.objectStore('settings').get('global');
        r.onsuccess = () => {
          if (r.result?.defaultTemplateId === id)
            tx.objectStore('settings').put({
              ...r.result,
              defaultTemplateId: null,
            });
        };
      }),
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
