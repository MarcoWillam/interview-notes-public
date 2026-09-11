import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { connectorPackageFiles } from './connector-package-files.mjs';
import { CONNECTOR_VERSION } from '../lib/connector-release.ts';

const root = resolve(import.meta.dirname, '..');
const archive = {};
for (const file of connectorPackageFiles)
  archive[`interview-connector/${file}`] = await readFile(join(root, file));

for (const file of [
  'node_modules/fflate/package.json',
  'node_modules/fflate/esm/index.mjs',
  'node_modules/fflate/LICENSE',
])
  archive[`interview-connector/${file}`] = await readFile(join(root, file));

archive['interview-connector/package.json'] = strToU8(
  JSON.stringify(
    {
      name: 'interview-codex-connector',
      version: CONNECTOR_VERSION,
      private: true,
      type: 'module',
      engines: { node: '>=24.0.0' },
      scripts: {
        connector: 'node --experimental-strip-types server/connector.ts',
      },
    },
    null,
    2,
  ) + '\n',
);
archive['interview-connector/使用说明.txt'] =
  strToU8(`面试工作台本地 Codex 连接器 ${CONNECTOR_VERSION}

准备：
1. 安装 Node.js 24 或更高版本。
2. 安装 Codex CLI，并运行 codex login 使用自己的 ChatGPT 账号登录。
3. 在网页使用自己的面试官账号生成新配对码。

运行：
1. 在终端进入解压后的 interview-connector 文件夹。
2. 运行网页显示的 npm run connector -- --server ... --pair ... 命令。
3. 配对成功后保持终端窗口运行；以后在同一文件夹运行 npm run connector 即可。

笔试作品：
1. 首次启动连接器后，当前文件夹会自动创建 works 文件夹。
2. 将不超过 50 MB 的 ZIP 作品放入 works，再到网页刷新作品清单。
3. 作品原件、源码和本机路径不会上传服务器；服务器只接收文件名、大小、哈希和分析结果。
4. Codex 仅静态阅读受支持的文件，不运行代码、不安装依赖。

若 npm 报错找不到 /Users/用户名/package.json，说明终端没有进入本文件夹。
配对码 10 分钟有效且只能使用一次，过期后请在网页重新生成。

更新：
1. 关闭旧连接器终端，在原连接器目录替换程序文件。
2. 必须保留 .local/connector.json 和 works，无需重新配对。
3. 回到原目录运行 npm run connector，网页会显示新的版本状态。
`);

const output = join(root, 'public/downloads');
await mkdir(output, { recursive: true });
await writeFile(
  join(output, 'interview-connector.zip'),
  zipSync(archive, { level: 9 }),
);
