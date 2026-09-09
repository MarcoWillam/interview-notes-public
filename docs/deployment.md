# 网页服务器 + 本地 Codex 部署

当前已部署到 https://your-server-ip （2026-09-08）。以下适用于单台服务器、一个 Node 进程、持久磁盘的自用部署。

## 当前云服务器

- 网站：`https://your-server-ip`，账号 `owner`。初始密码仅保存在本机被 Git 忽略的 `.local/cloud-access.txt`，权限为 `600`；服务器初始化后已删除环境配置中的明文密码。
- 代码：`/opt/interview-notes/current` 指向 `/opt/interview-notes/releases/20260908`；生产服务为 `interview-notes.service`，以专用 `interview-notes` 用户开机自启，仅监听 `127.0.0.1:8787`。
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

发布更新时先在本机运行 `npm run build:server`，只上传 `dist/web`、`server/start.ts`、`server/queue/{api,http,store}.ts`、`lib/interview.ts`、`lib/resume-reading.ts` 和 `package.json` 到新的 release 目录。切换 `current` 后重启 `interview-notes`，保留数据和环境配置；不要上传 `.env`、`.local`、`node_modules` 或 Codex 认证目录。后续增加服务端依赖时重新核对文件清单。

## 服务器

1. 准备 Node.js 24+、项目代码和可持久保存 SQLite 的本地磁盘。运行 `npm ci`、`npm run build:server`。
2. 从 `deploy/server.env.example` 建立权限为 `600` 的配置文件，填写公开 HTTPS 根地址、首次账号与至少 12 字的密码。不要提交含密码的文件。
3. 给服务账号创建仅其可访问的持久目录，设置 `INTERVIEW_DATA_DIR`。默认 `.local/server`，本机预览默认另用 `.local/preview-server`。不要使用临时磁盘或将 SQLite 放到多副本共享网络文件系统。
4. 从项目目录运行 `INTERVIEW_ENV_FILE=/绝对路径/server.env npm run start:server`。服务器默认监听 `127.0.0.1:8787`，不会启动本地连接器或 Codex。首次创建账号成功后，可删除配置文件中的初始密码，账号哈希已保存在数据库中。
5. 在同机 HTTPS 反向代理中，将整个网站转发到此端口，保留原始 `Host`。`INTERVIEW_PUBLIC_ORIGIN` 必须与浏览器地址完全匹配。服务器、代理和浏览器应使用同一域名，Cookie 采用 HttpOnly、Secure、SameSite=Strict。
6. 用系统服务管理器保持 Node 进程运行，工作目录为项目根目录，使用专用非 root 账号。限制公网访问到 HTTPS 代理，不直接暴露 Node 端口。升级时重建网页并重启 Node；数据目录保留。

Nginx 的 HTTPS `server` 块可使用以下位置配置，证书与域名使用自己的实际配置：

```nginx
location / {
    client_max_body_size 600k;
    proxy_set_header Host $http_host;
    proxy_pass http://127.0.0.1:8787;
    proxy_read_timeout 30s;
}
```

当前限速以直接连接地址计算，位于反向代理后会共享登录及配对尝试限制（每类 12 次/分钟），适合个人使用。没有公开注册、邮件找回或企业 SSO；首次环境变量只用于初始化账号，不会修改已有密码。正式部署不要运行 `npm start`，该命令是免登录的本机预览。

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
