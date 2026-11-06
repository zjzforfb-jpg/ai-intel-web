# AI 情报平台可靠性与自动化监控 — 交付报告

> 交付日期：2026-11-07 ｜ 主 Agent 统一集成 ｜ 仓库：ai-intel-web（main）
> 最终验证：45/45 测试通过（串行）、build 17 路由成功、Playwright 4/4 无溢出、权限矩阵 17/17 PASS

---

## 1. 实际完成功能

| 目标 | 实现 | 入口 |
|---|---|---|
| ① 每日报告自动检查 | `runChecks()` 全量质量检查，CLI `npm run monitor:check` 可挂 cron / n8n Schedule | `lib/monitor/runner.ts`、`scripts/monitor-check.ts` |
| ② 缺失/重复/空内容/结构异常检测 | 12 个 IssueCode 规则集：MISSING_REPORT、DUPLICATE_REPORT、DUPLICATE_TITLE、EMPTY_CONTENT、SHORT_CONTENT、PARSE_FAILED、MISSING_SECTION、INVALID_FIELDS、VALIDATION_FLAG、FUTURE_DATE、STALE_DATA、NOTIFY_FAILED | `lib/monitor/rules.ts` |
| ③ 可查看的运行状态与检查结果 | /monitor 页面（总览卡片、状态筛选、记录卡片、异常明细折叠、分页、空态）+ REST API（/api/monitor/overview、/api/monitor/runs） | `app/monitor/`、`app/api/monitor/` |
| ④ 失败重试与安全恢复 | 通知 withRetry（2 次退避 1s/2s）、检查超时保护（MONITOR_CHECK_TIMEOUT_MS 超时转 error 不抛出）、runner 错误兜底为 error 级记录、CLI 退出码分级、`markRunNotified` 人工补记恢复 | `lib/monitor/notify.ts`、`runner.ts`、`store.ts` |
| ⑤ 异常通知（复用现有渠道） | 通用 Webhook（text 字段优先，兼容企微/飞书/Slack），dedup_key UNIQUE + upsert 三层幂等去重。说明：审查 n8n SQLite 确认工作流无任何通知节点、无现成渠道可复用，故提供通用 Webhook | `lib/monitor/notify.ts` |

配套：47 项测试（45 生效）、4 份文档（monitoring/runbook/rollback/security-review）、migration 双向脚本、独立 DB 账号。

## 2. 架构与数据流变化

```
n8n CR-01(08:30) ──UPSERT──▶ daily_reports ──┐
                                             ▼
npm run monitor:check / API ──▶ rules.ts（纯函数质量规则）
                                             ▼
                        runner.ts（超时/幂等/兜底）──▶ monitor_runs（记录+issues JSONB）
                                             ▼
                        notify.ts（Webhook+重试+去重）──▶ monitor_notifications（幂等日志）
                                             ▼
                        /monitor UI ◀── /api/monitor/* ◀── store.ts（ai_intel_monitor 账号）
```

- 数据流只读业务表，写入仅限 monitor_* 两表，与 n8n 写入链路完全隔离。
- 通知幂等三层：isNotified（只认 sent）→ dedup_key UNIQUE → upsert（failed 可升格 sent，sent 终态不降级）。

## 3. 新增/修改文件

**新增**：`migrations/003_monitoring.sql`、`migrations/003_monitoring_down.sql`、`lib/monitor/{types,db,rules,store,runner,notify}.ts`、`scripts/monitor-check.ts`、`app/monitor/page.tsx`、`components/monitor/**`、`app/api/monitor/{overview,runs}/route.ts`、`tests/{rules,store,notify}.test.ts`、`tests/integration/monitor.test.ts`、`docs/{monitoring,runbook,rollback,security-review}.md`

**修改**：`components/{Sidebar,MobileNav}.tsx`（+系统监控入口）、`package.json`（scripts: monitor:check / test；devDeps: tsx）、`app/api/opportunities/route.ts` 与 `[id]/route.ts`（500 响应删除 error.message 回传，仅服务端日志）、`n8n-radar/.env`（+WEB_MONITOR_USER/PASSWORD）

**未动**：n8n/PG Docker 主配置、业务表、现有 DB 账号权限、既有页面。

## 4. Migration 与权限变更

- `003_monitoring.sql`：monitor_runs（8 列）+ monitor_notifications（dedup_key UNIQUE）+ 4 索引 + GRANT；幂等（IF NOT EXISTS），已执行。
- `003_monitoring_down.sql`：先删 notifications 再删 runs，不动业务数据。**正向→回滚→重建→回灌已实测**：业务表 checksum 全程不变。
- 权限矩阵实测 17/17 PASS（零副作用测法）：
  - reader：业务表 SELECT ✓，写/碰监控表 ✗
  - writer：topics/opportunities CRUD ✓，daily_reports 仅 SELECT ✓，碰监控表 ✗
  - monitor（新增）：业务表只读 ✓，业务表写 ✗，monitor_* CRUD ✓
  - 凭据仅存 n8n-radar/.env（600），本报告不含任何密钥值。

