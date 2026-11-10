# GitHub 发布手册

> 生成时间：2026-11-10
> 适用对象：`ai-intel-web` 仓库推到 GitHub
> 当前状态：**已完成全部去敏改造，待创建远程仓库并推送**

---

## 一、本次做了什么（去敏全记录）

### 1.1 扫描结果

| 风险面 | 扫描方法 | 命中 | 处置 |
|---|---|---|---|
| 密钥 / Token | `sk-` `ghp_` `AKIA` `xox` `BEGIN PRIVATE KEY` `eyJ*.` | 0 | 无需处理 |
| 邮箱 / 手机号 | 主流邮箱域 + `1[3-9]xxxxxxxxx` | 0 | 无需处理 |
| 真实姓名 / 他人项目 | 中文姓名与项目名关键词 | 6 处 | 占位符替换 |
| 个人绝对路径 | 用户主目录与外接卷根路径前缀 | 40+ 处 | 占位符替换 + 抽成配置项 |
| 提交者邮箱 | `git log --pretty='%an <%ae>'` | 2 个身份 | filter-repo 重写为 noreply |
| 内网 IP | 正则扫全仓 | 2 处（文档） | 属 Docker 内网，无害，保留 |
| 依赖镜像源 | 国内 npm 镜像域名 | 250 处 | 切到 npm 官方源 |
| 构建缓存入历史 | `git rev-list --objects` | 171 MB | filter-repo 剔除 |
| `.env` / 凭据文件 | `git log --diff-filter=A` | 从未提交 | 无需处理 |

> ⚠️ **本手册刻意不写出具体的敏感字符串**（原始姓名、邮箱、路径前缀）。
> 写在这里等于重新把它们泄露进仓库——扫描命令请自行填入要查的关键词。

### 1.2 仓库体积

```
改造前：146 MB   （其中 .next-stale Turbopack 缓存占 171 MB 原始对象）
改造后：  1.4 MB
```

`.git` 从 146M → 1.4M，**降幅 99%**。原因是历史上误提交了 Next.js 的
Turbopack 构建缓存目录 `.next-stale-1794222289/`，里面单个 `.sst` 文件就有 74.8 MB。

### 1.3 关键决策：为什么必须重写历史

不能只「删掉当前文件里的敏感信息」——**旧提交里仍然存着**。GitHub 上任何人
都能翻到任意历史版本，`.next-stale` 里的旧文件、含真实姓名的文档旧版、
以及作者的 Gmail 邮箱都会暴露。

所以做了完整的历史重写（`git-filter-repo`）：

| 操作 | 手段 | 结果 |
|---|---|---|
| 剔除构建缓存 | `--path-glob '.next-stale-*/**' --invert-paths` | 0 残留 |
| 改写作者身份 | `--mailmap .mailmap`（文件在本地，不入库） | 统一为 `aiintel-dev@users.noreply.github.com` |
| 替换历史文本路径 | `--replace-text` | 绝对路径 → 占位符 |

---

## 二、代码层面的可移植化改造

去敏不能只删字——**改完还得能用**。本次做了这些结构性改造：

### 2.1 新增 `ops/paths.sh`（配置集中管理）

```bash
AIINTEL_REPO          # 仓库根，默认由文件位置自推导
AIINTEL_BACKUP_DIR    # 备份目录，默认 $HOME/WorkBuddyData/backups/aiintel
AIINTEL_NODE_BIN      # node 绝对路径
AIINTEL_N8N_CONTAINER / AIINTEL_PG_CONTAINER
```

优先级：**环境变量 > `ops/paths.local.sh`（已 gitignore）> 默认值**

### 2.2 `ops/*.plist` 改为模板

入库版本不含任何个人目录名，用占位符：

| 占位符 | 安装时替换为 |
|---|---|
| `__REPO_PLACEHOLDER__` | 仓库根绝对路径 |
| `__BACKUP_DIR_PLACEHOLDER__` | 备份目录绝对路径 |
| `__NODE_BIN__` | node 绝对路径 |

`ops/install-launchd.sh` 在部署时用 **Python `plistlib`** 渲染（而非字符串替换），
避免路径里的 `&` `<` `>` 被 XML 误解；同时会校验「占位符是否替换干净」。

### 2.3 顺手修掉一个隐藏 bug

改造过程中发现 `new URL(import.meta.url).pathname` 会把中文与空格编码成
`%20` / `%E6%88%91...`，导致 `backup-node.mts` 找不到仓库目录
（`git bundle` 报 `cannot change to '...'`）。已改用 `fileURLToPath`。

---

## 三、推送步骤

### 步骤 0：备份保底（已自动完成）

```bash
# 全 refs bundle，任何操作都能回滚
<BACKUP_DIR>/aiintel-web-prepush-*.bundle
```

### 步骤 1：创建 GitHub 仓库

在 https://github.com/new 创建：

- **仓库名**：`ai-intel-web`（或你喜欢的名字）
- **可见性**：
  - **Private（推荐）**——这个项目含完整业务逻辑与阶段报告，公开前建议先私有
  - Public——已完成去敏，技术上可公开
- **不要勾选**任何 `Add a README file` / `.gitignore` / `LICENSE`（本地已有，避免冲突）
- **不要**初始化 git（本地已有）

也可以用 `gh` CLI 一行建好：

```bash
gh repo create <你的用户名>/ai-intel-web --private --source=. --remote=origin
```

