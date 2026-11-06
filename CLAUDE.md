# 项目约定（所有 Claude Code 会话必读）

## 项目是什么
「每日 AI 情报内参」Web 平台（DAILY AI INTELLIGENCE）：只读展示 n8n 生成的 AI 情报日报。
- 技术栈：Next.js 16（App Router、Turbopack）+ React 19 + Tailwind CSS v4 + TypeScript + pg（node-postgres）+ react-markdown/remark-gfm/rehype-sanitize + lucide-react
- 数据库：PostgreSQL 16（Docker 容器 `n8n-radar-postgres`，宿主端口 127.0.0.1:5433），库 `ai_intelligence`，主表 `daily_reports`
- Web 用**只读账号** `ai_intel_reader`（仅 SELECT），连接配置在 `.env.local`（DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME）

## 绝对红线
1. **不修改 n8n / PostgreSQL 的 Docker 主配置**（`~/n8n-radar/docker-compose.yml`、`~/n8n-radar/.env`）；不执行 `docker compose down -v`
2. **数据库只读**：不 INSERT/UPDATE/DELETE、不改表结构/权限/密码；SQL 一律**参数化**，禁止拼接用户输入
3. **不虚构数据**：页面数据必须来自真实数据库；无数据显示空状态，查询失败显示 `DbErrorState` 错误态
4. **凭据不进前端**：数据库密码只在服务端环境变量；`.env.local` 已被 gitignore，绝不提交
5. dev/start 必须绑定本机：`next dev -H 127.0.0.1`（package.json 已配置）

## 技术坑（踩过，别再踩）
- **Tailwind v4**：`next.config.ts` 必须保留 `turbopack.rules["*.css"].loaders = ["@tailwindcss/turbopack"]`，否则工具类不生成页面变裸 HTML
- **不要用 `@theme`**（Turbopack 报 `Unknown at rule` 且变量不生效），自定义变量写标准 `:root { --color-*: ... }`（见 `app/globals.css`）
- Next 16：`searchParams`/`params` 是 **Promise**，页面组件要 `await`
- Next 16 同一目录只允许一个 dev 实例；并行验证用 `next start` + 不同 PORT
- 日报原文里有超长 URL：正文字容器必须保留 `overflow-wrap: anywhere`（`.prose-report` 已有），否则小屏横向溢出
- 打印样式：`[data-print-hide]` 隐藏交互元素，`body, body * { color:#111 }` 保证打印稿可读

## 结构速览
- `app/`：`/` 今日情报（核心判断横幅 + 头条/趋势/机会三板块）、`/report/[date]` 完整日报（目录锚点/复制/打印/进度条）、`/history` 历史档案馆（搜索/筛选/分页）、`/trends`、`/about`
- `components/`：UI 组件；`components/history/` 搜索控件/分页/高亮摘要
- `lib/db.ts`：pg Pool 与全部查询（`getLatestReport`/`getReportByDate`/`getAdjacentReports`/`searchArchive`/`getArchiveFacets`/`getStats`）
- `lib/markdown-parser.ts`：六章节切分（正则字段格式 `- **字段名**：值`，冒号在加粗外）、`buildToc`/`slugify`
- `lib/search.ts`：关键词解析、匹配摘要切片；`lib/format.ts`：时区展示（DISPLAY_TZ=Asia/Shanghai）

## 搜索方案（已定，勿改）
PG 原生 FTS 对中文无效（整串中文成单个词元，实测 `@@ plainto_tsquery('simple','情报')`=false），已采用 **ILIKE 多关键词 AND**（关键词经 `unnest($1::text[])` 绑定，ILIKE 通配符在 SQL 内转义）。相关度 = 标题命中×10 + 正文命中×3。

## 完成前必须验证
```bash
npx tsc --noEmit        # 类型检查
npm run build           # 生产构建（6 路由）
```
改动页面后用 Playwright 或 curl 实测（桌面 1440 / 手机 390 无横向溢出、功能不回退）。

## 并行开发约定（多 worktree 时）
- 一个 worktree 只做一个任务、只用一个分支；**不要 commit/push 到 main**，完成后报告改动文件清单，由主线统一合并
- 各 worktree 的 dev 端口互不相同（见 TASK-PROMPT.md），不要占用 3000
- 只在自己的任务范围内改文件；`lib/db.ts`、`package.json` 是共享热点文件，只追加不重构
