#!/bin/zsh
# 安装并验证 com.aiintel.backup（Node 版）launchd 服务
#
# 背景（2026-11-09 诊断结论）：
#   macOS launchd agent 上下文中，/bin/zsh 对外接卷的 open()/write() 一律被 TCC 拒绝
#   （can't open input file / operation not permitted）。
#   探针矩阵（5 种 WorkingDirectory × {zsh, node}）结果完全一致，
#   证明与路径写法、WorkingDirectory 无关 —— 分水岭在解释器：
#   zsh 的 open() 被拒，node 的 fs API 与 git 二进制放行。
#   → 备份逻辑已整体改写为 Node（scripts/backup-node.mts），本 plist 与 monitor 同构。
#
# 用法（在你自己的 Terminal.app 里跑）：
#   zsh "PROJECT_ROOT/ai-intel-web/ops/install-backup-node.sh"

set -uo pipefail

REPO="PROJECT_ROOT/ai-intel-web"
AGENTS="$HOME/Library/LaunchAgents"
LABEL="com.aiintel.backup"
UID_NUM="$(id -u)"
BKLOG="BACKUP_DIR//backup.log"

echo "=============================================="
echo " 安装 com.aiintel.backup（Node 版）"
echo " 时间: $(date '+%F %T')"
echo "=============================================="

echo "== 1. 部署 plist =="
cp "$REPO/ops/com.aiintel.backup.plist" "$AGENTS/"
plutil -lint "$AGENTS/$LABEL.plist"
plutil -p "$AGENTS/$LABEL.plist" | grep -E "WorkingDirectory|0 =>|1 =>|2 =>|3 =>" | head -6

echo
echo "== 2. 注册 =="
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null
if launchctl bootstrap "gui/$UID_NUM" "$AGENTS/$LABEL.plist" 2>&1 | head -2; then :; fi
launchctl print "gui/$UID_NUM/$LABEL" 2>&1 | grep -E "state =|runs =|path =" | head -4

echo
echo "== 3. 立即试跑（判据：backup.log 新增 backup OK）=="
BEFORE=$(wc -l < "$BKLOG" 2>/dev/null || echo 0)
: > /tmp/aiintel_backup.out; : > /tmp/aiintel_backup.err
launchctl kickstart -k "gui/$UID_NUM/$LABEL" >/dev/null 2>&1

# 备份要写 4 行日志、耗时约 3 秒，不能看到第一行就判定——
# 必须等到进程跑完（launchd 报 last exit code）或日志出现最终结论行。
OK=0
FINISHED=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  sleep 1
  NOW=$(wc -l < "$BKLOG" 2>/dev/null || echo 0)
  if [ "$NOW" -gt "$BEFORE" ]; then
    NEW=$(tail -n +$((BEFORE + 1)) "$BKLOG" 2>/dev/null)
    # 出现最终结论行才算跑完
    if echo "$NEW" | grep -q "backup OK"; then
      OK=1; FINISHED=1; break
    fi
    if echo "$NEW" | grep -q "backup FAILED"; then
      FINISHED=1; break
    fi
  fi
  # 进程已退出也算结束
  if launchctl print "gui/$UID_NUM/$LABEL" 2>&1 | grep -q "last exit code = (never exited)"; then
    :
  elif launchctl print "gui/$UID_NUM/$LABEL" 2>&1 | grep -qE "last exit code = [0-9]"; then
    sleep 1
    NOW=$(wc -l < "$BKLOG" 2>/dev/null || echo 0)
    if [ "$NOW" -gt "$BEFORE" ] && tail -n +$((BEFORE + 1)) "$BKLOG" 2>/dev/null | grep -q "backup OK"; then
      OK=1
    fi
    FINISHED=1; break
  fi
done

if [ $FINISHED -eq 0 ]; then
  echo "（等待 30 秒仍未见结论行，可能仍在运行或异常）"
fi

echo "--- backup.log 新增 ---"
tail -n +$((BEFORE + 1)) "$BKLOG" 2>/dev/null | tail -8
echo "--- stdout ---"; tail -3 /tmp/aiintel_backup.out 2>/dev/null
echo "--- stderr ---"; tail -3 /tmp/aiintel_backup.err 2>/dev/null
echo "--- launchd ---"
launchctl print "gui/$UID_NUM/$LABEL" 2>&1 | grep -E "state =|runs =|last exit code" | head -4

echo
if [ "$OK" -eq 1 ]; then
  echo "🎉 com.aiintel.backup 在 launchd 下跑通了。"
  echo "   明早 09:40 自动执行。验证："
  echo "   launchctl print gui/$UID_NUM/$LABEL | grep -E 'state|runs'"
else
  echo "⚠️  没有产生 'backup OK'，请把上面输出发我。"
  echo "   快速自查：node --import tsx scripts/backup-node.mts   （在仓库目录下执行）"
fi
