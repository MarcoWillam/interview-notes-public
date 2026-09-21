# 安全政策 (Security Policy)

## 报告漏洞

请**私下**报告安全漏洞，不要公开提 Issue：

- 在仓库中发起 **GitHub Security Advisory**；或
- 发送邮件至安全联系人（请将下方占位替换为你的地址）：`<SECURITY_CONTACT@example.com>`

我们会在合理时间内确认并跟进修复。

## 本仓库不包含密钥

本项目刻意**不**包含任何 API key、token 或凭据：

- 模型分析（Codex）运行在用户**自己的电脑**上，使用其本机 ChatGPT / Codex 登录；
  服务器不持有任何模型凭据。
- 所有敏感配置通过 `.env` 提供，该文件已被 gitignore；示例见 `.env.example`。
- 部署所需的证书、连接器配对凭据位于 `.local/`，同样被 gitignore。

如果你在仓库中发现任何被提交的密钥或个人绝对路径，请立即按上述方式报告。

## 负责任披露

请给予我们合理的修复窗口期，不要公开利用细节，直到补丁发布。
