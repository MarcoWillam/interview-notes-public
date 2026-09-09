# 网页服务器 + 本地 Codex 部署

当前已部署到 https://your-server-ip （2026-09-09）。以下适用于单台服务器、一个 Node 进程、持久磁盘的自用部署。

## 当前云服务器

- 网站：`https://your-server-ip`，初始账号 `owner`。初始密码仅保存在本机被 Git 忽略的 `.local/cloud-access.txt`，权限为 `600`；服务器初始化后已删除环境配置中的明文密码。其他面试官账号通过下述服务器命令创建。
- 代码：当前版本为 `/opt/interview-notes/releases/20260909-4`，`/opt/interview-notes/current` 已原子切到该目录；生产服务为 `interview-notes.service`，以专用 `interview-notes` 用户开机自启，仅监听 `127.0.0.1:8787`。上一版本 `20260909-3` 保留用于回滚。
- 数据：`/var/lib/interview-notes/queue.sqlite`；环境配置：`/etc/interview-notes/server.env`；运行时：`/opt/node-v24.13.0-linux-x64/bin/node`。服务器只需已构建的 `dist/web` 和队列服务源码，无需安装模型或上传电脑上的 Codex 登录信息。
- Nginx：`/etc/nginx/conf.d/interview-notes.conf`，对应仓库 `deploy/nginx-ip.conf`，HTTP 自动跳转 HTTPS，80 端口保留 ACME 验证路径。
- 证书：Let's Encrypt IP 证书，由 acme.sh 3.1.2 的 `shortlived` profile 签发。使用 `--days 3`，`interview-cert-renew.timer` 每天两次检查续期；续期成功自动安装到 `/etc/nginx/ssl/interview/` 并检查、重载 Nginx。不要关闭公网 80 端口，否则续期验证会失败。
- 旧站点 `z-link` 已从 PM2 移除，原目录、压缩备份和 Nginx 配置位于 `/root/deployment-backups/before-interview-20260908/`，仅 root 可访问。云平台管理、备份和 SSH 服务保留。

本机云端连接凭据单独保存在 `.local/cloud-connector.json`。可双击项目根目录的 `连接云端面试工作台.command` 启动，保持终端运行；电脑休眠或关闭连接器后，云端网页仍可访问，新任务会等待。不要同时重复启动多个相同连接器。

运维检查命令（在云服务器执行）：

```sh
systemctl status interview-notes nginx
systemctl list-timers interview-cert-renew.timer
journalctl -u interview-notes -n 50 --no-pager
```

