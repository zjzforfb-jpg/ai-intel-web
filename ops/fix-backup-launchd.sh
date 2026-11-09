#!/bin/zsh
# 诊断并修复 com.aiintel.backup launchd 服务
#
# 背景（2026-11-09）：
#   com.aiintel.monitor（node + 相对路径 + WorkingDirectory）在 launchd 下运行正常；
#   com.aiintel.backup（/bin/zsh + 外接卷绝对路径）运行报：
#       /bin/zsh: can't open input file: BACKUP_DIR//backup.sh
#   而同一脚本在终端直接跑完全正常（backup.log 三项全 OK）。
#   说明差异只在 launchd 的执行上下文，不在脚本本身。
#
# 本脚本做三件事：
#   1. 用 5 种配置实测（每次都真跑一次备份，以 backup.log 是否新增 "backup OK" 为判据）
#   2. 自动选出击通的那一种，生成正式 com.aiintel.backup.plist
#   3. 重新注册 + 立即 kickstart 验证，输出结论
#
# 用法（在你自己的 Terminal.app 里跑）：
#   zsh "PROJECT_ROOT/ai-intel-web/ops/fix-backup-launchd.sh"
#
# 安全性：
#   - backup.sh 本身幂等，重复执行安全
#   - 只动 com.aiintel.backup 一个服务，不碰 monitor
#   - 测试用的临时 label 结束前全部 bootout 清理

set -uo pipefail

UID_NUM="$(id -u)"
LABEL="com.aiintel.backup"
AGENTS="$HOME/Library/LaunchAgents"
WORK="$HOME/aiintel-backup-fix"
BK="BACKUP_DIR/"
SCRIPT="$BK/backup.sh"
LOG="$BK/backup.log"

echo "=============================================="
echo " com.aiintel.backup 诊断与修复"
echo " 时间: $(date '+%F %T')"
echo "=============================================="

if [ ! -f "$SCRIPT" ]; then
  echo "✗ 找不到备份脚本: $SCRIPT"
  exit 1
fi
echo "✓ 备份脚本存在: $SCRIPT"

mkdir -p "$WORK"

# ------------------------------------------------------------------
# 用 python3 生成 plist，避开手写 XML 的 & 转义坑
# ------------------------------------------------------------------
gen_plist() {
  # $1=输出路径  $2=ProgramArguments(JSON)  $3=WorkingDirectory(可空)
  /usr/bin/python3 - "$1" "$2" "$3" <<'PYEOF'
import plistlib, sys, json
out, args_json, wd = sys.argv[1], sys.argv[2], sys.argv[3]
d = {
    "Label": "com.aiintel.backup",
    "ProgramArguments": json.loads(args_json),
    "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"},
    "StandardOutPath": "/tmp/aiintel_backup.out",
    "StandardErrorPath": "/tmp/aiintel_backup.err",
}
if wd:
    d["WorkingDirectory"] = wd
with open(out, "wb") as f:
    plistlib.dump(d, f)
PYEOF
}

# ------------------------------------------------------------------
# 测试配置
#   A: 无 WorkingDirectory + 外接卷绝对路径          （当前失败配置）
#   B: WorkingDirectory=备份目录 + 外接卷绝对路径
#   C: WorkingDirectory=备份目录 + 相对路径 backup.sh
#   D: WorkingDirectory=内置盘 + 内置盘 wrapper（wrapper 内绝对路径调用）
#   E: WorkingDirectory=内置盘 + 内置盘脚本副本（完整复制，产物路径不变）
# ------------------------------------------------------------------

# wrapper：放在内置盘，由它去调外接卷脚本
cat > "$WORK/wrapper.sh" <<'EOF'
#!/bin/zsh
exec /bin/zsh BACKUP_DIR//backup.sh
EOF
chmod +x "$WORK/wrapper.sh"

# E 用：脚本副本放在内置盘
cp "$SCRIPT" "$WORK/backup-copy.sh"
chmod +x "$WORK/backup-copy.sh"

