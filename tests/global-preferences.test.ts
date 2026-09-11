import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalStore } from '../lib/local/store.ts';
import { validateStandards } from '../lib/standards.ts';

const builtInIds = {
  aiProductManager: 'builtin-campus-ai-product-manager',
  productOperations: 'builtin-campus-product-operations',
  aiEngineering: 'builtin-campus-ai-engineering',
} as const;

const approvedBuiltInTemplates = [
  {
    id: builtInIds.aiProductManager,
    name: 'AI 产品经理（校招）',
    role: 'AI 产品经理（校招）',
    requirements:
      '面向应届毕业生，重点考察从真实用户问题出发定义产品目标、完成方案和范围取舍，并理解生成式 AI 的适用条件、能力边界、不确定性与风险。AI Demo、课程项目、实习项目和笔试作品有则作为追问材料，不作为必备条件。',
    dimensionText:
      '用户洞察与问题定义、产品方案与范围取舍、AI 理解与产品化判断、数据验证与迭代意识、自驱力与结果闭环、学习力、挑战力与韧性、团队精神与沟通协作',
    focus:
      '区分表面诉求与真实问题；核实范围取舍、AI 与用户责任划分、失败或降级状态、关键验证假设、产品化判断、个人真实贡献和复盘。自驱力必须重点追问。',
    scoringGuidance:
      '自驱力中，仅按要求完成通常不高于 3 分；主动定义阶段目标、协调资源并闭环可评 4 分；发现无人负责的重要问题，在资源不足或路径不明时推动形成可验证成果可评 5 分。产品和 AI 能力不以术语、模型数量、提示词复杂度、代码量或界面精美度评分。',
    reportRequirements:
      '结论先按自驱力与结果闭环、学习力、挑战力与韧性、团队精神与沟通协作总结通用素质能力，再总结用户洞察、方案取舍、AI 产品判断和数据验证四项产品能力，最后形成综合判断。区分面试已证明的能力、仅来自简历或作品的自述、仍需核实的判断。不得生成录用或淘汰决定。',
  },
  {
    id: builtInIds.productOperations,
    name: '产品运营（校招）',
    role: '产品运营（校招）',
    requirements:
      '面向应届毕业生，岗位能力按用户运营约 60%、数据驱动增长运营约 40%组织。考察用户理解、分层、触达、活跃、留存、关系维护，以及指标定义、问题分析、增长实验和结果复盘。自驱力是核心素质。',
    dimensionText:
      '用户理解与用户分层、用户生命周期与关系运营、运营策略与落地执行、数据分析与增长实验、自驱力与结果闭环、学习力、挑战力与韧性、团队精神与沟通协作',
    focus:
      '核实目标用户与分层、生命周期运营动作、长期用户价值、指标口径、增长假设、低成本实验、个人贡献和结果原因。重点追问主动发现问题、争取资源、推进执行与承担结果。',
    scoringGuidance:
      '用户运营约占岗位能力判断的 60%，数据增长约占 40%，用于提问和结论组织，不机械计算总分。自驱力中，仅按要求完成通常不高于 3 分；主动定义阶段目标、协调资源并闭环可评 4 分；发现无人负责的重要问题，在资源不足或路径不明时推动形成可验证成果可评 5 分。活动规模、曝光量和用户数量不能脱离目标、个人动作与复盘单独证明能力。',
    reportRequirements:
      '结论先按自驱力与结果闭环、学习力、挑战力与韧性、团队精神与沟通协作总结通用素质能力，再按用户运营约 60%、数据增长约 40% 总结运营能力，最后形成综合判断。明确个人贡献、具体动作、数据和结果；未确认内容列入待核实事项。',
  },
  {
    id: builtInIds.aiEngineering,
    name: 'AI 研发（校招）',
    role: 'AI 研发（校招）',
    requirements:
      '工作城市为福州，学历要求本科，部门填报 AI 等级为 L2 熟练级（校招建议等级）。必备能力：JavaScript／TypeScript 基础扎实；熟悉 React 全家桶，掌握 HTML／CSS、响应式布局和常见浏览器调试方法；具备前端组件化开发、接口联调和基础工程化经验；能使用 AI 工具辅助编码、调试、资料检索和方案梳理；具备基础 Prompt 设计与优化能力，能将 AI 嵌入个人开发工作流；了解服务端架构。加分项：有 AI 应用、智能体、RAG、工作流编排或大模型 API 调用实践；有前端低代码、可视化搭建、数据看板、浏览器插件、跨端应用或 Node.js BFF 开发经验；了解前端性能优化、工程规范、自动化测试或 CI/CD；有完整项目作品、实习经历、开源贡献或技术博客；对产品体验、业务流程和用户效率提升有主动思考。',
    dimensionText:
      'JavaScript／TypeScript 与浏览器基础、React 组件化与前端交付、接口联调与服务端理解、AI 工具使用与 Prompt 能力、AI 应用实践与架构判断、问题定位与工程质量、自驱力及学习力与挑战力、团队协作与产品体验意识',
    focus:
      '核实候选人在项目中的真实贡献、技术决策、调试过程、AI 使用场景、Prompt 调整、输出验证、失败处理和结果复盘。重点追问是否主动发现问题、定义目标、寻找资源、推动落地并对结果负责。',
    scoringGuidance:
      '必备能力作为核心判断；加分项有具体证据才加分，缺少加分项不扣分。使用过 AI 工具本身不能证明达到 L2，需说明实际场景、输入设计、迭代过程、结果验证及如何嵌入开发工作流。不得以工具数量、技术名词、生成代码量或界面效果代替能力证据。自驱力中，仅按要求完成通常不高于 3 分；主动定义目标并推动闭环可评 4 分；在资源不足或路径不明时发现并解决无人负责的重要问题可评 5 分。',
    reportRequirements:
      '先总结自驱力及真实项目贡献，再按前端基础与交付、服务端理解、AI 工程实践、问题定位和团队协作组织结论。区分已验证事实、候选人自述与待核实事项；课程项目、个人作品、实习和开源经历均可作为证据，不把正式工作年限作为必要条件。不得自动生成录用或淘汰决定。',
  },
] as const;

