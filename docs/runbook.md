# 监控运维手册（runbook）

面向日常值班/运维：怎么读监控页、怎么手动触发检查、常见异常处置与故障排查。

> 红线：排查时**不改**数据库表结构/权限/密码、不删业务数据；只读排查 + 监控表的增删（仅 `monitor_*`）。凭据不进日志/截图。

---

## 1. 日常运维

### 读监控页
- 进入 Web 平台的「监控」页（或相关状态入口）。关注四类信息：
  1. **最近一次检查**（`lastCheckAt` / `lastCheckStatus`）：状态 `ok`/`warn`/`error`。
  2. **最新报告日期**（`latestReportDate`）：是否为今天/昨天。
  3. **近 24h 异常数**（`issueCount24h`）与 **近 7 天检查数/错误数**（`checks7d` / `errors7d`）。
  4. **检查明细**（`monitor_runs` 逐条）：点开看 `issues` 里的 `code`/`message`，定位是哪类问题。
- 判读口径：
  - `ok`：无需动作。
  - `warn`：多为内容偏短/缺章节/解析问题，影响展示质量，建议当天内核对日报。
  - `error`：多为缺失报告/正文为空/断更，需立即按「常见异常处置」处理。

### 手动触发检查
```bash
# 检查指定日期、不打扰（不发通知）
npm run monitor:check -- --date=2026-11-05 --skip-notify

# 检查今天并发通知（真实告警）
npm run monitor:check
```
- 试跑/复现问题时**务必带 `--skip-notify`**，避免重复告警骚扰群。
- 需要更细粒度时，可在代码里调 `runChecks({ targetDate, skipNotify: true })`（`lib/monitor/runner.ts`）。

---

## 2. 常见异常处置

### MISSING_REPORT（预期日期无日报）
1. 先确认目标日期是否应有日报（节假日/停更需人工确认）。
2. 检查 n8n 采集工作流是否**激活**且**当日已执行**：看 n8n 执行日志有无该日期的成功 run。
3. 若 n8n 报错：按 n8n 侧错误修复后**手动重跑**该工作流，再 `npm run monitor:check -- --date=<日期> --skip-notify` 复验。
4. 若 n8n 正常但未 UPSERT：查 `daily_reports` 该日期是否真的缺行（`SELECT * FROM daily_reports WHERE report_date = '<日期>'`）。

### PARSE_FAILED（Markdown 解析失败/无法切分章节）
1. 打开该日期日报原文（`daily_reports.report_markdown`），肉眼核对结构。
2. 六章节切分依赖 `- **字段名**：值` 格式（冒号在加粗外），若 n8n 模板改了格式会导致解析失败。
3. 修正 n8n 生成模板或补全章节标题后重新采集/复验。

### EMPTY_CONTENT / SHORT_CONTENT（正文为空/异常短）
1. 查 `report_markdown` 是否真为空或过短。
2. 多为上游采集内容不足或截断：查 n8n 数据源与拼装步骤。

### MISSING_SECTION（缺核心判断/头条/趋势/商业机会）
1. 对照日报模板，确认缺的是哪个章节。
2. 补齐模板或采集字段后复验。

### NOTIFY_FAILED（通知发送失败）
1. 核对 `MONITOR_WEBHOOK_URL` 是否正确、是否过期/被撤销。
2. 用 `curl` 手动 POST 一个测试 JSON 到该 URL，确认网络可达、返回 2xx。
3. 查 `monitor_notifications` 该 `dedup_key` 的 `error` 字段（脱敏摘要）定位原因（超时/HTTP 状态）。
4. 通知失败不影响主检查结论；修好 Webhook 后，下一次异常会重新尝试（同结论已 `sent` 则去重跳过）。

### VALIDATION_FLAG（n8n validation 标志异常）
1. 查 `daily_reports.validation` JSONB（如 `has_content=false`）。
2. 回溯 n8n 校验步骤为何打上该标志。

### STALE_DATA（最近 N 天整体断更）
1. 说明连续多天无新报告：大概率 n8n 采集链路整体停摆或数据源失效。
2. 检查 n8n 工作流激活状态、调度、凭据是否过期。

---

## 3. 故障排查

### 数据库连不上（`DB_PASSWORD is not set` / `connect ECONNREFUSED` / 超时）
1. 确认 `.env.local` 存在且含 `DB_HOST/DB_PORT/DB_NAME/DB_PASSWORD` 及 `DB_MONITOR_USER/DB_MONITOR_PASSWORD`。
2. 确认 Postgres 容器在跑、端口映射正确：`docker ps | grep postgres`（宿主端口见 `DB_PORT`）。
3. 确认账号/密码正确、账号未被禁用；监控账号密码缺失会直接抛 `DB_MONITOR_PASSWORD is not set`。
4. 网络/防火墙：本机直连 `127.0.0.1:<DB_PORT>` 是否通。
5. 排查用只读语句（`SELECT 1`），不要在排查中写业务表。

### 端口占用（Web 启动报 `EADDRINUSE`）
1. `next dev`/`next start` 绑定 `127.0.0.1`，端口默认 3000。
2. 查占用：`lsof -i :3000`（或目标端口），结束旧进程或换端口（`PORT=xxxx npm run start`）。
3. 多 worktree 并行时端口互不相同，别抢 3000。

### tsx / node 运行问题（`--import tsx` 报错、找不到模块）
1. 确认在项目根运行（`node_modules` 就绪），必要时 `npm install`。
2. 用与文档一致的调用：`node --env-file=.env.local --import tsx <entry>`。
3. `@/` 路径别名依赖 `tsconfig.json` 的 `paths`；用 tsx 运行时自动解析，不要改成相对路径乱猜。
4. Node 版本需支持 `--env-file`（Node ≥ 20）。

### 检查结果异常但日报看起来正常
1. 多为规则误报或解析边界：看 `issues` 的 `code` 与 `meta`（长度/缺章节）。
2. 阈值（如最短正文字数）可在 `lib/monitor/runner.ts` 的 `DEFAULT_MIN_CONTENT` 调整（属 Agent A/B 范围，改动走对应分支）。

---

## 4. 升级/变更注意
- 改规则（`lib/monitor/rules.ts`）只追加 Code、不改已有 Code 含义；改完跑集成测试 `tests/integration/monitor.test.ts`。
- 改表结构走新迁移，不手改线上表；回滚见 `docs/rollback.md`。
- 任何涉及凭据的改动只动 `.env.local`，不进 git。
