import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalStore } from '../lib/local/store.ts';
import { validateStandards } from '../lib/standards.ts';

const builtInIds = {
  aiProductManager: 'builtin-campus-ai-product-manager',
  productOperations: 'builtin-campus-product-operations',
} as const;

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
void test('built-in campus templates expose the required roles, dimensions and guidance', async () => {
  const templateExports = await import('../lib/default-role-templates.ts').catch(
    () => null,
  );
  assert.ok(templateExports, '应导出内置校招岗位模板');
  assert.deepEqual(templateExports.BUILTIN_TEMPLATE_IDS, builtInIds);
  assert.equal(templateExports.builtInRoleTemplates.length, 2);
  const byId = new Map(
    templateExports.builtInRoleTemplates.map((item) => [item.id, item]),
  );
  const aiPm = byId.get(builtInIds.aiProductManager);
  const operations = byId.get(builtInIds.productOperations);
  assert.ok(aiPm);
  assert.ok(operations);
  validateStandards(aiPm, true);
  validateStandards(operations, true);
  assert.equal(aiPm.name, 'AI 产品经理（校招）');
  assert.equal(aiPm.role, 'AI 产品经理（校招）');
  assert.deepEqual(aiPm.dimensionText.split('、'), [
    '用户洞察与问题定义',
    '产品方案与范围取舍',
    'AI 理解与产品化判断',
    '数据验证与迭代意识',
    '自驱力与结果闭环',
    '学习力',
    '挑战力与韧性',
    '团队精神与沟通协作',
  ]);
  assert.equal(operations.name, '产品运营（校招）');
  assert.equal(operations.role, '产品运营（校招）');
  assert.deepEqual(operations.dimensionText.split('、'), [
    '用户理解与用户分层',
    '用户生命周期与关系运营',
    '运营策略与落地执行',
    '数据分析与增长实验',
    '自驱力与结果闭环',
    '学习力',
    '挑战力与韧性',
    '团队精神与沟通协作',
  ]);
  const aiText = Object.values(aiPm).join('\n');
  assert.match(aiText, /作品.*参考/);
  assert.match(aiText, /不.*必备/);
  for (const point of [
    '问题定义',
    '用户理解',
    '范围取舍',
    'AI 核心价值',
    '人与 AI 责任',
    '用户控制',
    '失败降级',
    '验证假设',
    '产品化判断',
  ])
    assert.match(aiText, new RegExp(point));
  assert.match(aiText, /不保存具体题目/);
  const operationsText = Object.values(operations).join('\n');
  assert.match(operationsText, /用户运营\s*60%/);
  assert.match(operationsText, /数据增长\s*40%/);
  for (const text of [aiText, operationsText]) {
    assert.match(text, /自驱力.*单列.*重点评估/);
    assert.match(text, /学习力/);
    assert.match(text, /挑战力/);
    assert.match(text, /团队精神/);
    assert.match(text, /不自动.*录用.*淘汰/);
  }
});

void test('a new database seeds two templates without selecting a default', async () => {
  const store = createLocalStore(new IDBFactory());
  assert.deepEqual(
    (await store.listPreferences()).map(({ id }) => id).sort(),
    Object.values(builtInIds).sort(),
  );
  assert.equal(await store.getSettings(), undefined);
});

void test('version 2 upgrade preserves user data and adds only the built-in templates', async () => {
  const factory = new IDBFactory();
  const interview = { id: 'legacy-interview', candidate: '原候选人' };
  const savedSettings = {
    id: 'global',
    defaultTemplateId: template.id,
    defaults,
  };
  await new Promise<void>((resolve, reject) => {
    const request = factory.open('version-two', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('interviews', { keyPath: 'id' }).put(interview);
      db.createObjectStore('audio', { keyPath: 'id' });
      db.createObjectStore('preferences', { keyPath: 'id' }).put(template);
      db.createObjectStore('chunks', {
        keyPath: ['id', 'sequence'],
      }).createIndex('session', 'id');
      db.createObjectStore('settings', { keyPath: 'id' }).put(savedSettings);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
  const store = createLocalStore(factory, 'version-two');
  assert.deepEqual(await store.getInterview(interview.id), interview);
  assert.deepEqual(await store.getSettings(), savedSettings);
  const savedTemplates = await store.listPreferences();
  assert.deepEqual(
    savedTemplates.map(({ id }) => id).sort(),
    [template.id, ...Object.values(builtInIds)].sort(),
  );
  assert.deepEqual(
    savedTemplates.find(({ id }) => id === template.id),
    template,
  );
});

void test('version 2 upgrade never overwrites an existing stable template id', async () => {
  const factory = new IDBFactory();
  const customized = {
    ...template,
    id: builtInIds.aiProductManager,
    name: '用户修改过的模板',
  };
  await new Promise<void>((resolve, reject) => {
    const request = factory.open('stable-id', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('interviews', { keyPath: 'id' });
      db.createObjectStore('audio', { keyPath: 'id' });
      db.createObjectStore('preferences', { keyPath: 'id' }).put(customized);
      db.createObjectStore('chunks', {
        keyPath: ['id', 'sequence'],
      }).createIndex('session', 'id');
      db.createObjectStore('settings', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
  const templates = await createLocalStore(factory, 'stable-id').listPreferences();
  assert.equal(
    templates.find(({ id }) => id === customized.id)?.name,
    customized.name,
  );
  assert.equal(
    templates.filter(({ id }) => id === customized.id).length,
    1,
  );
  assert.ok(
    templates.some(({ id }) => id === builtInIds.productOperations),
  );
});
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
  assert.equal(
    (await store.listPreferences()).find(({ id }) => id === template.id)?.name,
    '产品一面',
  );
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
