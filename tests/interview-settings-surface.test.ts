import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

async function loadSummary() {
  const viewUrl = new URL(
    '../components/interview/interview-session-summary.tsx',
    import.meta.url,
  );
  const source = await readFile(viewUrl, 'utf8');
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      /from (["'])([^"']+)\1/g,
      (_match, quote: string, specifier: string) =>
        `from ${quote}${
          specifier.startsWith('@/')
            ? new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href
            : import.meta.resolve(specifier)
        }${quote}`,
    );
  return import(
    'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
  );
}

void test('remote dialogs render one intentional close control', async () => {
  const source = await readFile(
    new URL('../components/interview/remote-workspace.tsx', import.meta.url),
    'utf8',
  );
  const accountStart = source.indexOf(
    'className="remote-dialog remote-account-dialog"',
  );
  const computerStart = source.indexOf('className="remote-dialog"');
  const account = source.slice(
    accountStart,
    source.indexOf('</DialogContent>', accountStart),
  );
  const computer = source.slice(
    computerStart,
    source.indexOf('</DialogContent>', computerStart),
  );

  assert.notEqual(accountStart, -1);
  assert.notEqual(computerStart, -1);
  assert.match(account, /showCloseButton=\{false\}/);
  assert.match(account, /aria-label="关闭账号配置"/);
  assert.match(computer, /showCloseButton=\{false\}/);
  assert.match(computer, /aria-label="关闭"/);
});

void test('current interview summary shows the actionable session state', async () => {
  const { InterviewSessionSummary } = await loadSummary();
  const html = renderToStaticMarkup(
    createElement(InterviewSessionSummary, {
      candidate: '林晓雨',
      role: 'AI 产品经理（校招）',
      status: 'completed',
      writtenTestSupported: true,
      writtenTestConfirmed: true,
      hasWrittenTest: true,
      writtenTestSupplemented: true,
      outlineLocked: true,
      disabled: false,
      open: false,
      onOpen() {},
    }),
  );

  assert.ok(html.includes('本场面试状态'));
  assert.ok(html.includes('林晓雨'));
  assert.ok(html.includes('AI 产品经理（校招）'));
  assert.ok(html.includes('有笔试 · 已补充'));
  assert.ok(html.includes('已生成'));
  assert.ok(html.includes('面试设置'));
  assert.ok(html.includes('aria-haspopup="dialog"'));
});

void test('current interview summary uses compact fallbacks and hides unsupported written tests', async () => {
  const { InterviewSessionSummary } = await loadSummary();
  const html = renderToStaticMarkup(
    createElement(InterviewSessionSummary, {
      candidate: '',
      role: '',
      status: 'preparing',
      writtenTestSupported: false,
      writtenTestConfirmed: false,
      hasWrittenTest: false,
      writtenTestSupplemented: false,
      outlineLocked: false,
      disabled: true,
      open: true,
      onOpen() {},
    }),
  );

  assert.ok(html.includes('待补充'));
  assert.ok(html.includes('待选择'));
  assert.ok(html.includes('待生成'));
  assert.ok(!html.includes('<dt>笔试</dt>'));
  assert.ok(html.includes('disabled=""'));
  assert.ok(html.includes('aria-expanded="true"'));
});

void test('workbench keeps preparation dialog-only and hides fixed standards by default', async () => {
  const [page, preparation] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../components/interview/interview-preparation.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);

  assert.match(page, /<InterviewSessionSummary/);
  assert.doesNotMatch(page, /className="panel context-panel"/);
  assert.doesNotMatch(page, /preparation-toggle/);
  assert.match(page, /<DialogTitle>面试设置<\/DialogTitle>/);
  assert.match(page, /if \(!open\) setStandardsOpen\(false\)/);
  assert.match(preparation, /session-standards-details/);
  assert.doesNotMatch(preparation, /session-standard-summary/);
});

void test('current interview summary replaces the sidebar with a wrapping full-width layout', async () => {
  const css = await readFile(
    new URL('../app/globals.css', import.meta.url),
    'utf8',
  );
  const summary = css.match(
    /\.interview-session-summary\s*\{([\s\S]*?)\}/,
  )?.[1];
  const summaryList = css.match(
    /\.interview-session-summary dl\s*\{([\s\S]*?)\}/,
  )?.[1];

  assert.ok(summary);
  assert.match(summary, /display:\s*flex/);
  assert.match(summary, /justify-content:\s*space-between/);
  assert.match(summary, /position:\s*sticky/);
  assert.match(
    summary,
    /top:\s*calc\(var\(--workbench-header-height\)\s*\+\s*\d+px\)/,
  );
  assert.match(summary, /z-index:\s*\d+/);
  assert.ok(summaryList);
  assert.match(summaryList, /flex-wrap:\s*wrap/);
  assert.match(
    css,
    /\.workspace-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);\s*gap:\s*18px;/,
  );
  assert.doesNotMatch(css, /\.preparation-toggle/);
  assert.doesNotMatch(css, /\.context-panel/);
  assert.doesNotMatch(css, /\.session-standard-summary/);
});

void test('global and current interview settings require a role template', async () => {
  const [globalPreferences, preparation, page, library] = await Promise.all([
    readFile(
      new URL(
        '../components/interview/global-preferences.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../components/interview/interview-preparation.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../hooks/use-interview-library.ts', import.meta.url),
      'utf8',
    ),
  ]);

  assert.doesNotMatch(globalPreferences, /通用默认标准/);
  assert.match(
    globalPreferences,
    /initialSettings\.defaultTemplateId \|\| initialTemplates\[0\]\?\.id/,
  );
  assert.doesNotMatch(globalPreferences, /<option value="">/);
  assert.match(globalPreferences, /至少保留一个岗位模板/);
  assert.doesNotMatch(preparation, /COMMON_TEMPLATE_ID|通用默认标准/);
  assert.doesNotMatch(page, /id === COMMON_TEMPLATE_ID/);
  assert.match(library, /BUILTIN_TEMPLATE_IDS\.aiProductManager/);
});
