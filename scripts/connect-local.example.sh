#!/bin/sh
# 本地连接器启动示例（通用版，已去除任何个人绝对路径）
#
# 该连接器把你的电脑与面试服务器配对，并在本机调用 Codex 完成分析。
# 前置条件：Node.js 24+、已通过 ChatGPT 登录的 Codex CLI。
#
# 用法：
#   1) 在网页「电脑连接」生成一次性配对码；
#   2) 复制本文件为 connect-local.sh 并赋可执行权限；
#   3) 取消下方对应注释后运行：
#
#      # 方式 A：用配对码首次配对
#      npm run connector -- --server "${INTERVIEW_SERVER:-https://your-workspace.example}" --pair "<PAIRING_CODE>"
#
#      # 方式 B：复用已生成的连接器配置（位于 .local/connector.json，已被 gitignore）
#      # npm run connector -- --config ./.local/connector.json
#
# 可选：指定 codex 二进制路径（macOS ChatGPT 应用内置示例，按需修改）
# export INTERVIEW_CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex

set -e
npm run connector -- --server "${INTERVIEW_SERVER:-https://your-workspace.example}" "$@"
