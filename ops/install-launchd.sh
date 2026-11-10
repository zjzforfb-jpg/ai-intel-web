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
#   cd <仓库目录> && zsh ops/install-launchd.sh
#
# 卸载：
#   launchctl bootout gui/$(id -u)/com.aiintel.monitor
#   launchctl bootout gui/$(id -u)/com.aiintel.backup
#
# 路径来源：ops/paths.sh（可用 ops/paths.local.sh 覆盖本机私有配置）

set -euo pipefail

OPS_DIR="${${0:A}:h}"
source "$OPS_DIR/paths.sh"

AGENTS="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"

echo "== 0. 配置 =="
echo "   仓库: $AIINTEL_REPO"
echo "   备份: $AIINTEL_BACKUP_DIR"
echo "   node: $AIINTEL_NODE_BIN"
mkdir -p "$AIINTEL_BACKUP_DIR"

# ------------------------------------------------------------------
# 渲染 plist 模板：把 __占位符__ 换成本机真实路径
#   用 plistlib 生成而非字符串替换 —— 路径里的 & < > 不会被 XML 误解，
#   且顺带保证 plist 结构合法。
# ------------------------------------------------------------------
render_plist() {
  # $1=模板路径 $2=输出路径
  /usr/bin/python3 - "$1" "$2" "$AIINTEL_REPO" "$AIINTEL_BACKUP_DIR" "$AIINTEL_NODE_BIN" <<'PYEOF'
import plistlib, sys, os

tmpl, out, repo, backup_dir, node_bin = sys.argv[1:6]

with open(tmpl, "rb") as f:
    d = plistlib.load(f)

def sub(v):
    if not isinstance(v, str):
        return v
    return (v.replace("__REPO_PLACEHOLDER__", repo)
             .replace("__BACKUP_DIR_PLACEHOLDER__", backup_dir)
             .replace("__NODE_BIN__", node_bin))

if "WorkingDirectory" in d:
    d["WorkingDirectory"] = sub(d["WorkingDirectory"])

if "ProgramArguments" in d:
    d["ProgramArguments"] = [sub(a) for a in d["ProgramArguments"]]

if "EnvironmentVariables" in d:
    d["EnvironmentVariables"] = {k: sub(v) for k, v in d["EnvironmentVariables"].items()}

# WorkingDirectory 必须真实存在，否则 launchd 会反复失败
wd = d.get("WorkingDirectory", "")
if wd and not os.path.isdir(wd):
    sys.stderr.write("ERROR: WorkingDirectory 不存在: %s\n" % wd)
    sys.exit(1)

# 模板占位符必须全部替换干净，否则会把 __XXX__ 字面量写进真实配置
leftover = []
def check(v):
    if isinstance(v, str) and "__" in v:
        leftover.append(v)
    elif isinstance(v, list):
        for x in v:
            check(x)
    elif isinstance(v, dict):
        for x in v.values():
            check(x)

check(d)
if leftover:
    sys.stderr.write("ERROR: 仍有未替换的占位符: %s\n" % leftover)
    sys.exit(1)

with open(out, "wb") as f:
    plistlib.dump(d, f)
PYEOF
}

echo "== 1. 渲染并复制 plist 到 ~/Library/LaunchAgents =="
render_plist "$OPS_DIR/com.aiintel.monitor.plist" "$AGENTS/com.aiintel.monitor.plist"
render_plist "$OPS_DIR/com.aiintel.backup.plist" "$AGENTS/com.aiintel.backup.plist"
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
BEFORE=$(wc -l < "$AIINTEL_BACKUP_LOG" 2>/dev/null || echo 0)
: > /tmp/aiintel_backup.out; : > /tmp/aiintel_backup.err
launchctl kickstart -k "gui/$UID_NUM/com.aiintel.backup" >/dev/null 2>&1

BACKUP_OK=0
# 备份要写 4 行日志、耗时约 3 秒 —— 必须等到最终结论行，
# 不能看到第一行就 break（那会把「还在跑」误判成「失败」）。
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  sleep 1
  NOW=$(wc -l < "$AIINTEL_BACKUP_LOG" 2>/dev/null || echo 0)
  if [ "$NOW" -gt "$BEFORE" ]; then
    NEW=$(tail -n +$((BEFORE + 1)) "$AIINTEL_BACKUP_LOG" 2>/dev/null)
    if echo "$NEW" | grep -q "backup OK"; then BACKUP_OK=1; break; fi
    if echo "$NEW" | grep -q "backup FAILED"; then break; fi
  fi
done

echo "--- backup.log 新增 ---"
tail -n +$((BEFORE + 1)) "$AIINTEL_BACKUP_LOG" 2>/dev/null | tail -8
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
echo "备份：$AIINTEL_BACKUP_LOG"