const previousBuiltInTemplatesV6 = approvedBuiltInTemplates
  .slice(0, 2)
  .map((template, index) => ({
    ...template,
    reportRequirements:
      index === 0
        ? '先说明自驱力证据，再总结产品基本功、AI 产品判断、验证意识与协作表现。区分面试已证明的能力、仅来自简历或作品的自述、仍需核实的判断。不得生成录用或淘汰决定。'
        : '先总结自驱力和结果闭环，再按用户运营、数据增长、学习与挑战、团队协作组织结论。明确个人贡献、具体动作、数据和结果；未确认内容列入待核实事项。',
  }));

const legacyBuiltInTemplatesV1 = [
  {
    id: builtInIds.aiProductManager,
    name: 'AI 产品经理（校招）',
    role: 'AI 产品经理（校招）',
    requirements:
      '面向应届毕业生，考察候选人能否从真实用户问题出发，完成产品方案、范围取舍、AI 能力产品化与数据验证。候选人有产品、研究、原型或 AI 实践作品时作为参考，但作品不是必备条件。笔试只固化考察框架：问题定义、用户理解、范围取舍、AI 核心价值、人与 AI 责任、用户控制、失败降级、验证假设、产品化判断；模板不保存具体题目。',
    dimensionText:
      '用户洞察与问题定义、产品方案与范围取舍、AI 理解与产品化判断、数据验证与迭代意识、自驱力与结果闭环、学习力、挑战力与韧性、团队精神与沟通协作',
    focus:
      '围绕八个维度追问候选人的具体行动、判断依据、协作过程和结果证据。自驱力单列并重点评估，关注是否主动发现问题、推动落地、复盘结果并完成闭环；同时兼顾学习力、挑战力与韧性、团队精神与沟通协作。',
    scoringGuidance:
      '每个维度独立评分，以可核验的经历、作品过程或情境回答为证据；不因有无作品直接加减分。明确区分已验证事实、候选人自述与待追问假设。',
    reportRequirements:
      '报告须按八个维度列出证据、判断与待核实点，并单列自驱力与结果闭环的关键证据。模板不自动给出录用或淘汰结论，最终决定由面试官基于完整信息确认。',
  },
  {
    id: builtInIds.productOperations,
    name: '产品运营（校招）',
    role: '产品运营（校招）',
    requirements:
      '面向应届毕业生，按用户运营 60% 与数据增长 40% 的能力比重考察。候选人需能理解并分层用户，围绕用户生命周期设计关系运营策略并推动落地，同时能运用数据分析定位问题、设计增长实验并根据结果迭代。',
    dimensionText:
      '用户理解与用户分层、用户生命周期与关系运营、运营策略与落地执行、数据分析与增长实验、自驱力与结果闭环、学习力、挑战力与韧性、团队精神与沟通协作',
    focus:
      '用户运营部分重点追问用户分层、触达、活跃、留存与关系维护的真实实践；数据增长部分重点追问指标选择、实验假设、执行与复盘。自驱力单列并重点评估，关注是否主动承担、推动跨团队协作并为结果负责；同时兼顾学习力、挑战力与韧性、团队精神与沟通协作。',
    scoringGuidance:
      '每个维度独立评分，整体证据权重保持用户运营 60% 、数据增长 40%。以候选人的具体行动、数据或可核实结果为主，明确标记缺少证据的判断。',
    reportRequirements:
      '报告须按八个维度列出证据、判断与待核实点，体现用户运营 60% 与数据增长 40% 的比重，并单列自驱力与结果闭环的关键证据。模板不自动给出录用或淘汰结论，最终决定由面试官基于完整信息确认。',
  },
] as const;

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

