# 自托管部署 (Self-hosting)

本页适用于**单台服务器、一个 Node 进程、持久磁盘**的自用部署。网页提交任务 → 服务器持久排队 → 已配对电脑主动领取 → 本机 Codex 分析 → 结果回传。服务器不持有任何模型凭据。

> 仓库中的占位地址：`your-workspace.example`（公开域名）、`your-server-ip`（服务器 IP）。请替换为你自己的值。

## 前置条件

- Node.js 24 及以上
- 一台带持久磁盘的服务器（用于保存 SQLite）
- 一个 HTTPS 反向代理（Nginx 等），证书自行配置
- 分析电脑：Node.js 24 + 本项目 + Codex CLI，并已用 ChatGPT 账号登录

## 服务器

1. 安装依赖并构建服务端：

   ```sh
   npm ci
   npm run build:server
   ```

2. 从 `deploy/server.env.example` 复制为权限 `600` 的配置文件，填写公开 HTTPS 根地址、首次管理员账号与至少 12 字的密码。**切勿提交含密码的文件**。

3. 为服务账号创建仅其可访问的持久目录，并设置 `INTERVIEW_DATA_DIR`（本机预览默认使用 `.local/preview-server`）。不要把 SQLite 放在临时磁盘或网络文件系统。

4. 启动正式服务（默认监听 `127.0.0.1:8787`，不会启动本地连接器或 Codex）：

   ```sh
   INTERVIEW_ENV_FILE=/path/to/server.env npm run start:server
   ```

   首次创建账号成功后，可删除配置文件中的初始密码（账号哈希已存入数据库）。

