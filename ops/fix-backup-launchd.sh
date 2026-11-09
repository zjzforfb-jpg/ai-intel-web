#!/bin/zsh
# 诊断并修复 com.aiintel.backup launchd 服务
#
# 背景（2026-11-09）：
#   com.aiintel.monitor（node + 相对路径 + WorkingDirectory）在 launchd 下运行正常；
#   com.aiintel.backup（/bin/zsh + 外接卷绝对路径）运行报：
#       /bin/zsh: can't open input file: BACKUP_DIR//backup.sh
#   而同一脚本在终端直接跑完全正常（backup.log 三项全 OK）。
#   → 差异只在 launchd 的执行上下文，不在脚本本身。
#
# 本脚本分三步：
#   1. 访问探针：用 5 种 WorkingDirectory 跑同一个探针脚本，
#      探针用 zsh 自身的 open()（read < file）读外接卷文件 —— 这正是失败的那条 syscall。
#      由此定位「哪个 WD 能让 launchd 下的 zsh 读到外接卷」。
#   2. 真跑备份：用胜出的 WD，测「绝对路径」与「相对路径」两种调用方式，
#      判据 = backup.log 是否新增 "backup OK"。
#   3. 生成正式 plist、重新注册、立即 kickstart 验证。
#
# 用法（在你自己的 Terminal.app 里跑）：
#   zsh "PROJECT_ROOT/ai-intel-web/ops/fix-backup-launchd.sh"
#
# 只动 com.aiintel.backup 一个服务，不碰 monitor。
# backup.sh 本身幂等，重复执行安全。

set -uo pipefail

