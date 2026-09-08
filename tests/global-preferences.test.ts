import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalStore } from '../lib/local/store.ts';

const defaults = {
  role: '',
  requirements: '',
  dimensionText: '专业能力、沟通协作',
  focus: '给出实际项目证据',
  scoringGuidance: '3 分代表能够独立完成工作',
  reportRequirements: '列出需要追问的事实',
};
const template = {
  ...defaults,
  id: 'pm',
  name: '产品一面',
  role: '产品经理',
  requirements: '用户研究',
  focus: '说明决策过程',
};
void test('new interviews resolve saved global defaults and return isolated values', async () => {
  const store = createLocalStore(new IDBFactory());
  await store.saveSettings({ id: 'global', defaultTemplateId: null, defaults });
  const first = await store.getNewInterviewStandards();
  assert.deepEqual(first, defaults);
  first.focus = '本场修改';
  assert.equal((await store.getNewInterviewStandards()).focus, defaults.focus);
});
void test('default template updates affect future snapshots only and deletion falls back', async () => {
  const factory = new IDBFactory();
  const store = createLocalStore(factory);
  await store.savePreference(template);
  await store.saveSettings({ id: 'global', defaultTemplateId: 'pm', defaults });
  const snapshot = await store.getNewInterviewStandards();
  await store.savePreference({ ...template, focus: '新的要求' });
  const reopened = createLocalStore(factory);
  assert.equal((await reopened.getNewInterviewStandards()).focus, '新的要求');
  assert.equal(snapshot.focus, '说明决策过程');
  await store.deletePreference('pm');
  assert.equal((await store.getSettings())?.defaultTemplateId, null);
  assert.deepEqual(await store.getNewInterviewStandards(), defaults);
});
void test('cannot save a default selection pointing to a missing template', async () => {
  const store = createLocalStore(new IDBFactory());
  await assert.rejects(
    store.saveSettings({
      id: 'global',
      defaultTemplateId: 'missing',
      defaults,
    }),
  );
});
void test('version 1 upgrade preserves existing recordings and templates', async () => {
  const factory = new IDBFactory();
  await new Promise<void>((resolve, reject) => {
    const request = factory.open('legacy', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('interviews', { keyPath: 'id' });
      db.createObjectStore('audio', { keyPath: 'id' }).put({
        id: 'old',
        mimeType: 'audio/webm',
        bytes: 5,
        seconds: 1,
        complete: true,
      });
      db.createObjectStore('chunks', {
        keyPath: ['id', 'sequence'],
      }).createIndex('session', 'id');
      request
        .transaction!.objectStore('chunks')
        .put({ id: 'old', sequence: 0, blob: new Blob(['audio']) });
      db.createObjectStore('preferences', { keyPath: 'id' }).put(template);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
  const store = createLocalStore(factory, 'legacy');
  assert.equal(await (await store.readAudio('old'))?.text(), 'audio');
  assert.equal((await store.listPreferences())[0].name, '产品一面');
  await store.saveSettings({ id: 'global', defaultTemplateId: 'pm', defaults });
  assert.equal((await store.getNewInterviewStandards()).role, '产品经理');
});

void test('saving all preferences is atomic and does not rewrite interview snapshots', async () => {
  const store = createLocalStore(new IDBFactory());
  await store.savePreferencesConfig(
    { id: 'global', defaults, defaultTemplateId: template.id },
    [template],
  );
  const snapshot = {
    ...(await store.getNewInterviewStandards()),
    id: 'interview',
    updatedAt: 1,
    candidate: '测试',
    resumeText: '',
    resumeName: '',
    transcript: '',
    reviewed: false,
    report: null,
    conclusion: '',
    confirmed: false,
  };
  await store.saveInterview(snapshot);
  await store.savePreferencesConfig(
    {
      id: 'global',
      defaults: { ...defaults, focus: '新通用标准' },
      defaultTemplateId: null,
    },
    [],
  );
  assert.deepEqual(await store.getInterview('interview'), snapshot);
  assert.equal((await store.getNewInterviewStandards()).focus, '新通用标准');
  await assert.rejects(
    store.savePreferencesConfig(
      { id: 'global', defaults, defaultTemplateId: template.id },
      [{ ...template, dimensionText: '' }],
    ),
  );
  assert.equal((await store.getSettings())?.defaults.focus, '新通用标准');
  assert.equal((await store.listPreferences()).length, 0);
});

void test('template validation prevents duplicate names and more than eight dimensions', async () => {
  const store = createLocalStore(new IDBFactory());
  const settings = { id: 'global' as const, defaults, defaultTemplateId: null };
  await assert.rejects(
    store.savePreferencesConfig(settings, [
      template,
      { ...template, id: 'second' },
    ]),
  );
  await assert.rejects(
    store.savePreferencesConfig(settings, [
      { ...template, dimensionText: '一、二、三、四、五、六、七、八、九' },
    ]),
  );
});