### 步骤 2：拿到远程地址

```bash
# SSH（推荐，配好密钥后免密）
git@github.com:<你的用户名>/ai-intel-web.git

# 或 HTTPS
https://github.com/<你的用户名>/ai-intel-web.git
```

### 步骤 3：推送「已重写的干净历史」

**推荐做法 —— 推送备份区里的重写版镜像**（历史已脱敏、体积已瘦身）：

```bash
cd <BACKUP_DIR>/ai-intel-web-github.git

# 绑定远程并推送
git remote add origin git@github.com:<你的用户名>/ai-intel-web.git
git push -u origin main
git push -u origin ui/redesign
```

> ⚠️ 推送后 GitHub 上会有 "forced update" 的痕迹（因为历史被重写过）。
> 因为这是首次推送，没有别人 clone 过，不影响任何人。

**或者 —— 在本地仓库上重写后推送**（保留原目录的 git 配置）：

```bash
cd <REPO>

# 备份当前 .git（保险）
cp -r .git <BACKUP_DIR>/git-dir-backup-$(date +%Y%m%d%H%M%S)

# 同样的 filter-repo 命令（工具需先装：pip install git-filter-repo）
# ⚠️ 把下面的 <占位符> 换成你机器上的真实路径
git filter-repo --force \
  --path-glob '.next-stale-*/**' --invert-paths \
  --mailmap .mailmap \
  --replace-text <(printf '%s\n' \
    'literal:<REPO_ROOT>/==>PROJECT_ROOT/' \
    'literal:<BACKUP_DIR>==>BACKUP_DIR/' \
    'literal:<HOME_DIR>==>HOME_DIR/')

git remote add origin git@github.com:<你的用户名>/ai-intel-web.git
git push -u origin main
git push -u origin ui/redesign
```

### 步骤 4：设置默认分支

GitHub 上 `Settings → Branches → Default branch` 设为 `main`。

---

## 四、克隆后的使用（给别人 / 给自己换机器）

```bash
git clone git@github.com:<你的用户名>/ai-intel-web.git
cd ai-intel-web

# 1. 装依赖（lockfile 已指向 npm 官方源，任意网络都能成功）
npm ci

# 2. 配环境变量
cp .env.example .env.local
# 从你的 n8n-radar/.env 同步 DB_USER / DB_PASSWORD 等真实值

# 3. 数据库迁移（按序执行 migrations/ 下的 SQL）

# 4. 跑起来
npm run dev
```

### 需要自建的部分（不在本仓库）

| 组件 | 说明 |
|---|---|
| `n8n-radar/` | n8n + PostgreSQL 的 docker-compose 目录。**故意不入库**，因为里面有 `.env`（含 `N8N_ENCRYPTION_KEY`）与数据库密码 |
| `database.sqlite` | n8n 工作流存储，运行时生成 |
| `ops/paths.local.sh` | 本机私有路径配置（已 gitignore） |

---

## 五、常见坑

| 现象 | 原因 | 解法 |
|---|---|---|
| push 被拒 `Repository exceeds 100MB` | 历史里有超大 blob | 本次已剔除 `.next-stale`，当前最大文件远低于限制 |
| push 被拒 `Updates were rejected` | 远程已有提交 | `git push --force-with-lease`（首次推送不需要） |
| `npm ci` 报 EINTEGRITY | lockfile 与 registry 不匹配 | 本次已验证：换源后 integrity 0 变化，可放心用 |
| clone 后 launchd 服务不工作 | plist 是模板 | 必须用 `zsh ops/install-launchd.sh` 安装，不要手动 cp plist |
| launchd 下 zsh 报 `can't open input file` | macOS TCC 限制 | 见 `docs/launchd-外接卷访问诊断.md`，**不要改回 zsh** |
| `git bundle` 报 `cannot change to ...%20...` | URL 编码问题 | 用 `fileURLToPath`，已修 |

---

## 六、发布后自检清单

推送完成后，在 GitHub 网页上逐项确认：

- [ ] 仓库首页没有 `.next-stale` 目录
- [ ] 随便点开一个历史提交，作者显示 `AI Intel Dev`，**不是**个人邮箱
- [ ] 搜索框搜你脱敏掉的姓名 / 项目名 → 0 结果
- [ ] 搜索框搜用户主目录路径前缀 → 0 结果（占位符是 `<HOME_DIR>`）
- [ ] `docs/phase3-delivery-report.md` 里是 `<项目根>/自有项目/<项目A>` 这种占位符
- [ ] 仓库首页 README 正常渲染

### 命令行一键自检

把 `PATTERNS` 换成你实际要查的关键词（不要写进仓库）：

```bash
cd <BACKUP_DIR>/ai-intel-web-github.git

# 扫全历史所有 blob
git rev-list --objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(rest)' \
  | awk '$1=="blob"{print $2"\t"$3}' > /tmp/blobs.txt

PATTERNS=("姓名关键词" "你的邮箱" "$HOME" "/Volumes/你的卷名" "next-stale")
for pat in "${PATTERNS[@]}"; do
  n=$(while IFS=$'\t' read -r sha path; do
        git cat-file blob "$sha" 2>/dev/null | /usr/bin/grep -qF "$pat" && echo "$path"
      done < /tmp/blobs.txt | sort -u | wc -l | tr -d ' ')
  echo "$pat → $n"
done
rm -f /tmp/blobs.txt
```

全部为 0 即为安全。
