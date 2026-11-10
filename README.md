<div align="center">

# AI 情报平台

**每天早上 8:30，自动把散落的 AI 资讯变成可直接用的选题、商机和实体追踪**

`n8n` 采集抓取 → `PostgreSQL` 落库 → `Next.js` 呈现

[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-087ea4)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169e1)](https://www.postgresql.org)
[![License](https://img.shields.io/badge/license-personal-8a8a8a)]()

</div>

---

## 这是什么

一个**跑在你自己电脑上的** AI 情报流水线。

每天早上 8:30，一个 38 节点的 n8n 工作流自动抓取 AI 领域资讯，产出一份情报日报，
并从中抽取三类结构化数据：

| 产物 | 是什么 | 页面 |
|---|---|---|
| **日报** | 当天资讯汇总，六章节 Markdown | `/` `/report/[date]` |
| **选题** | 可做成短视频的候选话题，按价值分排序 | `/ideas` |
| **商机** | 可切入的产品/服务机会，含行动方案 | `/opportunities` |
| **实体** | 持续追踪的公司/产品/人物，记录提及轨迹 | `/entities` |

> **这不是 SaaS。** 只监听 `127.0.0.1`，没有登录、没有多租户、不上公网。
> 你的情报数据不会离开这台机器。

---

## 它长什么样

```
┌──────────────────────────────────────────────────────────┐
│  08:30  n8n 工作流（38 节点）                              │
│  ┌─────────┐   ┌────────────┐   ┌──────────────────┐     │
│  │ 采集抓取 │──►│ LLM 抽取   │──►│ 写入 PostgreSQL  │     │
│  └─────────┘   └────────────┘   └────────┬─────────┘     │
└───────────────────────────────────────────┼──────────────┘
                                            │
                    ┌───────────────────────┴──────────────┐
                    │  PostgreSQL 16 · 库 ai_intelligence │
                    │  daily_reports / topic_ideas /      │
                    │  opportunities / entities / …       │
                    └───────────────────────┬──────────────┘
                                            │ 三账号隔离读写
┌───────────────────────────────────────────┼──────────────┐
│  Next.js 16 (App Router)  17 页 · 13 个 API │              │
│  ┌─────────┬─────────┬─────────┬──────────┐ │              │
│  │  今日    │  选题    │  商机    │  实体追踪  │ │              │
│  └─────────┴─────────┴─────────┴──────────┘ │              │
└───────────────────────────────────────────┼──────────────┘
                                            │
        09:05 质量检查 ──► Bark 推送          │
        09:40 自动备份 ──► PG + SQLite + 代码  │
```

---

## 快速开始

```bash
git clone git@github.com:zjzforfb-jpg/ai-intel-web.git
cd ai-intel-web
npm ci
cp .env.example .env.local    # 填入数据库凭据
npm run dev
```

打开 http://localhost:3000

### 环境变量

`.env.example` 里**只有说明文字，没有任何真实密码**。从你的 n8n 栈 `.env` 同步：

```bash
DB_HOST=127.0.0.1
DB_PORT=5433
DB_NAME=ai_intelligence
DB_USER=...        # n8n-radar/.env 里的 WEB_DB_USER
DB_PASSWORD=...    # n8n-radar/.env 里的 WEB_DB_PASSWORD
```

数据库由 Docker 容器提供（PostgreSQL 16，映射到宿主 `127.0.0.1:5433`）。
建库后按序执行 `migrations/` 下编号的 SQL。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 16（App Router、Turbopack）· React 19 · Tailwind CSS v4 |
| 语言 | TypeScript 5 · `node:test` 原生测试运行器 |
| 数据 | PostgreSQL 16（`pg` 驱动）· 三账号隔离 |
| 自动化 | n8n 2.46（38 节点工作流）· launchd 定时 |
| 渲染 | `react-markdown` + `remark-gfm` + `rehype-sanitize` · `lucide-react` 图标 |
| 动效 | `motion` |

---

## 目录结构

```
ai-intel-web/
├── app/                 17 个页面路由 + 13 个 API 路由
├── components/          62 个 React 组件
├── lib/                 数据访问 / 词典 / 主题 / 抽取逻辑（36 个模块）
│   ├── lexicon/         词典唯一真源（8 张表）
│   ├── monitor/         质量检查规则
│   └── db.ts            只读查询层
├── migrations/          10 个数据库迁移（按序执行）
├── scripts/             n8n 补丁 / 校验 / 备份脚本
├── ops/                 launchd 配置与运维脚本
├── docs/                阶段交付报告、审计、诊断记录
└── tests/               12 个测试文件 · 198 个用例
```

---

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（绑 `127.0.0.1`） |
| `npm run build` | 生产构建 |
| `npm start` | 生产服务器（绑 `127.0.0.1`） |
| `npm test` | 198 个用例 |
| `npm run check` | **门禁**：类型检查 + 测试 + 构建，一次跑完 |
| `npm run monitor:check` | 日报质量检查，有 error 级发现时退出码 `2` |
| `npm run backup:run` | 手动备份（PG 全量 + n8n SQLite 快照 + 代码 bundle） |
| `npm run verify:lexicon --source=all` | 检测词典在 TS / n8n / 校验器三方是否漂移 |

---

## 运维：定时任务

macOS 上用 `launchd` 跑三个定时任务：

| 时间 | 任务 | 作用 |
|---|---|---|
| 08:30 | n8n 内部定时器 | 出日报 + 抽取选题/商机/实体 |
| 09:05 | `com.aiintel.monitor` | 质量检查 + Bark 推送 |
| 09:40 | `com.aiintel.backup` | PG / SQLite / 代码 三份备份 |

安装（**在你自己的 Terminal.app 里跑**——自动化会话内 `launchctl` 会被沙箱阻断）：

```bash
cd ai-intel-web
zsh ops/install-launchd.sh
```

卸载：

```bash
launchctl bootout gui/$(id -u)/com.aiintel.monitor
launchctl bootout gui/$(id -u)/com.aiintel.backup
```

### 路径可移植性

`ops/*.plist` 是**模板**，仓库里不含任何机器的个人目录名。安装脚本在部署时
用 Python `plistlib` 把占位符替换成本机真实路径：

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

配置优先级：**环境变量 > `ops/paths.local.sh` > `ops/paths.sh` 默认值**。

> **⚠️ 已知坑（macOS TCC）**
> launchd agent 上下文中，`/bin/zsh` 对**外接卷**的 `open()` 会被系统隐私保护拒绝
> （报 `can't open input file`），而 `node` 的 fs API 放行。
> 因此备份逻辑整体用 Node 实现（`scripts/backup-node.mts`）——**不要改回 zsh**。
> 完整诊断证据见 [`docs/launchd-外接卷访问诊断.md`](docs/launchd-外接卷访问诊断.md)。

---

## 安全边界

| 方面 | 做法 |
|---|---|
| **密钥不入库** | `.env*`、`.pg-credentials.txt`、`*.pem` 已在 `.gitignore`；n8n 栈的 `.env`（含 `N8N_ENCRYPTION_KEY`）在**仓库之外** |
| **数据库三账号隔离** | 只读 / 写入 / 监控各用各的账号，Web 层不持超级用户权限 |
| **SQL 全参数化** | 禁止拼接用户输入；ILIKE 通配符在 SQL 内转义 |
| **不虚构数据** | 页面数据必须来自真实数据库；无数据显示空态，查询失败显示错误态 |
| **不暴露公网** | `next dev` / `next start` 均绑 `127.0.0.1` |
| **提交身份脱敏** | 历史作者在推送前已被重写为 GitHub noreply 邮箱（`.mailmap` 本地生效，不入库） |
| **XSS 防护** | 日报 Markdown 经 `rehype-sanitize` 清洗后渲染 |

---

## 数据模型

```
daily_reports      日报（标题 + Markdown + HTML + 统计）
topic_ideas        选题（价值分 1-10，状态：待制作/已选用/已制作/已放弃）
opportunities      商机（分类 + 状态 + 行动方案）
entities           实体（类型 + 别名变体）
entity_mentions    实体提及记录（幂等键：entity_id + report_id）
topics             专题（手动维护，尚未启用）
content_projects   内容项目（阶段 3 骨架）
monitor_runs       质量检查运行记录
monitor_notifications  通知发送记录
report_failures    n8n 校验失败兜底落库
```

---

## 分支

| 分支 | 内容 |
|---|---|
| `main` | 主线 —— 阶段 1–3 完成，38 节点工作流稳定运行 |
| `ui/redesign` | 全站 17 页 UI 重构（双主题 dark / warm + 统一设计系统），**尚未合并** |

---

## 不在本仓库里

| 内容 | 原因 |
|---|---|
| `n8n-radar/`（docker-compose + `.env`） | 含 `N8N_ENCRYPTION_KEY` 与数据库密码 |
| n8n 工作流 SQLite | 运行时数据，且含加密凭据实体 |
| `.env.local` | 本机凭据，gitignore |
| `ops/paths.local.sh` | 本机路径，gitignore |

克隆后需要自建 n8n + PostgreSQL 那套 Docker 栈。

---

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/github-发布手册.md`](docs/github-发布手册.md) | 去敏全流程与 GitHub 推送步骤 |
| [`docs/launchd-外接卷访问诊断.md`](docs/launchd-外接卷访问诊断.md) | macOS TCC 外接卷访问的完整排查证据链 |
| [`docs/audit-2026-11-06.md`](docs/audit-2026-11-06.md) | 项目初始审计 |
| `docs/phase*-delivery-report.md` | 各阶段交付报告 |
| `CLAUDE.md` | 项目约定与技术坑清单 |

---

## License

仅供个人学习与内部使用。
