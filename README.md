# AI 情报平台（ai-intel-web）

> 一个跑在本机的 **AI 情报 → 选题 → 商机 → 实体追踪** 流水线。
> n8n 每天 08:30 自动出报并抽取结构化数据，Next.js 负责把结果呈现成可用的工作台。

这是一个**个人本地工具**，不是 SaaS：只监听 `127.0.0.1`，不做认证与多租户，不上公网。

---

## 架构一览

```
┌──────────────┐  08:30 定时   ┌─────────────────┐
│  n8n 工作流   │ ───────────► │  PostgreSQL 16  │
│ (38 个节点)   │               │  库 ai_intelligence │
└──────┬───────┘               └────────┬────────┘
       │                                │
       │ 日报 / 选题 / 商机 / 实体        │ 只读 + 分账号写入
       ▼                                ▼
┌──────────────────────────────────────────────────┐
│        Next.js 16 (App Router, TypeScript)        │
│   /  /ideas  /opportunities  /topics  /entities    │
│   /report/[date]  /trends  /monitor  /about        │
└──────────────────────────────────────────────────┘
       │
       │ 09:05 monitor:check  →  Bark 推送
       ▼
   质量监控（失败/缺报/内容异常）
```

| 组件 | 位置 | 说明 |
|---|---|---|
| Web 前端 | `app/` `components/` `lib/` | Next.js 16 App Router，17 个页面，双主题（dark / warm） |
| 数据层 | `lib/db.ts` `lib/db-write.ts` | PostgreSQL，三账号隔离（reader / writer / monitor） |
| 迁移 | `migrations/` | 编号 SQL，`001` 起顺序执行 |
| 工作流补丁 | `scripts/n8n-*.mts` | 直接改 n8n SQLite（需停容器） |
| 词典真源 | `lib/lexicon/tables.ts` | 8 张表 + 类型映射，**唯一可编辑源** |
| 运维 | `ops/` | launchd 服务、备份、诊断脚本 |
| 备份 | `scripts/backup-node.mts` | PG 全量 + n8n SQLite 一致快照 + git bundle |

---

## 快速开始

### 1. 依赖

```bash
npm install
```

> 本仓库的 `package-lock.json` 指向 **npm 官方源**，任何网络环境都能 `npm ci` 成功。

### 2. 环境变量

```bash
cp .env.example .env.local
```

`.env.example` 里**不含任何真实密码**（只有说明文字）。真实值来自你的 n8n 栈的 `.env`：

```bash
# n8n-radar/.env 里的 WEB_DB_USER / WEB_DB_PASSWORD 等
DB_USER=...
DB_PASSWORD=...
```

数据库连接默认走 `127.0.0.1:5433`（宿主机映射的容器端口）。

### 3. 数据库

需要先备好 `ai_intelligence` 库并按序执行 `migrations/` 下的 SQL。
容器侧的 `n8n-radar/docker-compose.yml` 不在本仓库内（它含本机凭据）。

### 4. 运行

```bash
npm run dev      # 开发
npm run build && npm start   # 生产
```

打开 http://localhost:3000

---

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm test` | 全量测试 |
| `npm run typecheck` | TypeScript 检查 |
| `npm run backup:run` | 手动跑一次备份（PG + SQLite + git bundle） |
| `npm run monitor:check` | 日报质量检查，失败时退出码 2 |
| `npm run verify:lexicon --source=all` | 检测词典在 TS / n8n / 校验器三方是否漂移 |

---

## 运维：launchd 定时任务

macOS 上用 `launchd` 跑三个定时任务：

| 时间 | 任务 | 作用 |
|---|---|---|
| 08:30 | n8n 内部定时器 | 出日报 + 抽取选题/商机/实体 |
| 09:05 | `com.aiintel.monitor` | 质量检查 + Bark 推送 |
| 09:40 | `com.aiintel.backup` | PG / SQLite / 代码 三份备份 |

安装（在**你自己的 Terminal.app** 里跑，AI 会话内 `launchctl` 会被沙箱阻断）：

```bash
cd <仓库目录>
zsh ops/install-launchd.sh
```

### 路径可移植性

`ops/*.plist` 是**模板**，入库时不含任何个人目录名。安装脚本会在部署时把占位符
替换成本机真实路径：

| 占位符 | 含义 |
|---|---|
| `__REPO_PLACEHOLDER__` | 仓库根目录 |
| `__BACKUP_DIR_PLACEHOLDER__` | 备份输出目录 |
| `__NODE_BIN__` | Node 可执行文件绝对路径 |

本机私有配置写在 `ops/paths.local.sh`（**已 gitignore**）：

```bash
AIINTEL_BACKUP_DIR="/Volumes/<你的卷>/<备份目录>"
AIINTEL_VOLUME_ROOT="/Volumes/<你的卷>"
```

配置优先级：环境变量 > `ops/paths.local.sh` > `ops/paths.sh` 默认值。

> **已知坑（TCC）**：macOS 的 launchd agent 上下文中，`/bin/zsh` 对**外接卷**的
> `open()` 会被 TCC 拒绝（报 `can't open input file`），而 `node` 的 fs API 放行。
> 因此备份逻辑整体用 Node 实现（`scripts/backup-node.mts`），不要改回 zsh。
> 完整诊断见 `docs/launchd-外接卷访问诊断.md`。

---

## 安全边界

- **密钥一律不入库**：`.env*`、`.pg-credentials.txt`、`*.pem` 已在 `.gitignore`；
  `n8n-radar/.env`（含 `N8N_ENCRYPTION_KEY`）属于**另一个目录**，不在本仓库。
- **数据库三账号隔离**：只读 / 写入 / 监控各用各的账号，Web 层不持超级用户权限。
- **本地服务**：`next start` 只绑 `127.0.0.1`，不对外暴露。
- **提交身份**：`.mailmap` 把历史作者映射为 GitHub noreply 邮箱，
  避免真实邮箱随 commit 公开。

---

## 分支

| 分支 | 内容 |
|---|---|
| `main` | 主线（阶段 1–3 完成，38 节点工作流稳定运行） |
| `ui/redesign` | 全站 17 页 UI 重构（双主题 + 统一设计系统），尚未合并 |

---

## 目录速查

```
ai-intel-web/
├── app/              Next.js 路由与 API
├── components/       23 个子组件
├── lib/              数据访问 / 词典真源 / 主题 / 配置
├── migrations/       数据库迁移（顺序执行）
├── scripts/          n8n 补丁、验证、备份脚本
├── ops/              launchd 配置与运维脚本
├── docs/             阶段交付报告、审计、诊断记录
└── tests/            测试用例
```

---

## License

仅供个人学习与内部使用。
