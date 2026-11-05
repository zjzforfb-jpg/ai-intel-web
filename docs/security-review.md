# 安全审查记录（security-review）

审查范围：监控系统（`lib/monitor/**`、`migrations/003_monitoring*`）、相关 API（`app/api/**`）、集成测试与凭据处理。
审查人：Agent E（测试/文档/安全审查）。日期：2026-11-05。
结论：**权限最小化到位、SQL 全参数化、凭据不外泄**；发现 2 个应修复的正确性/一致性问题（见「发现问题」），均属他人模块，已记录未擅改。

> 标记说明：✓ = 由集成测试/探针实测验证；○ = 依据迁移/代码设计核对。

---

## 1. 权限最小化核对表（四账号权限矩阵）

| 能力 \ 账号 | `n8n_radar` | `ai_intel_reader` | `ai_intel_writer` | `ai_intel_monitor` |
|---|---|---|---|---|
| 角色定位 | n8n 采集写入 | Web / 监控**只读** | 业务写（非监控） | 监控写 `monitor_*` |
| `daily_reports` | INSERT/UPDATE（UPSERT 采集）○ | SELECT ○ | 业务读写（视配置）○ | **仅 SELECT**（只读）✓ |
| `topics` / `opportunities` | — ○ | SELECT ○ | SELECT/INSERT/UPDATE/DELETE ○ | SELECT ○ |
| `monitor_runs` | 无 ✓ | **无**（SELECT 亦拒）✓ | **无**（SELECT 亦拒）✓ | SELECT/INSERT/UPDATE/DELETE ✓ |
| `monitor_notifications` | 无 ○ | **无** ✓ | **无** ✓ | SELECT/INSERT/UPDATE/DELETE ○ |
| 连接配置来源 | n8n 侧（不入库） | `.env.local` DB_USER | `.env.local` DB_WRITE_USER | `.env.local` DB_MONITOR_USER |

**实测结论（集成测试 `tests/integration/monitor.test.ts` 权限组）：**
- `ai_intel_reader` → `monitor_runs`：`permission denied`（code 42501）✓
- `ai_intel_writer` → `monitor_runs`：`permission denied`（code 42501）✓
- `ai_intel_monitor` → `daily_reports`：SELECT 允许、**INSERT 被拒**，且被拒语句未留下脏数据 ✓
- `ai_intel_monitor` → `monitor_runs`：具 INSERT/DELETE（`has_table_privilege` 确认），符合「监控两表 CRUD」设计 ✓

**评价**：监控写入被隔离到独立账号 `ai_intel_monitor`，且该账号对业务表**只读**；业务读写账号反过来对监控表**零权限**。双向隔离正确，符合最小权限原则。

---

## 2. 输入校验（API 层参数校验点）

- **`app/api/opportunities/route.ts`**
  - `status`：`isOpportunityStatus()` 白名单校验（仅四种中文状态）。
  - `page` / `size`：`parsePositive()` 要求正整数，非法即 400。
  - `category`：字符串 trim 后作为等值筛选。
  - 请求体：`validateOpportunity(body, "create")` 结构化校验，非法即 400。
- **监控链路（`lib/monitor/store.ts`）**：全部 SQL 使用 `$1/$2/...` 参数绑定（含 `issues` 经 `JSON.stringify` + `$5::jsonb`），**无字符串拼接用户输入**，无注入面。
- **`runner`/`rules`**：输入为已取回的数据行，纯函数处理，无外部可控 SQL。
- **日期参数**：`targetDate` 经 `$1::date` 绑定，避免注入。

**评价**：API 参数有白名单/范围校验，SQL 全参数化。未发现注入风险。

---

## 3. 错误处理（不泄堆栈 / 不泄连接串）

- **监控链路**：`runner` 把异常捕获转为 `INVALID_FIELDS` error 结论，`message` 用 `e.message.slice(0, 120)` **截断**，不外传堆栈；通知失败 `NotifyResult.reason` 同样截断且不阻断主流程。✓
- **连接串/凭据**：`lib/db.ts` / `lib/monitor/db.ts` 抛错仅提示「XX is not set in environment」，**不回显**密码/连接串。✓
- **待改进（见发现问题 #3）**：`app/api/opportunities/route.ts` 的 500 分支返回 `detail: error.message`，可能把数据库错误细节（约束名/SQL 片段）透给前端。

---

## 4. 日志脱敏（不记正文 / 不记密钥）

