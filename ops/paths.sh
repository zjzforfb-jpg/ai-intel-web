#!/bin/zsh
# AI 情报平台 —— 路径与运行时配置（被 ops/*.sh 与 launchd 安装流程共用）
#
# 设计目标：让仓库可以在任意机器上克隆后直接可用，不把某台机器的
#   个人目录名（用户名 / 项目名 / 外接卷名）写死在代码和配置里。
#
# 优先级（从高到低）：
#   1. 环境变量（适合 CI / 一次性覆盖）
#   2. ops/paths.local.sh（每台机器的本地配置，不入库）
#   3. 本文件的默认值（相对仓库自推导，跨机器安全）
#
# 本机如需指向外接卷，新建 ops/paths.local.sh（该文件已在 .gitignore 中）：
#   AIINTEL_BACKUP_DIR="/Volumes/<你的卷名>/<备份目录>"
#   AIINTEL_REPO="/Volumes/<你的卷名>/<项目目录>/ai-intel-web"

# 仓库根目录：由本文件位置自推导（ops/ 的上一级），不依赖调用方 cwd
# ${0:A} 是 zsh 的绝对路径展开
AIINTEL_REPO="${AIINTEL_REPO:-${${0:A}:h:h}}"

# 备份输出目录：默认放用户主目录，跨机器安全
AIINTEL_BACKUP_DIR="${AIINTEL_BACKUP_DIR:-$HOME/WorkBuddyData/backups/aiintel}"

# Node 可执行文件：优先 Homebrew，其次 PATH
AIINTEL_NODE_BIN="${AIINTEL_NODE_BIN:-$(command -v node 2>/dev/null || echo /opt/homebrew/bin/node)}"

# n8n 相关容器名（docker compose 约定，可按需覆盖）
AIINTEL_N8N_CONTAINER="${AIINTEL_N8N_CONTAINER:-n8n-radar}"
AIINTEL_PG_CONTAINER="${AIINTEL_PG_CONTAINER:-n8n-radar-postgres}"

# 备份日志文件
AIINTEL_BACKUP_LOG="${AIINTEL_BACKUP_LOG:-$AIINTEL_BACKUP_DIR/backup.log}"

# 读取本机私有配置（若存在）。放在最后，覆盖前面的默认值。
if [ -f "${${0:A}:h}/paths.local.sh" ]; then
  source "${${0:A}:h}/paths.local.sh"
fi

export AIINTEL_REPO AIINTEL_BACKUP_DIR AIINTEL_NODE_BIN
export AIINTEL_N8N_CONTAINER AIINTEL_PG_CONTAINER AIINTEL_BACKUP_LOG