发布更新前在本机运行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build` 和 `git diff --check`，均须退出 0。HTTP 测试需要本机 loopback 监听权限。生产采用 `dist/web` 静态入口，完整构建生成的 `dist/client`、`dist/server` 不上传。

发布包采用明确白名单：`dist/web`、`server/start.ts`、`server/accounts.ts`、`server/queue/{api,http,store}.ts`、`lib/interview.ts`、`lib/resume-reading.ts`、`lib/standards.ts` 和 `package.json`。`lib/standards.ts` 是 `resume-reading.ts` 的运行时依赖；以上服务端 import 闭包仅另依赖 Node 内置模块，生产不需要 `node_modules`。包内不得包含 `.env*`、`.local`、简历源文件、浏览器数据、Codex credentials、`node_modules` 或 `.git`；后续增加服务端依赖时重新核对闭包。PDF CMap 与字体资源随 `dist/web` 一起发布。

本机生成 SHA-256，上传到服务器临时目录后须验证同一 hash；解压前列出并逐项检查归档清单，拒绝绝对路径、`..`、链接及白名单外文件。本次 `20260909-4` 发布包 SHA-256 为 `70dfc1c3a4dff50358190d3f25b353110b6d6b826b0531f4b3663fe1ee98d183`。若 release 同名已存在，先只读检查并选择带时间后缀的新目录，不能覆盖当前版本。代码目录/文件使用 root 所有、755/644，使专用服务账号可读。保留 `/var/lib/interview-notes` 与 `/etc/interview-notes/server.env`，记录旧 `current` 目标后以临时符号链接加原子 rename 切换并重启 `interview-notes`；检查失败须切回旧目标并重启。旧 release 保留供回滚。

发布检查包括 `nginx -t`、`systemctl is-active interview-notes nginx interview-cert-renew.timer`、HTTPS `/api/session`，以及 HTTP 308 跳转、无需跳过校验的 TLS 证书、登录 Cookie 的 HttpOnly/Secure/SameSite=Strict、登录后工作台和实际构建清单中的 JS/CSS、PDF CMap/font 资源。账号和连接凭据仅由本机脚本读取，不打印值，不写入发布包；`.local/cloud-access.txt` 与 `.local/cloud-connector.json` 保持权限 600。

`20260909-3` 已完成以上生产检查，并用虚构 AI 产品经理简历通过真实本地 Codex 链路验收：姓名及逐字证据有效，六题来源依次为简历、笔试、笔试、笔试、简历、简历，满足“已完成笔试”时第 2–4 题固定为笔试复盘题的约束。

`20260909-4` 已完成生产数据库兼容迁移，原 `owner` 账号保持启用；服务器账号列表命令、公网登录、安全 Cookie、静态资源和本地 Codex 连接状态均通过检查。

## 服务器

1. 准备 Node.js 24+、项目代码和可持久保存 SQLite 的本地磁盘。运行 `npm ci`、`npm run build:server`。
2. 从 `deploy/server.env.example` 建立权限为 `600` 的配置文件，填写公开 HTTPS 根地址、首次账号与至少 12 字的密码。不要提交含密码的文件。
3. 给服务账号创建仅其可访问的持久目录，设置 `INTERVIEW_DATA_DIR`。默认 `.local/server`，本机预览默认另用 `.local/preview-server`。不要使用临时磁盘或将 SQLite 放到多副本共享网络文件系统。
4. 从项目目录运行 `INTERVIEW_ENV_FILE=/绝对路径/server.env npm run start:server`。服务器默认监听 `127.0.0.1:8787`，不会启动本地连接器或 Codex。首次创建账号成功后，可删除配置文件中的初始密码，账号哈希已保存在数据库中。
5. 在同机 HTTPS 反向代理中，将整个网站转发到此端口，保留原始 `Host`。`INTERVIEW_PUBLIC_ORIGIN` 必须与浏览器地址完全匹配。服务器、代理和浏览器应使用同一域名，Cookie 采用 HttpOnly、Secure、SameSite=Strict。
6. 用系统服务管理器保持 Node 进程运行，工作目录为项目根目录，使用专用非 root 账号。限制公网访问到 HTTPS 代理，不直接暴露 Node 端口。升级时重建网页并重启 Node；数据目录保留。

## 面试官账号

账号管理只在服务器命令行开放，没有公开注册或网页管理后台。进入当前 release 后执行以下命令，新增和重置密码时终端会隐藏输入内容：

```sh
cd /opt/interview-notes/current
INTERVIEW_ENV_FILE=/etc/interview-notes/server.env /opt/node-v24.13.0-linux-x64/bin/node --experimental-strip-types server/accounts.ts list
INTERVIEW_ENV_FILE=/etc/interview-notes/server.env /opt/node-v24.13.0-linux-x64/bin/node --experimental-strip-types server/accounts.ts add interviewer_zhang
INTERVIEW_ENV_FILE=/etc/interview-notes/server.env /opt/node-v24.13.0-linux-x64/bin/node --experimental-strip-types server/accounts.ts reset-password interviewer_zhang
INTERVIEW_ENV_FILE=/etc/interview-notes/server.env /opt/node-v24.13.0-linux-x64/bin/node --experimental-strip-types server/accounts.ts disable interviewer_zhang
INTERVIEW_ENV_FILE=/etc/interview-notes/server.env /opt/node-v24.13.0-linux-x64/bin/node --experimental-strip-types server/accounts.ts enable interviewer_zhang
```

账号使用 2–80 字的中文、字母、数字或 `_@.-`，密码为 12–200 字。每个面试官登录网页后，在“电脑连接”中生成自己的配对码，并在自己的电脑项目目录运行页面给出的连接命令。一个账号的连接器不会领取其他账号的任务。

停用账号会立即清除它的网页登录会话和配对凭据，终止排队或执行中的任务并清除其中的原始输入；重新启用后需要重新登录和配对。重置密码也会退出已有登录、撤销已有连接器并终止正在执行的任务，但保留尚未领取的排队任务。浏览器 IndexedDB 中的面试记录不会由服务器远程删除，也不会在账号之间共享。

Nginx 的 HTTPS `server` 块可使用以下位置配置，证书与域名使用自己的实际配置：

```nginx
location / {
    client_max_body_size 600k;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:8787;
    proxy_read_timeout 30s;
}
```

正式 HTTPS 入口开启受信任代理模式，且仅在连接来自 loopback 时读取 Nginx 用 `$remote_addr` 覆写的 `X-Real-IP`。该头须为单个有效 IP 地址；缺失、无效、多值或非 loopback 连接均回退到直接连接地址。登录及配对尝试按该来源地址分别限流（每类 12 次/分钟），不同来源互不占用额度。direct/preview 模式忽略 `X-Real-IP`，不信任客户端自报来源；限流不使用 `X-Forwarded-For`。因此部署时必须保持 Node 仅监听 loopback，并保留 Nginx 覆写 `X-Real-IP` 的配置。没有公开注册、邮件找回或企业 SSO；首次环境变量只用于初始化账号，不会修改已有密码。正式部署不要运行 `npm start`，该命令是免登录的本机预览。

## 分析电脑

1. 安装 Node.js 24+、本项目及 Codex CLI，在终端执行 `codex login`，用现有 ChatGPT 账号登录。服务器账号与 Codex 账号分别管理。
2. 在网页登录，进入“电脑连接”，生成配对码。
3. 在电脑项目目录运行网页给出的 `npm run connector -- --server https://实际域名 --pair 配对码`。
4. 保持连接器进程运行；下次启动仅需 `npm run connector`。可通过 `--config /绝对路径/connector.json` 指定独立凭据文件，通过 `INTERVIEW_CODEX_BIN` 指定 Codex 路径。
5. 电脑主动访问服务器，不向网络监听端口。电脑休眠或连接器退出时任务等待；恢复连接自动领取未执行的任务。已经开始但租约超时的任务不会自动重跑，需在网页核实后重新生成。