## 5. 各 Agent 分支 commit 与测试

| 线 | 分支 | commit | 测试 |
|---|---|---|---|
| 基线 | main | fefe874 | 契约+v0 编译通过 |
| A 规则 | feat/monitor-rules | 159cd94 → 1e484f1 → 39104b3 | rules 22 例 |
| B 状态 | feat/monitor-store | 6bb4afb → 0a73037 → 2049c2b | store 6 例 |
| C 界面 | feat/monitor-ui | 7f094ea | tsc/build + Playwright |
| D 通知 | feat/monitor-notify | 6317c31 | notify 10 例 |
| E 测试文档 | feat/monitor-tests | 222670f | integration 9 例 |
| 主 Agent | main | c10246d（安全修复）、05d46df（测试串行化） | 合并后 45/45 |

合并零冲突（契约先行 + 文件边界互斥）。E 审出 3 项安全发现全部闭环：#1 Date 归一化（A 修）、#2 通知 upsert 幂等（B 修）、#3 API 泄露 error.message（主 Agent 修）。

## 6. 完整验证结果

| 项 | 结果 |
|---|---|
| tsc / next build | ✅ 17 路由（含 /monitor、/api/monitor/*） |
| 测试（--test-concurrency=1 串行） | ✅ 45 pass / 0 fail（最终复跑确认） |
| migration 正向+回滚+重建+回灌 | ✅ 业务表 checksum 不变，结构/索引/GRANT 恢复 |
| 权限矩阵 | ✅ 17/17 PASS |
| 无数据态 | ✅ API 返回 null/0；页面空态文案正确 |
| 异常数据态 | ✅ MISSING_REPORT 记录正常展示、异常明细可展开 |
| DB 不可用 | ✅ API 500 通用文案不泄内部错误；页面「连接异常」+明确提示"不代表当天没有日报"+排查指引；恢复后自愈 |
| Playwright 1440/390 + 筛选/空态 | ✅ 4/4 无横向溢出，截图存 docs/verification/ |
| CLI 退出码 | ✅ error→2、非法参数→3（ok/warn→0） |
| lint | 项目无 lint 配置，豁免（以 tsc 代） |

## 7. 通知与监控配置

- 在 `ai-intel-web/.env.local` 配 `MONITOR_WEBHOOK_URL=<企微/飞书/Slack webhook>`；不配则通知自动 skipped（不报错）。
- 可选：`MONITOR_CHECK_TIMEOUT_MS`（检查超时，默认见 runbook）、`MONITOR_MIN_CONTENT_LENGTH`。
- 定时执行：crontab 示例 `30 8 * * * cd /path/ai-intel-web && npm run monitor:check >> /tmp/monitor-check.log 2>&1`；或在 n8n 加 Schedule→Execute Command 节点。

## 8. 启动与使用

```bash
cd ai-intel-web
npm test                 # 全部测试（串行）
npm run monitor:check    # 立即执行一次质量检查（--skip-notify/--dry-run/--date=YYYY-MM-DD 可选）
npm run build && npm run start   # 生产启动 → http://localhost:3000/monitor
```

侧边栏/移动导航点「系统监控」进入；状态 pill 可筛选并同步 URL。

## 9. 回滚方法

- **代码**：`git revert <merge-commit>` 或直接回退到 fefe874 之前的 main。
- **数据库**：`psql -f migrations/003_monitoring_down.sql`（已实测：仅删监控两表，业务数据零影响）。回滚后需停用 monitor:check 的 cron。
- **通知**：删除 MONITOR_WEBHOOK_URL 即静默。

## 10. 尚存风险与下一阶段建议

1. **n8n 工作流 CR-01 仍 active=0（未激活）**——日报不会自动产生，检查将每天报 MISSING_REPORT。属用户决定项：在 n8n 后台激活即可。
2. MONITOR_WEBHOOK_URL 未配置真实值——当前通知链路只验证到 skipped/failed 分支，接入真实 webhook 后建议补一次端到端。
3. monitor:check 的 cron 尚未挂载——建议按第 7 节配置，或下一阶段做 n8n 内集成。
4. 建议下一阶段：检查结果周报聚合、异常趋势图、报告生成延迟 SLA 告警（当前 STALE_DATA 仅按窗口判定）。