# 记录当前 backup.log 行数，用于判定本轮是否真的跑成功
LOG_LINES_BEFORE=$(wc -l < "$LOG" 2>/dev/null || echo 0)

declare -a TEST_NAMES=()
declare -a TEST_LABELS=()
declare -a TEST_ARGV=()
declare -a TEST_WD=()

TEST_NAMES+=("A 无WD+绝对路径(现状)")
TEST_LABELS+=("com.aiintel.tA")
TEST_ARGV+=("[\"/bin/zsh\", \"$SCRIPT\"]")
TEST_WD+=("")

TEST_NAMES+=("B WD=备份目录+绝对路径")
TEST_LABELS+=("com.aiintel.tB")
TEST_ARGV+=("[\"/bin/zsh\", \"$SCRIPT\"]")
TEST_WD+=("$BK")

TEST_NAMES+=("C WD=备份目录+相对路径")
TEST_LABELS+=("com.aiintel.tC")
TEST_ARGV+=("[\"/bin/zsh\", \"backup.sh\"]")
TEST_WD+=("$BK")

TEST_NAMES+=("D WD=内置盘+内置wrapper")
TEST_LABELS+=("com.aiintel.tD")
TEST_ARGV+=("[\"/bin/zsh\", \"$WORK/wrapper.sh\"]")
TEST_WD+=("$WORK")

TEST_NAMES+=("E WD=内置盘+脚本副本")
TEST_LABELS+=("com.aiintel.tE")
TEST_ARGV+=("[\"/bin/zsh\", \"$WORK/backup-copy.sh\"]")
TEST_WD+=("$WORK")

echo
echo "---- 第一步：5 组对照实测 ----"
PASS_LABEL=""
PASS_NAME=""
PASS_IDX=-1