配对码仅一次有效、10 分钟到期，重新生成会替换旧码。设备令牌只允许领取该网页账号的任务，不能代替网页登录。解除配对会使设备令牌失效并终止其正在处理的任务。连接器凭据文件不包含 Codex 登录信息，也不要上传此文件。

## 数据与备份

数据库文件在 `INTERVIEW_DATA_DIR/queue.sqlite`，开启 WAL。需要一致备份时，停止服务后复制整个数据目录，或使用 SQLite 正式备份机制；不要只复制正在写入的主文件。代码发布只传代码与 `dist/web`，不要上传本机 `.local`、`.env` 或 Codex 认证目录。

排队原材料保留最多 24 小时；任务终止清除输入字段，结果/任务保留 7 天。数据库清理不覆盖历史备份。浏览器 IndexedDB 的完整面试记录、人工结论与全局偏好仍按浏览器和网站账号保存，不会自动同步到服务器；换地址或设备时需要提前导出。

当前只支持单实例 SQLite 服务。后续多人使用、负载均衡或企业账号接入需要单独扩展，不要让多个应用副本各自维护一份任务数据库。

## 2026-09-09 校招面试准备工作流

本次版本提供 AI 产品经理（校招）与产品运营（校招）两个内置模板。运营按用户运营 60% / 数据增长 40% 组织证据，两岗都单列并重点考察自驱力。AI PM 在 Codex 阅读简历前要求明确选择“有笔试”或“无笔试”，不保存题目或答卷；有笔试时第 2–4 题按既有笔试考量框架生成复盘题，无笔试时不得生成笔试措辞。若上传自动阅读或手动阅读时尚未选择，网页先弹出确认并在选择后直接继续提交。简历阅读将完整本场标准和笔试状态发送给连接器，返回四类要点及六题、30–40 分钟的结构化面试提纲，每题包含来源、合法模板维度、原文依据、原因、观察点与追问。界面优先展示高对比度提纲，简历阅读明细和简历正文默认收起；模板下拉显示当前模板或本场自定义、模板更新状态。

上传附件后在浏览器自动提取并自动提交 Codex 阅读，粘贴/编辑正文后可手动阅读。原附件不上传；提取文字与岗位标准会发送到用户已配对电脑的本地 Codex，经队列服务器短期中转，再由本地 Codex 调用模型。正文默认折叠，可展开核对编辑。有效姓名必须有包含姓名的连续原文证据；空姓名自动填入，冲突默认保留当前姓名，只有明确选择才替换。约 1100px 及以下切单列，将面试准备放入弹窗；更窄屏支持导航和操作换行。

生产验收使用虚构中文 AI 产品简历和完整 AI PM 模板，通过生产登录账号提交 kind=resume 任务，由本机唯一云端连接器执行真实 Codex 阅读。检查完成状态、姓名逐字证据、四类要点、恰六题、模板维度、所有非空证据逐字存在，以及提纲覆盖自驱力和 AI 产品判断。测试任务按现有 7 天终态保留策略处理，原始输入在终态清除；验收记录仅放 `.local`，不提交凭据和测试记录。
