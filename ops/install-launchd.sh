#!/bin/zsh
# 一键注册 AI 情报平台的两个 launchd 服务（需在你自己的终端里手动执行）
#
# 为什么不能在 AI 会话里做：
#   实测 agent 会话内 launchctl bootstrap / load -w / submit 全部被阻断：
#     - launchctl bootstrap gui/501 ...  → "Bootstrap failed: 5: Input/output error"
#     - launchctl load -w ...            → "Load failed: 5: Input/output error"
#     - launchctl submit ...             → exit 1，日志文件都不生成
#     - sudo -n / crontab                 → "operation not permitted"
#     - osascript ... with administrator privileges → 进程被 SIGTERM，密码弹窗不出现
#   这不是配置写错，是会话命名空间限制（最小 plist 也复现同样错误）。
#
# 用法（在你自己的 Terminal.app 里跑）：
#   zsh "PROJECT_ROOT/ai-intel-web/ops/install-launchd.sh"
#
# 卸载：
#   launchctl bootout gui/$(id -u)/com.aiintel.monitor
#   launchctl bootout gui/$(id -u)/com.aiintel.backup

set -euo pipefail

REPO="PROJECT_ROOT/ai-intel-web"
AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"

echo "== 1. 复制 plist 到 ~/Library/LaunchAgents =="
cp "$REPO/ops/com.aiintel.monitor.plist" "$AGENTS/"
cp "$REPO/ops/com.aiintel.backup.plist" "$AGENTS/"
echo "   ok"

echo "== 2. 语法校验 =="
plutil -lint "$AGENTS/com.aiintel.monitor.plist" "$AGENTS/com.aiintel.backup.plist"

echo "== 3. 注册服务 =="
for label in com.aiintel.monitor com.aiintel.backup; do
  # 幂等：已注册先摘掉
  launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$AGENTS/$label.plist"
  echo "   bootstrapped $label"
done

echo "== 4. 验证已加载 =="
for label in com.aiintel.monitor com.aiintel.backup; do
  echo "--- $label ---"
  launchctl print "gui/$UID_NUM/$label" 2>&1 | grep -E "state =|runs =|last exit code|path =" | head -4
done

echo
echo "完成。验收要点："
echo "  · 上面的 state 不应是 'Could not find service'"
echo "  · 明天 09:05 跑监控、09:40 跑备份（首次 runs 会从 0 变 1）"
echo "  · 想立即试跑：launchctl kickstart -k gui/$UID_NUM/com.aiintel.monitor"
echo "  · 日志：/tmp/aiintel_monitor.out / /tmp/aiintel_backup.out"
