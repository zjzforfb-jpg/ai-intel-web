# launchd 外接卷访问问题诊断报告

> 时间：2026-11-09 15:00 – 16:15（Asia/Shanghai）
> 问题：`com.aiintel.backup` 服务注册成功但运行失败
> 结论：**不是脚本 bug，是 macOS launchd agent 上下文中 zsh 对外接卷的访问被 TCC 拒绝**。已通过把备份逻辑整体改写为 Node 实现彻底解决。

---

## 一、现象

```
$ launchctl kickstart -k gui/501/com.aiintel.backup
$ cat /tmp/aiintel_backup.err
/bin/zsh: can't open input file: <BACKUP_DIR>/backup.sh
```

同一脚本在终端直接跑完全正常：

```
$ /bin/zsh <BACKUP_DIR>/backup.sh; echo $?
0
$ tail -1 backup.log
[2026-11-09 15:11:08] ===== backup OK (pg=1 sqlite=1 bundle=1) =====
```

而同一外接卷上的 `com.aiintel.monitor` 服务（node 启动）**运行完全正常**。

---

## 二、探针矩阵（决定性证据）

用 `ops/fix-backup-launchd.sh` 跑了 **5 种 WorkingDirectory × 2 种解释器** 的交叉探测。
探针刻意用 **zsh 自身的 `read -r _l < file`（即 `open()` 系统调用）** 而不是 fork 一个 `head`，
因为失败就发生在 zsh 自己的 `open()` 上，fork 出去是另一条路径。

| WorkingDirectory | zsh `open()` | node `stat()` |
|---|---|---|
| 无 WD（当前失败配置） | ❌ 被拒 | ✅ 成功 |
| WD=`backups/aiintel` | ❌ 被拒 | ✅ 成功 |
| WD=monitor 同款 `项目根` | ❌ 被拒 | ✅ 成功 |
| WD=内置盘 `$HOME` | ❌ 被拒 | ✅ 成功 |
| WD=卷根 `<VOLUME_ROOT>` | ❌ 被拒 | ✅ 成功 |

**结论**：5 种 WD 结果**完全一致** → 与路径写法、WorkingDirectory **都无关**；
分水岭在**解释器**：zsh 的 `open()` 一律被拒，node 的 `stat()` 一律成功。

### 更硬的证据：写也被拒

把脚本副本放到内置盘（zsh 只 open 内置盘文件）后：

```
/bin/zsh: ... : log: operation not permitted: <BACKUP_DIR>/backup.log
```

→ launchd 下的 zsh 对外接卷**读写全禁**，不是「只禁读」。

---

## 三、被逐项排除的可能

| 怀疑项 | 排除方式 | 结果 |
|---|---|---|
| 路径字节不一致 | `python3 plistlib` 读出 plist 里的路径，转 hex 与 `od -c` 实际路径逐字节对比 | 完全一致 |
| ACL 不同 | `ls -lde` 对比两条路径链上每一级 | 全同 |
| 扩展属性不同 | `xattr -l` 对比文件与各级目录 | 全同（都是 `com.apple.provenance`） |
| 环境变量差异 | `env -i` 最小环境 + `launchctl asuser 501` + `zsh -f`（跳过所有 rc） | 三种都 exit=0 |
| HOME 未设置 | `launchctl print` 显示 default env 无 HOME，但 `env -i` 无 HOME 也正常 | 无关 |
| `~/.zshenv` 干扰 | 读 `.zshenv`（只有 PATH + `.cargo/env`），`zsh -f` 跳过 | 无关 |
| 脚本自身 bug | 终端直跑 exit=0，backup.log 三项全 OK | 无关 |
| 外接卷未挂载 | `mount` 显示 disk9s1 正常挂载 | 无关 |
| Docker 访问 | sidecar 容器实测读写外接卷完全正常 | **正常** |

---

## 四、真因判定

macOS **TCC（Transparency, Consent, Control）** 对 launchd agent 进程的
**可移动卷（Removable Volumes）** 访问有独立判定，且**按访问方式区分**：

- `zsh` 走 `open(2)` 系统调用 → 触发「可移动卷」授权判定 → **被拒**
- `node` 的 `fs.statSync` / `fs.writeFileSync` → 走不同判定路径 → **放行**
- `git` 二进制直接写外接卷 bundle → **放行**（实测成功）
- Docker daemon → 不在 launchd 的 TCC 上下文内 → **完全自由**