5. 在 HTTPS 反向代理中将整站转发到该端口，保留原始 `Host`；`INTERVIEW_PUBLIC_ORIGIN` 必须与浏览器地址完全一致。Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Strict`。

6. 用系统服务管理器保持 Node 进程运行，工作目录为项目根目录，使用专用非 root 账号；只暴露 HTTPS，不直接暴露 Node 端口。升级时重建网页并重启 Node，数据目录保留。

> 正式部署**不要**运行 `npm start`——该命令是免登录的本机预览。

## Nginx 示例

参考 `deploy/nginx-ip.conf`（把其中的 `your-server-ip` 换成你的域名或 IP）。核心 `location` 配置：

```nginx
location / {
    client_max_body_size 2304k;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_xforwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:8787;
    proxy_read_timeout 30s;
}
```

## 受信任代理与安全

- 正式 HTTPS 入口开启受信任代理模式，且仅在连接来自 loopback 时读取 Nginx 用 `$remote_addr` 覆写的 `X-Real-IP`；该头须为单个有效 IP，缺失/无效/多值/非 loopback 时回退到直接连接地址。
- 登录与配对尝试按来源地址分别限流；本机预览模式不信任客户端自报来源。
- 部署时**必须**保持 Node 仅监听 loopback，并保留 Nginx 覆写 `X-Real-IP` 的配置。
- 没有公开注册、邮件找回或企业 SSO；首次环境变量仅用于初始化账号，不修改已有密码。

## 面试官账号

`owner` 登录网页后，可从顶部“账号配置”创建新的面试官账号；普通账号看不到该入口。列表、重置密码、停用/启用也可在服务器命令行执行（输入内容会被终端隐藏）：

```sh
INTERVIEW_ENV_FILE=/path/to/server.env node --experimental-strip-types server/accounts.ts list
INTERVIEW_ENV_FILE=/path/to/server.env node --experimental-strip-types server/accounts.ts add <username>
INTERVIEW_ENV_FILE=/path/to/server.env node --experimental-strip-types server/accounts.ts reset-password <username>
INTERVIEW_ENV_FILE=/path/to/server.env node --experimental-strip-types server/accounts.ts disable <username>
INTERVIEW_ENV_FILE=/path/to/server.env node --experimental-strip-types server/accounts.ts enable <username>
```

账号名 2–80 字（中文、字母、数字或 `_@.-`），密码 12–200 字。每个面试官登录后在“电脑连接”生成自己的配对码，并在自己电脑的项目目录运行连接命令；一个账号的连接器不会领取其他账号的任务。

停用账号会立即清除其网页会话与配对凭据，终止排队/执行中的任务并清除原始输入；重新启用需重新登录与配对。重置密码会退出已有登录、撤销连接器并终止正在执行的任务，但保留尚未领取的排队任务。

## 分析电脑（连接器）

1. 安装 Node.js 24+、本项目与 Codex CLI，执行 `codex login` 用 ChatGPT 账号登录。服务器账号与 Codex 账号分别管理。
2. 网页登录后进入“电脑连接”，生成配对码。
3. 在“电脑连接”下载并解压不含凭据的专用连接器包，进入解压目录确认含 `package.json` 后运行页面给出的命令：

   ```sh
   npm run connector -- --server https://your-workspace.example --pair <配对码>
   ```

   若 npm 报错找不到 `package.json`，说明终端仍停留在用户主目录；进入连接器目录后重新运行。配对码超过 10 分钟需重新生成。
4. 保持连接器进程运行；之后只需 `npm run connector`。可用 `--config /绝对路径/connector.json` 指定独立凭据文件，用 `INTERVIEW_CODEX_BIN` 指定 Codex 路径（本地开发亦可参考 `scripts/connect-local.example.sh`）。
5. 电脑主动访问服务器，不监听网络端口。电脑休眠或连接器退出时任务等待，恢复连接后自动领取。已开始但租约超时的任务不会自动重跑，需在网页核实后重新生成。
6. 首次启动连接器后，其当前目录会自动创建权限受限的 `works/` 作品箱。AI 产品经理 ZIP 作品放入该目录后可在网页选择，单个 ZIP 最大 50 MB；作品任务绑定到持有该文件的电脑。

配对码仅一次有效、10 分钟到期；重新生成会替换旧码。设备令牌只能领取该网页账号的任务，不能代替网页登录。解除配对会使设备令牌失效并终止其任务。连接器凭据文件不包含 Codex 登录信息，请勿上传。

## 数据与备份

数据库文件位于 `INTERVIEW_DATA_DIR/queue.sqlite`，开启 WAL。登录后，候选人信息、简历提取文字、岗位标准快照、提纲、面试记录、作品观察、结论与关键历史版本按网页账号隔离保存；`owner` 也不能读取其他账号的档案。原始简历附件、作品 ZIP 与录音仅保存在上传它们的电脑。服务器管理员可读未加密 SQLite 与备份，因此生产主机与备份目录须按最小权限管理。

浏览器 IndexedDB 是离线副本；断网继续保存，联网自动提交。同一账号在两台电脑同时修改时，落后修改保留为冲突副本，不采用最后写入覆盖。删除档案进入回收站（30 天可恢复）；关键版本长期保留。

一致备份使用 Node SQLite backup API（不能直接复制正在使用的 WAL 主文件）。安装定时器前创建独立目录并仅授权服务账号：

```sh
install -d -m 700 -o interview-notes -g interview-notes /var/backups/interview-notes
install -m 644 deploy/interview-record-backup.service /etc/systemd/system/
install -m 644 deploy/interview-record-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now interview-record-backup.timer
systemctl start interview-record-backup.service
systemctl status interview-record-backup.service --no-pager
```

工具每天保留 14 份日备份与最近 8 个 ISO 周备份；每份文件生成后须通过 `PRAGMA quick_check` 才进入保留集合。发布前可执行一次：

```sh
npm run backup:interviews -- --database /var/lib/interview-notes/queue.sqlite --directory /var/backups/interview-notes
```

排队原材料保留最多 24 小时；任务终止清除输入字段，结果/任务保留 7 天。当前仅支持单实例 SQLite 服务；多人使用、负载均衡或企业账号接入需单独扩展，不要让多个应用副本各自维护一份任务数据库。

## 补充追问

已有主提纲的面试记录可按一个自由文本维度或关注点追加补充追问。服务器下发协议合同，Codex 参考当前岗位要求、简历阅读、主提纲与已有补充组，固定返回两道短问题；补充组独立追加，不重写主提纲。每份记录同一时间仅允许一个补充任务，支持暂停、恢复、停止与刷新后恢复。协议提示词与校验由服务器下发，更新规则时无需替换已升级的连接器或重新配对。

## AI 产品经理笔试作品

笔试作品为可选材料，仅用于内置 AI 产品经理模板。选择“有笔试”后可从在线电脑作品箱选择 ZIP；服务器仅保存作品编号、文件名、大小、修改时间、SHA-256、所属设备与结构化结果，不接收 ZIP 正文或电脑绝对路径。连接器在本机临时目录解压，拒绝路径穿越、符号链接、嵌套压缩包与超限文件；Codex 使用只读沙箱及受限 MCP 工具静态阅读，不执行代码、不安装依赖。分析结束或取消后会清理临时目录。作品观察只描述提交材料，不直接计入候选人对话评分；最终结论中所有验证引用必须逐字来自已校对的面试记录。

## 连接器包发布

生产连接器包由 `scripts/prepare-connector-package.mjs` 生成，不含任何凭据；网页「电脑连接」也提供下载。发布包仅包含服务端 import 闭包与 `dist/web` 静态资源，不得包含 `.env*`、`.local`、SQLite、简历/作品源文件、浏览器数据或 Codex 凭据。
