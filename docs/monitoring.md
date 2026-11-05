# 监控系统说明（monitoring）

「每日 AI 情报内参」的数据质量自动化监控：定时检查每日日报是否缺失/重复/为空/结构异常，把每次检查结论写入 `monitor_runs`，并通过 Webhook 推送告警（`monitor_notifications` 去重）。本文档覆盖架构、检查规则、环境变量、Webhook 配置、CLI 用法与 cron 接入。

> 约定：本文档只写**变量名与用途**，绝不写任何真实凭据/密钥/连接串。示例中的值均为占位符。

---

## 1. 架构与数据流（文字版）

```
[n8n 采集] 08:30  →  UPSERT daily_reports（业务表，只读给 Web）
                          │
                          ▼
[监控检查] npm run monitor:check（或 cron/launchd 触发）
   1. runner.runChecks({ targetDate, skipNotify })
        ├─ 读 daily_reports（getReadPool / ai_intel_reader，只读）
        ├─ rules.runQualityChecks(...)  → QualityIssue[]（纯函数，不碰库/不发通知）
        ├─ 覆盖性检查：最近 3 天是否整体断更 → STALE_DATA
        └─ 汇总 status = ok / warn / error
   2. store.saveCheckRun(run)            → INSERT monitor_runs（ai_intel_monitor）
   3. 若 status≠ok 且未 skipNotify：
        ├─ notify.makeDedupKey(run)      → 稳定去重键
        ├─ store.isNotified(dedupKey)    → 已通知则 skip
        ├─ notify.notifyWebhook(run)     → POST Webhook（失败不影响主流程）
        └─ store.saveNotificationLog(...) → INSERT monitor_notifications
                          │
                          ▼
[Web 展示] 监控页读取 monitor_runs / monitor_notifications + daily_reports 状态
```

关键设计：
- **检查与通知解耦**：通知失败不改变主检查结论，也不抛出中断。
- **幂等去重**：`monitor_notifications.dedup_key` 唯一，同一异常结论不重复通知。
- **不存正文**：`monitor_runs.issues` 只存结构化 `QualityIssue`（code/severity/message/meta），禁止塞整篇日报正文或密钥。
- **权限分层**：监控写入走独立账号 `ai_intel_monitor`（业务表只读 + `monitor_*` 两表 CRUD）。

### 数据表
| 表 | 用途 | 写账号 |
|---|---|---|
| `monitor_runs` | 每次检查结论（check_type/target_date/status/summary/issues） | ai_intel_monitor |
| `monitor_notifications` | 通知发送日志（run_id/dedup_key/status/error），去重 | ai_intel_monitor |

迁移文件：`migrations/003_monitoring.sql`（建表+授权）、`migrations/003_monitoring_down.sql`（回滚）。

---

## 2. 质量检查规则清单（12 个 IssueCode）

| Code | 含义 | 默认严重级 |
|---|---|---|
| `MISSING_REPORT` | 预期日期无报告 | error |
| `DUPLICATE_REPORT` | 同一 `report_date` 出现多条记录（UNIQUE 约束下防御性，应恒为空） | error |
| `DUPLICATE_TITLE` | 不同日期标题+正文高度雷同（疑似重复内容） | warn |
| `EMPTY_CONTENT` | 正文为空/纯空白 | error |
| `SHORT_CONTENT` | 正文异常短（低于阈值，默认 1000 字符） | warn |
| `PARSE_FAILED` | Markdown 解析失败/无法切分章节 | warn |
| `MISSING_SECTION` | 缺少必需章节（核心判断/今日 AI 头条/今日趋势/商业机会） | warn |
| `INVALID_FIELDS` | 必需字段缺失或非法（标题空、日期非法、计数为负等） | error |
| `VALIDATION_FLAG` | n8n `validation` JSONB 标志异常（如 `has_content=false`） | warn |
| `FUTURE_DATE` | `report_date` 在未来 | error |
| `STALE_DATA` | 最近 N 天无任何新报告（覆盖性缺失） | error |
| `NOTIFY_FAILED` | 通知发送失败（不影响主检查） | warn |

结论 `status`：
- `ok`：无任何 issue。
- `warn`：有警告但无 error 级 issue。
- `error`：存在至少一个 error 级 issue。

> 并行约定：Agent A 可**追加**新 Code，但不改已有 Code 含义。新增 Code 需同步补到本表。

---

## 3. 环境变量（只列名与用途，不写值）

