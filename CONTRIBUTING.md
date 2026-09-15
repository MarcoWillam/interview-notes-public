# 贡献指南 (Contributing)

感谢你对本项目的关注。下面是在本地开发、运行测试和提交改动的基本流程。

## 环境要求

- Node.js 24 或更高版本
- 包管理器使用 npm

## 本地开发

```sh
npm ci
npm run dev          # 原 Vinext 页面开发入口
```

## 构建与运行（本地队列服务器 + 连接器）

```sh
npm run build:server  # 构建服务端
npm start             # 本地预览：启动队列服务器与独立连接器，自动配对本机，无需网页登录
```

> `npm start` 仅用于本机免登录预览，**不能**作为正式部署命令。正式部署见 `docs/deployment.md`。

## 测试与质量门禁

提交前请本地跑通以下命令（CI 也会执行同样的一组）：

```sh
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint
npm test             # node --test
npm run build        # vinext + vite 构建
```

## 分支与提交约定

- 默认分支为 `main`。
- 功能/修复请在独立分支开发，并通过 Pull Request 合并。
- 提交信息建议用中文或英文的祈使句，例如 `fix: 修正任务去重逻辑`、`feat: 增加补充追问分组`。
- 请勿在代码中提交任何密钥、令牌或个人绝对路径；所有敏感配置走 `.env`（已被 gitignore），示例见 `.env.example`。

## 目录速览

- `app/`：网页路由与 API 路由
- `components/`：面试工作台 UI 组件
- `lib/`：解析、队列、存储、协议等核心库
- `server/`：Node 队列服务器、连接器、账号与备份 CLI
- `hooks/`：客户端 hooks
- `tests/`：自动化测试
- `docs/`：产品说明与部署文档
- `deploy/`：服务器部署单元（systemd / nginx 示例）
- `scripts/`：构建前脚本与本地连接器示例