UID_NUM="$(id -u)"
LABEL="com.aiintel.backup"
AGENTS="$HOME/Library/LaunchAgents"
WORK="$HOME/aiintel-backup-fix"
BK="BACKUP_DIR/"
SCRIPT="$BK/backup.sh"
LOG="$BK/backup.log"
MONITOR_WD="PROJECT_ROOT/ai-intel-web"

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
# plist 生成：用 python3 plistlib，避开手写 XML 的 & 转义坑
#   $1=输出路径 $2=Label $3=WorkingDirectory(可空) $4=ProgramArguments(JSON 数组)
# ------------------------------------------------------------------
mk_plist() {
  /usr/bin/python3 - "$1" "$2" "$3" "$4" <<'PYEOF'
import plistlib, sys, json
out, label, wd, args_json = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
d = {
    "Label": label,
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
# 清理钩子：无论怎么退出，都把临时 label 摘掉
# ------------------------------------------------------------------
cleanup() {
  for L in com.aiintel.p1 com.aiintel.p2 com.aiintel.p3 com.aiintel.p4 com.aiintel.p5 \
           com.aiintel.b1 com.aiintel.b2; do
    launchctl bootout "gui/$UID_NUM/$L" 2>/dev/null
  done
}
trap cleanup EXIT INT TERM

# ------------------------------------------------------------------
# 探针脚本：放在内置盘。
#   关键：用 zsh 自身的 read < file（open()）读外接卷文件，而不是 fork 一个 head
#   —— 因为失败就发生在 zsh 的 open() 上，fork 出去的进程是另一条路径。
#   同时再跑一次 node 的 stat()，用来分离「WD 的问题」与「解释器的问题」。
# ------------------------------------------------------------------
cat > "$WORK/probe.sh" <<'PEOF'
#!/bin/zsh
exec 2>&1
echo "PROBE cwd=$(pwd)"
echo "PROBE HOME=[$HOME]"
if { read -r _l < BACKUP_DIR//backup.sh } 2>/dev/null; then
  echo "ZSH_OPEN_OK"
else
  echo "ZSH_OPEN_FAIL"
fi
if [ -r BACKUP_DIR//backup.sh ]; then echo "TEST_R_OK"; else echo "TEST_R_FAIL"; fi
if ls WORKBUDDY_DATA_DIR >/dev/null 2>&1; then echo "LIST_OK"; else echo "LIST_FAIL"; fi
if [ -d PROJECT_ROOT/ ]; then echo "MOVIE_DIR_OK"; else echo "MOVIE_DIR_FAIL"; fi
if [ -d WORKBUDDY_DATA_DIR ]; then echo "WB_DATA_DIR_OK"; else echo "WB_DATA_DIR_FAIL"; fi
PEOF
chmod +x "$WORK/probe.sh"

cat > "$WORK/probe.mjs" <<'PEOF'
import fs from "node:fs";
console.log("PROBE cwd=" + process.cwd());
try {
  const s = fs.statSync("BACKUP_DIR//backup.sh");
  console.log("NODE_STAT_OK size=" + s.size);
} catch (e) {
  console.log("NODE_STAT_FAIL " + e.code);
}
try {
  fs.readFileSync("BACKUP_DIR//backup.sh", "utf8");
  console.log("NODE_READ_OK");
} catch (e) {
  console.log("NODE_READ_FAIL " + e.code);
}
PEOF

# ------------------------------------------------------------------
# 第一步：访问探针（5 种 WorkingDirectory × 2 种解释器）
#   注意：zsh 数组是 1-based，索引从 1 开始。
# ------------------------------------------------------------------
probe_names=(
  "无 WD（当前失败配置）"
  "WD=备份目录 WorkBuddyData"
  "WD=monitor 同款 PROJECT_ROOT"
  "WD=内置盘 HOME"
  "WD=卷根 EXTERNAL_VOLUME/"
)
probe_wds=(
  ""
  "$BK"
  "$MONITOR_WD"
  "$HOME"
  "EXTERNAL_VOLUME/"
)

echo
echo "---- 第一步：访问探针（WD × 解释器 双矩阵）----"
BEST_WD=""
BEST_WD_IDX=0
WIN_NAME=""
NODE_CAN_READ=0
ZSH_CAN_READ=0

i=1
while [ $i -le ${#probe_names[@]} ]; do
  NAME="${probe_names[$i]}"
  WD="${probe_wds[$i]}"
  LBL="com.aiintel.p$i"
  PL="$WORK/$LBL.plist"

  # 每组先跑 zsh 探针，再跑 node 探针
  for INTERP in zsh node; do
    if [ "$INTERP" = "zsh" ]; then
      ARGS="[\"/bin/zsh\", \"$WORK/probe.sh\"]"
    else
      ARGS="[\"/opt/homebrew/bin/node\", \"$WORK/probe.mjs\"]"
    fi

    if ! mk_plist "$PL" "$LBL" "$WD" "$ARGS"; then
      printf "  %-28s %-5s plist 生成失败\n" "$NAME" "$INTERP"
      continue
    fi

    launchctl bootout "gui/$UID_NUM/$LBL" 2>/dev/null
    : > /tmp/aiintel_backup.out; : > /tmp/aiintel_backup.err

    BOOT_RC=0
    launchctl bootstrap "gui/$UID_NUM" "$PL" >"$WORK/boot.txt" 2>&1 || BOOT_RC=$?
    if [ $BOOT_RC -ne 0 ]; then
      printf "  %-28s %-5s bootstrap 失败：%s\n" "$NAME" "$INTERP" "$(head -1 "$WORK/boot.txt")"
      continue
    fi

    launchctl kickstart -k "gui/$UID_NUM/$LBL" >/dev/null 2>&1
    sleep 4

    OUT=$(cat /tmp/aiintel_backup.out 2>/dev/null)
    if echo "$OUT" | grep -q "ZSH_OPEN_OK"; then
      printf "  %-28s %-5s ✅ zsh open() 成功\n" "$NAME" "$INTERP"
      ZSH_CAN_READ=1
      if [ $BEST_WD_IDX -eq 0 ]; then
        BEST_WD="$WD"; BEST_WD_IDX=$i; WIN_NAME="$NAME"
      fi
    elif echo "$OUT" | grep -q "NODE_STAT_OK"; then
      printf "  %-28s %-5s ✅ node stat() 成功（zsh open() 失败）\n" "$NAME" "$INTERP"
      NODE_CAN_READ=1
      if [ $BEST_WD_IDX -eq 0 ]; then
        BEST_WD="$WD"; BEST_WD_IDX=$i; WIN_NAME="$NAME"
      fi
    elif echo "$OUT" | grep -q "ZSH_OPEN_FAIL"; then
      printf "  %-28s %-5s ❌ zsh open() 被拒\n" "$NAME" "$INTERP"
    elif echo "$OUT" | grep -q "NODE_STAT_FAIL"; then
      printf "  %-28s %-5s ❌ node stat() 也被拒\n" "$NAME" "$INTERP"
    else
      printf "  %-28s %-5s ⚠️  无输出  err=%s\n" "$NAME" "$INTERP" "$(head -1 /tmp/aiintel_backup.err 2>/dev/null)"
    fi

    launchctl bootout "gui/$UID_NUM/$LBL" 2>/dev/null
  done
  i=$((i + 1))
done

echo
echo "---- 探针结论 ----"
echo "  zsh open() 可读: $ZSH_CAN_READ    node stat() 可读: $NODE_CAN_READ"
if [ $ZSH_CAN_READ -eq 1 ]; then
  echo "  → 问题是 WorkingDirectory 选得不对。"
  USE_NODE=0
elif [ $NODE_CAN_READ -eq 1 ]; then
  echo "  → 问题是解释器（zsh 的 open() 触发 TCC，node 的 stat() 不触发）。"
  USE_NODE=1
  if [ $BEST_WD_IDX -eq 0 ]; then BEST_WD="$MONITOR_WD"; fi
else
  echo "  → 两种解释器都读不到，问题在更底层（TCC 授权/卷未挂载）。"
  USE_NODE=1
  BEST_WD="$MONITOR_WD"
fi
echo "  选用 WD: ${BEST_WD:-(无)}（探针首个成功项：$WIN_NAME）"

# ------------------------------------------------------------------
# 第二步：真跑备份（绝对路径 vs 相对路径）
#   判据 = backup.log 新增行里出现 "backup OK"
# ------------------------------------------------------------------
echo
echo "---- 真跑备份（判据：backup.log 新增 backup OK）----"

run_backup_test() {
  # $1=描述 $2=label $3=wd $4=ProgramArguments JSON
  local NAME="$1" LBL="$2" WD="$3" ARGS="$4"
  local PL="$WORK/$LBL.plist"

  if ! mk_plist "$PL" "$LBL" "$WD" "$ARGS"; then
    printf "  %-30s plist 生成失败\n" "$NAME"; return 1
  fi
  launchctl bootout "gui/$UID_NUM/$LBL" 2>/dev/null
  : > /tmp/aiintel_backup.out; : > /tmp/aiintel_backup.err

  local BOOT_RC=0
  launchctl bootstrap "gui/$UID_NUM" "$PL" >"$WORK/boot.txt" 2>&1 || BOOT_RC=$?
  if [ $BOOT_RC -ne 0 ]; then
    printf "  %-30s bootstrap 失败：%s\n" "$NAME" "$(head -1 "$WORK/boot.txt")"; return 1
  fi

  local BEFORE
  BEFORE=$(wc -l < "$LOG" 2>/dev/null || echo 0)
  launchctl kickstart -k "gui/$UID_NUM/$LBL" >/dev/null 2>&1

  local OK=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
    sleep 1
    local NOW
    NOW=$(wc -l < "$LOG" 2>/dev/null || echo 0)
    if [ "$NOW" -gt "$BEFORE" ]; then
      if tail -n +$((BEFORE + 1)) "$LOG" 2>/dev/null | grep -q "backup OK"; then OK=1; fi
      break
    fi
  done

  if [ $OK -eq 1 ]; then
    printf "  %-30s ✅ backup OK\n" "$NAME"
    return 0
  fi
  printf "  %-30s ❌ 未产生 backup OK   err=%s\n" "$NAME" "$(head -1 /tmp/aiintel_backup.err 2>/dev/null)"
  return 1
}

WIN_ARGS=""
WIN_DESC=""

# node 启动器：node 用 fs 读出脚本内容，通过 stdin 喂给 zsh。
# 这样 zsh 完全不需要 open() 外接卷上的脚本文件 —— 只 open(2) 标准输入。
# 若 node 的 stat() 能过而 zsh 的 open() 不能，这条路就能通。
cat > "$WORK/runner.mjs" <<'REOF'
import fs from "node:fs";
import { spawn } from "node:child_process";
const SCRIPT = "BACKUP_DIR//backup.sh";
let content;
try {
  content = fs.readFileSync(SCRIPT, "utf8");
} catch (e) {
  console.error("runner: 无法读取脚本: " + e.code + " " + e.message);
  process.exit(4);
}
const child = spawn("/bin/zsh", [], { stdio: ["pipe", "inherit", "inherit"] });
child.on("exit", (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
child.stdin.end(content);
REOF

# 候选配置表：解释器 × 路径写法
try_cfg() {
  # $1=描述 $2=label $3=wd $4=ProgramArguments JSON
  if [ -n "$WIN_ARGS" ]; then return 1; fi
  if run_backup_test "$1" "$2" "$3" "$4"; then
    WIN_ARGS="$4"
    WIN_DESC="$1"
    return 0
  fi
  return 1
}

# 1) zsh 直接执行（绝对路径）
try_cfg "zsh + 绝对路径" "com.aiintel.b1" "$BEST_WD" \
  "[\"/bin/zsh\", \"$SCRIPT\"]"

# 2) zsh + WD=备份目录 + 相对路径
if [ -z "$WIN_ARGS" ] && [ "$BEST_WD" != "$BK" ]; then
  try_cfg "zsh + WD 相对路径" "com.aiintel.b2" "$BK" \
    "[\"/bin/zsh\", \"backup.sh\"]"
fi

# 3) node 启动器（脚本内容走 stdin，zsh 不 open 外接卷文件）
if [ -z "$WIN_ARGS" ]; then
  try_cfg "node 启动器 + stdin 喂脚本" "com.aiintel.b3" "$BEST_WD" \
    "[\"/opt/homebrew/bin/node\", \"$WORK/runner.mjs\"]"
fi

# 4) node 启动器 + WD=备份目录
if [ -z "$WIN_ARGS" ]; then
  try_cfg "node 启动器 + WD=备份目录" "com.aiintel.b4" "$BK" \
    "[\"/opt/homebrew/bin/node\", \"$WORK/runner.mjs\"]"
fi

# 5) 兜底：脚本副本放内置盘（zsh 只 open 内置盘文件；产物路径仍写外接卷）
if [ -z "$WIN_ARGS" ]; then
  cp "$SCRIPT" "$WORK/backup-copy.sh"; chmod +x "$WORK/backup-copy.sh"
  try_cfg "zsh + 内置盘脚本副本" "com.aiintel.b5" "$BEST_WD" \
    "[\"/bin/zsh\", \"$WORK/backup-copy.sh\"]"
fi

echo
if [ -z "$WIN_ARGS" ]; then
  echo "✗ 所有配置都失败，需要进一步查 TCC 授权。"
  echo "  请把本脚本的完整输出发我。"
  exit 1
fi

echo "✅ 胜出配置：$WIN_DESC"
echo "   WorkingDirectory: ${BEST_WD:-(无)}"

# ------------------------------------------------------------------
# 第三步：把胜出配置固化到持久路径，再写正式 plist + 重新注册 + 立即验证
#   注意：若胜出配置依赖 $WORK 里的文件（node 启动器 / 脚本副本），
#   必须先落到持久位置，否则结尾清理 $WORK 会把服务依赖删掉。
# ------------------------------------------------------------------
echo
echo "---- 第三步：固化配置并重新注册 ----"
PERSIST="$HOME/Library/Application Support/aiintel-launchd"
mkdir -p "$PERSIST"

# 最终 ProgramArguments 可能含 $WORK，需替换成持久路径
FINAL_ARGS="$WIN_ARGS"
if echo "$FINAL_ARGS" | grep -q "$WORK"; then
  if echo "$FINAL_ARGS" | grep -q "runner.mjs"; then
    cp "$WORK/runner.mjs" "$PERSIST/backup-runner.mjs"
    FINAL_ARGS="${FINAL_ARGS//$WORK\/runner.mjs/$PERSIST\/backup-runner.mjs}"
    FINAL_ARGS="${FINAL_ARGS//$WORK/$PERSIST}"
    echo "   node 启动器已固化到 $PERSIST/backup-runner.mjs"
  elif echo "$FINAL_ARGS" | grep -q "backup-copy.sh"; then
    cp "$WORK/backup-copy.sh" "$PERSIST/backup.sh"
    chmod +x "$PERSIST/backup.sh"
    FINAL_ARGS="${FINAL_ARGS//$WORK\/backup-copy.sh/$PERSIST\/backup.sh}"
    FINAL_ARGS="${FINAL_ARGS//$WORK/$PERSIST}"
    echo "   脚本副本已固化到 $PERSIST/backup.sh"
  else
    FINAL_ARGS="${FINAL_ARGS//$WORK/$PERSIST}"
  fi
fi
echo "   最终 ProgramArguments: $FINAL_ARGS"

FINAL="$AGENTS/$LABEL.plist"
if [ -f "$FINAL" ]; then
  cp "$FINAL" "$FINAL.bak-$(date +%Y%m%d%H%M%S)"
  echo "   原 plist 已备份为 $LABEL.plist.bak-*"
fi

/usr/bin/python3 - "$FINAL" "$LABEL" "$BEST_WD" "$FINAL_ARGS" <<'PYEOF'
import plistlib, sys, json
dst, label, wd, args_json = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
d = {
    "Label": label,
    "ProgramArguments": json.loads(args_json),
    "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"},
    "StandardOutPath": "/tmp/aiintel_backup.out",
    "StandardErrorPath": "/tmp/aiintel_backup.err",
    "StartCalendarInterval": {"Hour": 9, "Minute": 40},
}
if wd:
    d["WorkingDirectory"] = wd
with open(dst, "wb") as f:
    plistlib.dump(d, f)
PYEOF
plutil -lint "$FINAL"

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null
: > /tmp/aiintel_backup.out; : > /tmp/aiintel_backup.err
launchctl bootstrap "gui/$UID_NUM" "$FINAL" 2>&1 | head -2

launchctl print "gui/$UID_NUM/$LABEL" 2>&1 | grep -E "state =|runs =|path =" | head -4

BEFORE2=$(wc -l < "$LOG" 2>/dev/null || echo 0)
launchctl kickstart -k "gui/$UID_NUM/$LABEL" >/dev/null 2>&1
FINAL_OK=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
  sleep 1
  NOW=$(wc -l < "$LOG" 2>/dev/null || echo 0)
  if [ "$NOW" -gt "$BEFORE2" ]; then
    if tail -n +$((BEFORE2 + 1)) "$LOG" 2>/dev/null | grep -q "backup OK"; then FINAL_OK=1; fi
    break
  fi
done

echo
echo "---- 最终状态 ----"
launchctl print "gui/$UID_NUM/$LABEL" 2>&1 | grep -E "state =|runs =|last exit code" | head -4
echo "--- stdout ---"; tail -3 /tmp/aiintel_backup.out 2>/dev/null
echo "--- stderr ---"; tail -3 /tmp/aiintel_backup.err 2>/dev/null
echo "--- backup.log 新增 ---"; tail -n +$((BEFORE2 + 1)) "$LOG" 2>/dev/null | tail -8

if [ $FINAL_OK -eq 1 ]; then
  echo
  echo "🎉 修复完成。明早 09:40 会自动跑备份。"
  echo "   验证：launchctl print gui/$UID_NUM/$LABEL | grep -E 'state|runs'"
  echo "   plist 已更新为：$WIN_DESC（WD=${BEST_WD:-(无)}）"
else
  echo
  echo "⚠️  正式服务仍未产生 backup OK，请把上面的输出发我。"
fi

rm -rf "$WORK"
echo "（临时测试服务与工作目录已清理）"