| 变量名 | 用途 |
|---|---|
| `DB_HOST` | PostgreSQL 主机（业务与监控共用） |
| `DB_PORT` | PostgreSQL 端口（本机 Docker 映射端口） |
| `DB_NAME` | 数据库名（ai_intelligence） |
| `DB_USER` / `DB_PASSWORD` | 只读账号（`ai_intel_reader`）：Web/监控读业务表 |
| `DB_WRITE_USER` / `DB_WRITE_PASSWORD` | 业务写账号（`ai_intel_writer`）：非监控链路使用 |
| `DB_MONITOR_USER` | 监控账号用户名（默认 `ai_intel_monitor`） |
| `DB_MONITOR_PASSWORD` | 监控账号密码（写 `monitor_*` 必需，缺失则监控池直接抛错） |
| `MONITOR_WEBHOOK_URL` | 告警 Webhook 地址；**留空则通知自动 skipped**（不发送） |
| `MONITOR_CHECK_TIMEOUT_MS` | 单次检查/通知的超时毫秒数（防御性上限） |

> 安全红线：以上任何值**不得**写进前端代码、文档、日志或提交进 git。`.env.local` 已被 gitignore。

---

## 4. Webhook 配置示例

监控通过 `POST`（`Content-Type: application/json`）向 `MONITOR_WEBHOOK_URL` 发送通用 JSON：

```json
{
  "text": "[AI情报监控] ERROR 2026-11-05\n2026-11-05 日报检查发现 1 项异常、0 项警告",
  "status": "error",
  "targetDate": "2026-11-05",
  "issues": [
    { "code": "MISSING_REPORT", "severity": "error", "message": "预期日期 2026-11-05 缺少日报" }
  ]
}
```

各平台 incoming webhook 适配（把 `MONITOR_WEBHOOK_URL` 设为对应地址即可；如平台字段不兼容，可在 `lib/monitor/notify.ts` 扩展 payload）：

- **企业微信群机器人**：URL 形如 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<KEY>`。机器人接收 `{"text": {"content": "..."}}`；可将 `text` 字段包装为 `{"content": <text>}`。`msgtype: "text"`。
- **飞书自定义机器人**：URL 形如 `https://open.feishu.cn/open-apis/bot/v2/hook/<TOKEN>`。可发送 `{"msg_type": "text", "content": {"text": <text>}}`。
- **Slack Incoming Webhook**：URL 形如 `https://hooks.slack.com/services/<T/B/XXXX>`。可发送 `{"text": <text>}`，Slack 原生识别 `text` 字段。

> 说明：当前默认 payload 用通用 `text` 字段，Slack 可直用；企业微信/飞书通常需把 `text` 包一层（见上）。若要开箱即用，可在 notify 层按 `MONITOR_WEBHOOK_URL` 域名分支格式化。

---

## 5. CLI 用法

```bash
# 检查「今天」（Asia/Shanghai），有异常则发通知
npm run monitor:check

# 检查指定日期
npm run monitor:check -- --date=2026-11-05

# 只检查、不发通知（排查/试跑）
npm run monitor:check -- --skip-notify

# 干跑：只打印将要检查的内容，不落库、不通知
npm run monitor:check -- --dry-run
```

参数：
- `--date=YYYY-MM-DD`：目标报告日期；缺省为 Asia/Shanghai 的今天。
- `--skip-notify`：跳过 Webhook 通知（`runChecks({ skipNotify: true })`）。
- `--dry-run`：不写 `monitor_runs`、不发通知，仅输出预演结果。

> 注：CLI 脚本由 Agent D 提供（`package.json` 的 `monitor:check` 脚本）。若脚本尚未就绪，可直接在代码中调用 `runChecks({ targetDate, skipNotify })`（见 `lib/monitor/runner.ts`）。集成测试即按该契约编写，不依赖 CLI。

---

## 6. 接入 cron（定时调度）

用 cron 每天 09:30 跑一次检查（在 08:30 n8n 采集、UPSERT 之后，留出缓冲）：

```cron
# 每天 09:30（本机时区）执行日报质量检查；日志追加到 monitor-check.log
30 9 * * * cd /path/to/ai-intel-web && /usr/bin/env node --env-file=.env.local node_modules/.bin/tsx scripts/monitor-check.ts >> /var/log/monitor-check.log 2>&1
```

要点：
- `cd` 到项目根，确保 `--env-file=.env.local` 能加载环境变量。
- 用绝对路径调用 `node`/`tsx`，避免 cron 环境 PATH 不全。
- 输出重定向到日志文件，便于 runbook 排查。
- 停止调度（如需回滚/维护）：`crontab -e` 注释/删除该行，或 `launchd` 卸载对应 plist。
- macOS 亦可用 `launchd`（`StartCalendarInterval`）替代 cron，注意 Docker/Postgres 未就绪时的重试。

> 时间选择建议：n8n 08:30 采集 → 09:30 检查，间隔 1 小时足以让 UPSERT 完成；若采集延迟，可把检查时间后移或在检查前加「等待/重试」。
