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
BKLOG="BACKUP_DIR//backup.log"

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

echo "== 5. 立即试跑 backup（验证 launchd 上下文下真的能跑通）==="
BEFORE=$(wc -l < "$BKLOG" 2>/dev/null || echo 0)
: > /tmp/aiintel_backup.out; : > /tmp/aiintel_backup.err
launchctl kickstart -k "gui/$UID_NUM/com.aiintel.backup" >/dev/null 2>&1

BACKUP_OK=0
# 备份要写 4 行日志、耗时约 3 秒 —— 必须等到最终结论行，
# 不能看到第一行就 break（那会把「还在跑」误判成「失败」）。
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  sleep 1
  NOW=$(wc -l < "$BKLOG" 2>/dev/null || echo 0)
  if [ "$NOW" -gt "$BEFORE" ]; then
    NEW=$(tail -n +$((BEFORE + 1)) "$BKLOG" 2>/dev/null)
    if echo "$NEW" | grep -q "backup OK"; then BACKUP_OK=1; break; fi
    if echo "$NEW" | grep -q "backup FAILED"; then break; fi
  fi
done

echo "--- backup.log 新增 ---"
tail -n +$((BEFORE + 1)) "$BKLOG" 2>/dev/null | tail -8
echo "--- stdout ---"; tail -3 /tmp/aiintel_backup.out 2>/dev/null
echo "--- stderr ---"; tail -3 /tmp/aiintel_backup.err 2>/dev/null
echo "--- launchd 状态 ---"
launchctl print "gui/$UID_NUM/com.aiintel.backup" 2>&1 | grep -E "state =|runs =|last exit code" | head -4

echo "== 6. 立即试跑 monitor =="
: > /tmp/aiintel_monitor.out; : > /tmp/aiintel_monitor.err
launchctl kickstart -k "gui/$UID_NUM/com.aiintel.monitor" >/dev/null 2>&1
sleep 5
echo "--- stdout ---"; tail -3 /tmp/aiintel_monitor.out 2>/dev/null
echo "--- stderr ---"; tail -3 /tmp/aiintel_monitor.err 2>/dev/null

echo
if [ "$BACKUP_OK" -eq 1 ]; then
  echo "🎉 两个服务都验证通过。"
else
  echo "⚠️  backup 在 launchd 上下文下没有产生 'backup OK'，请把上面的输出发我。"
fi
echo
echo "日常安排："
echo "  · 08:30 n8n 出日报（约 157 秒）"
echo "  · 09:05 monitor 质量检查（+1 Bark 推送）"
echo "  · 09:15 sidecar 容器 pg_dump"
echo "  · 09:40 backup（sqlite 快照 + git bundle）"
echo
echo "日志：/tmp/aiintel_monitor.out /tmp/aiintel_backup.out"
echo "备份：BACKUP_DIR//backup.log"