async function createVersionThreeDatabase(
  factory: IDBFactory,
  name: string,
  preferences: readonly object[],
  settings?: object,
  interviews: readonly object[] = [],
) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      const interviewStore = db.createObjectStore('interviews', {
        keyPath: 'id',
      });
      interviews.forEach((item) => interviewStore.put(item));
      db.createObjectStore('audio', { keyPath: 'id' });
      const preferenceStore = db.createObjectStore('preferences', {
        keyPath: 'id',
      });
      preferences.forEach((item) => preferenceStore.put(item));
      db.createObjectStore('chunks', {
        keyPath: ['id', 'sequence'],
      }).createIndex('session', 'id');
      const settingsStore = db.createObjectStore('settings', {
        keyPath: 'id',
      });
      if (settings) settingsStore.put(settings);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
}

async function createVersionFiveDatabase(
  factory: IDBFactory,
  name: string,
  preferences: readonly object[],
  settings?: object,
  interviews: readonly object[] = [],
) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 5);
    request.onupgradeneeded = () => {
      const db = request.result;
      const interviewStore = db.createObjectStore('interviews', {
        keyPath: 'id',
      });
      interviews.forEach((item) => interviewStore.put(item));
      db.createObjectStore('audio', { keyPath: 'id' });
      const preferenceStore = db.createObjectStore('preferences', {
        keyPath: 'id',
      });
      preferences.forEach((item) => preferenceStore.put(item));
      db.createObjectStore('chunks', {
        keyPath: ['id', 'sequence'],
      }).createIndex('session', 'id');
      const settingsStore = db.createObjectStore('settings', {
        keyPath: 'id',
      });
      if (settings) settingsStore.put(settings);
      db.createObjectStore('interviewGroups', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
}

async function createVersionSixDatabase(
  factory: IDBFactory,
  name: string,
  preferences: readonly object[],
  settings?: object,
  interviews: readonly object[] = [],
) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(name, 6);
    request.onupgradeneeded = () => {
      const db = request.result;
      const interviewStore = db.createObjectStore('interviews', {
        keyPath: 'id',
      });
      interviews.forEach((item) => interviewStore.put(item));
      db.createObjectStore('audio', { keyPath: 'id' });
      const preferenceStore = db.createObjectStore('preferences', {
        keyPath: 'id',
      });
      preferences.forEach((item) => preferenceStore.put(item));
      db.createObjectStore('chunks', {
        keyPath: ['id', 'sequence'],
      }).createIndex('session', 'id');
      const settingsStore = db.createObjectStore('settings', {
        keyPath: 'id',
      });
      if (settings) settingsStore.put(settings);
      db.createObjectStore('interviewGroups', { keyPath: 'id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
}

void test('built-in campus templates expose the required roles, dimensions and guidance', async () => {
  const templateExports =
    await import('../lib/default-role-templates.ts').catch(() => null);
  assert.ok(templateExports, '应导出内置校招岗位模板');
  assert.deepEqual(templateExports.BUILTIN_TEMPLATE_IDS, builtInIds);
  assert.deepEqual(
    templateExports.builtInRoleTemplates,
    approvedBuiltInTemplates,
  );
  templateExports.builtInRoleTemplates.forEach((item) =>
    validateStandards(item, true),
  );
  const operations = templateExports.builtInRoleTemplates.find(
    ({ id }) => id === builtInIds.productOperations,
  );
  assert.ok(operations);
  assert.match(operations.scoringGuidance, /不高于 3 分/);
  assert.match(operations.scoringGuidance, /可评 4 分/);
  assert.match(operations.scoringGuidance, /可评 5 分/);
  assert.doesNotMatch(operations.scoringGuidance, /与 AI 产品经理模板一致/);
});

void test('a new database seeds three templates with AI PM as default', async () => {
  const store = createLocalStore(new IDBFactory());
  assert.deepEqual(await store.listPreferences(), approvedBuiltInTemplates);
  assert.equal(
    (await store.getSettings())?.defaultTemplateId,
    builtInIds.aiProductManager,
  );
});

void test('version 3 upgrades untouched built-ins without changing default, custom templates or history', async () => {
  const factory = new IDBFactory();
  const interview = {
    id: 'version-three-interview',
    candidate: '历史候选人',
    role: '原岗位',
  };
  const customTemplate = { ...template, id: 'custom-version-three' };
  const savedSettings = {
    id: 'global',
    defaultTemplateId: builtInIds.aiProductManager,
    defaults,
  };
  await createVersionThreeDatabase(
    factory,
    'untouched-version-three',
    [...legacyBuiltInTemplatesV1, customTemplate],
    savedSettings,
    [interview],
  );

  const store = createLocalStore(factory, 'untouched-version-three');
  const savedTemplates = await store.listPreferences();
  for (const approved of approvedBuiltInTemplates)
    assert.deepEqual(
      savedTemplates.find(({ id }) => id === approved.id),
      approved,
    );
  assert.deepEqual(
    savedTemplates.find(({ id }) => id === customTemplate.id),
    customTemplate,
  );
  assert.deepEqual(await store.getSettings(), savedSettings);
  assert.deepEqual(await store.getInterview(interview.id), interview);
});

void test('version 3 preserves an edited built-in while updating the untouched one', async () => {
  const factory = new IDBFactory();
  const editedAiTemplate = {
    ...legacyBuiltInTemplatesV1[0],
    focus: '用户编辑后的追问重点',
  };
  await createVersionThreeDatabase(factory, 'edited-version-three', [
    editedAiTemplate,
    legacyBuiltInTemplatesV1[1],
  ]);

  const savedTemplates = await createLocalStore(
    factory,
    'edited-version-three',
  ).listPreferences();
  assert.deepEqual(
    savedTemplates.find(({ id }) => id === editedAiTemplate.id),
    editedAiTemplate,
  );
  assert.deepEqual(
    savedTemplates.find(({ id }) => id === builtInIds.productOperations),
    approvedBuiltInTemplates[1],
  );
});

void test('version 3 restores AI PM when the default is missing', async () => {
  const factory = new IDBFactory();
  await createVersionThreeDatabase(factory, 'deleted-version-three', [
    legacyBuiltInTemplatesV1[1],
  ]);

  const store = createLocalStore(factory, 'deleted-version-three');
  assert.deepEqual(await store.listPreferences(), [
    approvedBuiltInTemplates[0],
    approvedBuiltInTemplates[1],
    approvedBuiltInTemplates[2],
  ]);
  assert.equal(
    (await store.getSettings())?.defaultTemplateId,
    builtInIds.aiProductManager,
  );
});

void test('version 5 adds AI engineering and preserves an explicit custom default', async () => {
  const factory = new IDBFactory();
  const customTemplate = { ...template, id: 'custom-default' };
  await createVersionFiveDatabase(
    factory,
    'version-five-custom-default',
    [approvedBuiltInTemplates[0], customTemplate],
    {
      id: 'global',
      defaultTemplateId: customTemplate.id,
      defaults,
    },
  );

  const store = createLocalStore(factory, 'version-five-custom-default');
  assert.equal(
    (await store.getSettings())?.defaultTemplateId,
    customTemplate.id,
  );
  assert.deepEqual(
    (await store.listPreferences()).find(
      ({ id }) => id === builtInIds.aiEngineering,
    ),
    approvedBuiltInTemplates[2],
  );
  assert.equal(
    (await store.listPreferences()).some(
      ({ id }) => id === builtInIds.productOperations,
    ),
    false,
  );
});

void test('version 5 repairs a null default without changing interview history', async () => {
  const factory = new IDBFactory();
  const history = { id: 'history', candidate: '历史候选人', role: '原岗位' };
  await createVersionFiveDatabase(
    factory,
    'version-five-null-default',
    [approvedBuiltInTemplates[1]],
    { id: 'global', defaultTemplateId: null, defaults },
    [history],
  );

  const store = createLocalStore(factory, 'version-five-null-default');
  assert.equal(
    (await store.getSettings())?.defaultTemplateId,
    builtInIds.aiProductManager,
  );
  assert.deepEqual(
    (await store.listPreferences()).find(
      ({ id }) => id === builtInIds.aiProductManager,
    ),
    approvedBuiltInTemplates[0],
  );
  assert.deepEqual(await store.getInterview(history.id), history);
});

void test('version 6 upgrades only untouched conclusion requirements and preserves history', async () => {
  const factory = new IDBFactory();
  const history = { id: 'v6-history', candidate: '历史候选人', report: {} };
  const editedOperations = {
    ...previousBuiltInTemplatesV6[1],
    reportRequirements: '用户自定义的报告要求',
  };
  const settings = {
    id: 'global',
    defaultTemplateId: builtInIds.productOperations,
    defaults,
  };
  await createVersionSixDatabase(
    factory,
    'version-six-groups',
    [
      previousBuiltInTemplatesV6[0],
      editedOperations,
      approvedBuiltInTemplates[2],
    ],
    settings,
    [history],
  );
  const store = createLocalStore(factory, 'version-six-groups');
  const saved = await store.listPreferences();
  assert.deepEqual(
    saved.find(({ id }) => id === builtInIds.aiProductManager),
    approvedBuiltInTemplates[0],
  );
  assert.deepEqual(
    saved.find(({ id }) => id === builtInIds.productOperations),
    editedOperations,
  );
  assert.deepEqual(
    saved.find(({ id }) => id === builtInIds.aiEngineering),
    approvedBuiltInTemplates[2],
  );
  assert.deepEqual(await store.getSettings(), settings);
  assert.deepEqual(await store.getInterview(history.id), history);
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
  const templates = await createLocalStore(
    factory,
    'stable-id',
  ).listPreferences();
  assert.equal(
    templates.find(({ id }) => id === customized.id)?.name,
    customized.name,
  );
  assert.equal(templates.filter(({ id }) => id === customized.id).length, 1);
  assert.ok(templates.some(({ id }) => id === builtInIds.productOperations));
});
void test('new interviews resolve saved global defaults and return isolated values', async () => {
  const store = createLocalStore(new IDBFactory());
  const first = await store.getNewInterviewSeed();
  assert.equal(first.sourceTemplateId, builtInIds.aiProductManager);
  assert.equal(first.standards.role, 'AI 产品经理（校招）');
  first.standards.focus = '本场修改';
  assert.notEqual(
    (await store.getNewInterviewSeed()).standards.focus,
    '本场修改',
  );
  await assert.rejects(
    store.saveSettings({ id: 'global', defaultTemplateId: null, defaults }),
    /默认模板/,
  );
});
void test('default template updates affect future snapshots only and deletion falls back', async () => {
  const factory = new IDBFactory();
  const store = createLocalStore(factory);
  await store.savePreference(template);
  await store.saveSettings({ id: 'global', defaultTemplateId: 'pm', defaults });
  const snapshot = await store.getNewInterviewSeed();
  assert.equal(snapshot.sourceTemplateId, template.id);
  await store.savePreference({ ...template, focus: '新的要求' });
  const reopened = createLocalStore(factory);
  assert.equal(
    (await reopened.getNewInterviewSeed()).standards.focus,
    '新的要求',
  );
  assert.equal(snapshot.standards.focus, '说明决策过程');
  await store.deletePreference('pm');
  assert.equal(
    (await store.getSettings())?.defaultTemplateId,
    builtInIds.aiProductManager,
  );
  assert.equal(
    (await store.getNewInterviewSeed()).sourceTemplateId,
    builtInIds.aiProductManager,
  );

  await store.saveSettings({
    id: 'global',
    defaultTemplateId: builtInIds.aiProductManager,
    defaults,
  });
  await store.deletePreference(builtInIds.aiProductManager);
  assert.equal(
    (await store.getSettings())?.defaultTemplateId,
    builtInIds.productOperations,
  );
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
  assert.equal((await store.getNewInterviewSeed()).standards.role, '产品经理');
});

void test('saving all preferences is atomic and does not rewrite interview snapshots', async () => {
  const store = createLocalStore(new IDBFactory());
  await store.savePreferencesConfig(
    { id: 'global', defaults, defaultTemplateId: template.id },
    [template],
  );
  const snapshot = {
    ...(await store.getNewInterviewSeed()).standards,
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
  await assert.rejects(
    store.savePreferencesConfig(
      {
        id: 'global',
        defaults: { ...defaults, focus: '不应保存' },
        defaultTemplateId: null,
      },
      [],
    ),
    /至少保留一个岗位模板|默认模板/,
  );
  assert.deepEqual(await store.getInterview('interview'), snapshot);
  assert.equal(
    (await store.getNewInterviewSeed()).standards.focus,
    '说明决策过程',
  );
  await assert.rejects(
    store.savePreferencesConfig(
      { id: 'global', defaults, defaultTemplateId: template.id },
      [{ ...template, dimensionText: '' }],
    ),
  );
  assert.equal((await store.getSettings())?.defaults.focus, defaults.focus);
  assert.equal((await store.listPreferences()).length, 1);
});

void test('template validation prevents duplicate names and more than eight dimensions', async () => {
  const store = createLocalStore(new IDBFactory());
  const settings = {
    id: 'global' as const,
    defaults,
    defaultTemplateId: template.id,
  };
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