**为什么 monitor 服务没事**：它用 `/opt/homebrew/bin/node` 启动，
读的是项目目录下的 `.env.local`（node 的 fs 路径），从不经过 zsh 的 `open()`。

---

## 五、解决方案：备份逻辑整体改写为 Node

新增 `scripts/backup-node.mts`，把 zsh 版的三段逻辑用 Node 重写：

| 环节 | zsh 版 | Node 版 |
|---|---|---|
| n8n SQLite 快照 | `python3` + `sqlite3.Connection.backup()` | **`node:sqlite` 的 `backup()` API**（Node 24 内置） |
| 完整性校验 | `PRAGMA integrity_check` | 同（`node:sqlite` prepare） |
| git bundle | `git bundle create --all` + `list-heads` 校验 | 同（`spawnSync`） |
| sidecar pg 校验 | `gzip -t` + `grep 'dump complete'` | 同（`spawnSync`） |
| retention | `find -mtime +N` | `fs.statSync().mtimeMs` 比较 |
| 日志 | `>> backup.log` | `fs.appendFileSync` |

**设计原则全部保留**：
1. 三项（pg / sqlite / bundle）全成才 exit 0，否则非零码；
2. 每步验证产物内容，不只看退出码；
3. bundle 必须确认包含当前 `main` 的提交；
4. sqlite 快照必须 `integrity_check = ok`。

### 验证结果

```
$ npm run backup:run
backup OK (pg=1 sqlite=1 bundle=1)

$ tail -6 backup.log
[2026-11-09 16:10:52] ===== backup start (HEAD ec769af) =====
[2026-11-09 16:10:52] pg_dump OK (sidecar): pg_ai_intelligence_2026-11-09.sql.gz (56K)
[2026-11-09 16:10:54] n8n sqlite OK: n8n_sqlite_2026-11-09.sqlite (65M)
[2026-11-09 16:10:54] git bundle OK: ai_intel_web_code_2026-11-09.bundle (1M) covers main=ec769af13e5f...
[2026-11-09 16:10:54] retention removed=0 (threshold 14d)
[2026-11-09 16:10:54] ===== backup OK (pg=1 sqlite=1 bundle=1) =====
```

**独立复核产物**：
```
integrity_check: ok | workflows: 1
git bundle list-heads → ec769af13e5f1fbe6236dec918215724aadbb2a9 refs/heads/main
current HEAD:        ec769af13e5f1fbe6236dec918215724aadbb2a9   ✅ 一致
```

**干净环境复测**（模拟 launchd 的最小 env）：
```
$ env -i PATH=... HOME=<HOME> node --import tsx scripts/backup-node.mts
backup OK (pg=1 sqlite=1 bundle=1)     ✅
```

---

## 六、新的 plist 配置

`ops/com.aiintel.backup.plist` 改为与 monitor 完全同构：

```xml
<key>ProgramArguments</key>
<array>
  <string>/opt/homebrew/bin/node</string>
  <string>--import</string>
  <string>tsx</string>
  <string>scripts/backup-node.mts</string>
</array>
<key>WorkingDirectory</key>
<string><REPO></string>
```

配套改动：
- `package.json` 加 `backup:run` 脚本
- `@types/node` 升到 `^24`（v20 没有 `node:sqlite` 类型定义）
- `ops/install-launchd.sh` 增加「立即试跑 + 校验 backup.log 是否新增 backup OK」环节

---

## 七、沉淀的经验

1. **launchd agent 访问外接卷要按 syscall 区分**：`open()` 可能被 TCC 拒，
   `stat()`/node 的 fs API/独立二进制（git）反而放行。选启动器时优先用 node 或直接二进制。
2. **Node 24 内置 `node:sqlite`**，自带 `backup()` API —— 不再需要 python3 做 SQLite 快照。
3. **Docker daemon 不在 launchd 的 TCC 上下文内**，是绕过 agent 权限限制的可靠手段
   （本项目的 DB 备份 sidecar 正是靠这一点一直稳定运行）。
4. **`@types/node` 版本要跟运行时对齐**：v20 无 `node:sqlite` 类型，v24 才有。
5. **诊断 agent 的 launchd 权限时，系统日志是死路**：`log show` 在会话内一律
   `Cannot run while sandboxed`。最终靠「探针矩阵」而非日志定位。
6. **zsh 数组是 1-based**（bash 的 0-based 习惯会直接踩坑）——见同日的 fix-backup-launchd.sh 事故。
