# 面谈 · 面试评估工作台

面向线下面试的 Chrome 网页应用。当前版本可录音、暂停、回放、下载、校对对话、填写人工结论和导出 Markdown。用户选择稍后配置服务，因此默认不启用自动转写和 AI 评估；没有模拟报告。

## 本地使用

需要 Node.js 22.13+（测试推荐 Node.js 24）。

```sh
npm ci
cp .env.example .env
npm run dev
```

Chrome 打开终端打印的 localhost 地址。正式环境必须使用 HTTPS。填写岗位和要求，确认已取得录音同意，再点击开始录音。

音频、候选人信息、文字和结论仅保留在当前页面内存。刷新、退出、崩溃或系统休眠可能造成丢失；录音结束后立即下载，结论完成后导出记录。页面在普通关闭/刷新时提供离开提示，但浏览器不保证所有场景都触发。录音上限为 60 分钟或约 20 MiB；达到上限自动停止，超过上传限制仍可下载。

## 接入模型服务

本地通过 Cloudflare Vite/Wrangler 加载项目 `.env`。如使用 `.dev.vars`，它优先于 `.env`。部署后在 Sites 的服务端环境变量中填写同名配置，重新部署生效。

| 功能 | 地址                | 密钥               | 模型             |
| ---- | ------------------- | ------------------ | ---------------- |
| 转写 | `ASR_BASE_URL`      | `ASR_API_KEY`      | `ASR_MODEL`      |
| 分析 | `ANALYSIS_BASE_URL` | `ANALYSIS_API_KEY` | `ANALYSIS_MODEL` |

BASE_URL 必须是 HTTPS，并包含提供商要求的版本前缀；末尾不包含具体接口路径。例如 `https://your-provider.example/v1`。转写请求追加 `/audio/transcriptions`，使用 multipart `file/model/response_format=json`，期望返回 `{ "text": "..." }`。分析追加 `/chat/completions`，要求提供商支持 `response_format: {type: "json_object"}`，从 `choices[0].message.content` 读取 JSON。

两项服务可以来自不同提供商。兼容接口不代表所有模型均支持，需要选定服务后验证文件格式、请求时限、模型名称和结构化输出。只有用户点击转写或分析时才发送对应资料，本站不持久保存音频或文本。密钥只留在服务端，不使用 NEXT_PUBLIC 前缀。配置检查仅检查字段是否齐全，不代表真实请求已经验证。

转写不会可靠识别真实身份；用户需校对说话人。AI 输出按原文验证引用；无证据不能评分；所有结果需人工确认。逐字匹配只能验证引用存在，不能证明模型对引用的解释正确。

## 验证

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

自动化覆盖输入限制、暂停计时、未配置服务、跨来源请求、请求大小、服务契约、上游错误隐藏、评分范围与引用原文真实性。服务测试使用确定性的 HTTP 替身，没有调用收费模型。

实际笔记本麦克风授权、设备中断、长时间录制和真实提供商尚需在 Chrome 做端到端验收。本轮未进行浏览器界面测试。可选 WebMCP `get_interview_assessment` 在支持环境中注册只读工具，当前无可用 WebMCP 验证上下文，不声称已联调通过。

设计范围见 `docs/spec.md`；实施记录见 `docs/superpowers/plans/2026-09-08-interview.md`。

Lint 覆盖自写应用、服务与测试；模板附带的未使用 Shadcn 组件保留原样，其已有 lint 报告不属于本次修改。