i=0
while [ $i -lt ${#TEST_NAMES[@]} ]; do
  NAME="${TEST_NAMES[$i]}"
  LBL="${TEST_LABELS[$i]}"
  PL="$WORK/$LBL.plist"

  gen_plist "$PL" "${TEST_ARGV[$i]}" "${TEST_WD[$i]}" || { echo "  [$NAME] plist 生成失败"; i=$((i+1)); continue; }

  launchctl bootout "gui/$UID_NUM/$LBL" 2>/dev/null
  : > /tmp/aiintel_backup.out; : > /tmp/aiintel_backup.err

  BOOT_RC=0
  launchctl bootstrap "gui/$UID_NUM" "$PL" >/tmp/aiintel_boot.txt 2>&1 || BOOT_RC=$?

  if [ $BOOT_RC -ne 0 ]; then
    printf "  %-28s bootstrap 失败: %s\n" "$NAME" "$(head -1 /tmp/aiintel_boot.txt)"
    i=$((i+1)); continue
  fi

  launchctl kickstart -k "gui/$UID_NUM/$LBL" >/dev/null 2>&1

  # 等备份完成（脚本约 3-6 秒）
  DONE=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    sleep 1
    NOW=$(wc -l < "$LOG" 2>/dev/null || echo 0)
    if [ "$NOW" -gt "$LOG_LINES_BEFORE" ]; then
      DONE=1
      break
    fi
  done

  NEWLOG=$(tail -n +$((LOG_LINES_BEFORE + 1)) "$LOG" 2>/dev/null)
  if echo "$NEWLOG" | grep -q "backup OK"; then
    printf "  %-28s ✅ 通过（backup.log 记录 backup OK）\n" "$NAME"
    if [ -z "$PASS_LABEL" ]; then
      PASS_LABEL="$LBL"; PASS_NAME="$NAME"; PASS_IDX=$i
    fi
  elif [ $DONE -eq 1 ]; then
    printf "  %-28s ⚠️  有日志但非 OK: %s\n" "$NAME" "$(echo "$NEWLOG" | tail -1)"
  else
    printf "  %-28s ❌ 失败: %s\n" "$NAME" "$(head -1 /tmp/aiintel_backup.err 2>/dev/null)"
  fi

  launchctl bootout "gui/$UID_NUM/$LBL" 2>/dev/null
  i=$((i+1))
done

echo
echo "---- 第二步：结论 ----"
if [ $PASS_IDX -lt 0 ]; then
  echo "✗ 五种配置全部失败。"
  echo "  这说明问题不在「路径写法」这一层，需要进一步查 TCC / 外接卷访问授权。"
  echo "  请把本脚本输出发我，我继续定位。"
  exit 1
fi

echo "✅ 最佳配置: $PASS_NAME"
echo "   模板: ${TEST_ARGV[$PASS_IDX]}   WorkingDirectory: ${TEST_WD[$PASS_IDX]:-(无)}"

# ------------------------------------------------------------------
# 生成正式 plist
# ------------------------------------------------------------------
FINAL="$AGENTS/$LABEL.plist"
if [ -f "$FINAL" ]; then
  cp "$FINAL" "$FINAL.bak-$(date +%Y%m%d%H%M%S)"
  echo "   原 plist 已备份为 $FINAL.bak-*"
fi

# 复用测试阶段的 plist，只改回正式 label 与日志路径
/usr/bin/python3 - "$WORK/$PASS_LABEL.plist" "$FINAL" "$LABEL" <<'PYEOF'
import plistlib, sys
src, dst, label = sys.argv[1], sys.argv[2], sys.argv[3]
with open(src, "rb") as f:
    d = plistlib.load(f)
d["Label"] = label
d["StandardOutPath"] = "/tmp/aiintel_backup.out"
d["StandardErrorPath"] = "/tmp/aiintel_backup.err"
d["StartCalendarInterval"] = {"Hour": 9, "Minute": 40}
with open(dst, "wb") as f:
    plistlib.dump(d, f)
PYEOF

plutil -lint "$FINAL"

echo
echo "---- 第三步：重新注册并立即验证 ----"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null
: > /tmp/aiintel_backup.out; : > /tmp/aiintel_backup.err

if ! launchctl bootstrap "gui/$UID_NUM" "$FINAL" 2>&1 | head -2; then :; fi
launchctl print "gui/$UID_NUM/$LABEL" 2>&1 | grep -E "state =|runs =|path =" | head -4

LOG_LINES_BEFORE2=$(wc -l < "$LOG" 2>/dev/null || echo 0)
launchctl kickstart -k "gui/$UID_NUM/$LABEL" >/dev/null 2>&1
FINAL_OK=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 1
  NOW=$(wc -l < "$LOG" 2>/dev/null || echo 0)
  if [ "$NOW" -gt "$LOG_LINES_BEFORE2" ]; then FINAL_OK=1; break; fi
done

echo
echo "---- 最终状态 ----"
launchctl print "gui/$UID_NUM/$LABEL" 2>&1 | grep -E "state =|runs =|last exit code" | head -4
echo "--- stdout ---"; tail -3 /tmp/aiintel_backup.out 2>/dev/null
echo "--- stderr ---"; tail -3 /tmp/aiintel_backup.err 2>/dev/null
echo "--- backup.log 新增 ---"; tail -n +$((LOG_LINES_BEFORE2 + 1)) "$LOG" 2>/dev/null | tail -8

if [ $FINAL_OK -eq 1 ]; then
  echo
  echo "🎉 修复完成。明天 09:40 会自动跑备份。"
  echo "   验证: launchctl print gui/$UID_NUM/$LABEL | grep -E 'state|runs'"
else
  echo
  echo "⚠️  正式服务仍未产生日志，请把上面的输出发我。"
fi

# 清理临时 label 与测试文件
for L in com.aiintel.tA com.aiintel.tB com.aiintel.tC com.aiintel.tD com.aiintel.tE; do
  launchctl bootout "gui/$UID_NUM/$L" 2>/dev/null
done
rm -rf "$WORK"
echo "（临时测试服务已清理）"