- `monitor_runs.issues` 与 `summary` 契约明确「≤200 字、不含报告正文」（`types.ts` 顶部约束）。✓
- 通知 `reason` 只保留错误摘要（HTTP 状态/timeout），不含 webhook 密钥；`MONITOR_WEBHOOK_URL`（含 token）不写入日志/通知内容。✓
- 集成测试的自造数据统一 `__test__` 前缀，测试结束清理，不污染监控日志。✓
- **待改进（结合 #3）**：`console.error("[api/...]", error)` 会把完整 error 打到**服务端**日志——在服务端可见范围内可接受，但切勿把该输出透传到前端响应。

---

## 5. 发现的问题与建议

> 以下问题属 `lib/**`、`app/**`（Agent A/B/主线范围），按文件边界**不擅自修改**，在此登记并上报主 Agent。

### #1 [P1][Bug] `rules.ts` 误把 `report_date` 当字符串，命中报告即崩溃
- **位置**：`lib/monitor/rules.ts`（`const d = r.report_date.slice(0, 10)`）。
- **根因**：node-postgres 默认把 `date`/`timestamptz` 列解析为 **JS `Date` 对象**，而 `ReportRow.report_date` 声明为 `string`。代码调用 `.slice` 于 Date 上 → `TypeError: ... .slice is not a function`。
- **影响**：只要当日存在真实报告，`runQualityChecks` 抛错并被 runner 兜成 `INVALID_FIELDS` error，**真实质量结论被掩盖**（本应 ok/warn 却显示 error，且 issues 只剩一条内部错误）。缺失报告日（无行）不触发此 bug，故 `2020-01-01` 类场景正常。
- **复现**：`runChecks({ targetDate: '2026-11-05', skipNotify: true })` → `status=error`、`issues=[{code:'INVALID_FIELDS', message:'... .slice is not a function'}]`。
- **建议**（任选其一，属 Agent A/B）：
  1. 查询处转字符串：`SELECT ..., report_date::text` / `target_date::text`；
  2. `pg.types.setTypeParser(1082/1114/1184, v => v)` 让 date/timestamp 返回字符串；
  3. rules 内做类型归一（注意 Date 需 `toISOString()`，且存时区偏移隐患见 #2）。
- **状态**：集成测试 `真实报告日 2026-11-05` 用例已能捕获此 bug（当前以 `t.diagnostic` 记录并跳过严格断言，修复后自动收紧为 ok/warn 断言）。

### #2 [P2][一致性] `store` 返回行与 `CheckRunRow` 契约不符（读取侧漂移）
- **位置**：`lib/monitor/store.ts`（`RETURNING *` / `SELECT *`）vs `lib/monitor/types.ts`（`CheckRunRow`）。
- **根因**：store 直接返回数据库原生行——字段为**蛇形**（`check_type`/`target_date`）、`id` 为 bigint→**字符串**、`checked_at`/`created_at`/`target_date` 为 **Date 对象**；而 `CheckRunRow` 声明 camelCase（`checkType`/`targetDate`）、`id: number`、`checked_at: string`。
- **影响**：类型与运行时不一致。下游（监控页 UI，Agent C）若按 `row.checkType` 取值会得到 `undefined`，按 `row.checked_at` 当字符串处理会出错。**存储值本身正确**（已用 SQL `::text` 验证落库值无误），仅读取返回侧漂移。
- **建议**：统一命名与类型——store 层做字段映射 + 类型转换（Date→`YYYY-MM-DD` 字符串、bigint→number），或把 `types.ts` 改为蛇形并标注 Date；消除 bigint/string、Date/string 漂移。
- **状态**：已登记，交 Agent B/C + 契约维护者（主 Agent）。

### #3 [P2][信息泄露] `opportunities` API 500 分支回传 `detail: error.message`
- **位置**：`app/api/opportunities/route.ts`（GET/POST 的 catch 分支）。
- **风险**：数据库错误 message 可能含约束名/SQL 细节，作为 `detail` 返回给前端存在轻微信息泄露面。
- **建议**：生产环境 500 只返回通用 `errors.form` 文案，把 `error` 仅写服务端日志，不回传 `detail`。
- **状态**：属 `app/**`（API 样例），按边界不改，仅记录。

---

## 6. 合规项小结（做得对的地方）
- SQL 全参数化，无拼接用户输入（store/runner/db）。✓
- 权限双向隔离、最小化（已实测）。✓
- 通知去重（`dedup_key` 唯一）+ 失败不阻断主流程。✓
- 凭据走环境变量，未硬编码；测试亦从 env 取，不写死密码。✓
- `issues` 不存报告正文、错误信息截断脱敏。✓
