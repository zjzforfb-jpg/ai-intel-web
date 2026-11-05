# 回滚手册（rollback）

监控系统（迁移 `003_monitoring`）的回滚步骤。目标：安全撤销监控能力，**不触碰业务数据**（`daily_reports` / `topics` / `opportunities` 等一律保留）。

> 前置：回滚前先**停止监控调度**（cron/launchd），否则回滚后仍会触发检查并报错。

---

## 1. 数据库回滚

### 影响说明（先读）
- 执行 `migrations/003_monitoring_down.sql` **只删除监控两张表**：
  - `monitor_notifications`（通知日志）
  - `monitor_runs`（检查记录）
- **不影响任何业务表**：`daily_reports`、`topics`、`opportunities` 及其数据完整保留。
- 删除的是**监控日志数据**（每次检查的结论/通知记录），删了不可恢复；如需留档请先导出：
  ```bash
  # 可选：导出监控日志留档（用监控账号只读导出）
  node --env-file=.env.local -e "/* 用 pg 导出 monitor_runs / monitor_notifications 到 CSV/JSON */"
  ```
- 账号 `ai_intel_monitor` 本身**保留**（便于回滚后再启用），只是表没了；如需连账号一起清理见下方「可选」。

### 执行步骤（仅主 Agent 执行 DDL）
```bash
# 1) 停止调度（cron）
crontab -e          # 注释/删除 monitor:check 那一行
#    或 launchd：launchctl unload <plist>

# 2) 执行回滚 SQL（在 Postgres 容器内，用具备 DDL 权限的账号，如超级用户）
#    容器名见项目约定：n8n-radar-postgres
docker exec -i n8n-radar-postgres \
  psql -U <超级用户> -d ai_intelligence \
  < migrations/003_monitoring_down.sql
```

`003_monitoring_down.sql` 内容（幂等，可重复执行）：
```sql
DROP TABLE IF EXISTS monitor_notifications;  -- 先删依赖子表
DROP TABLE IF EXISTS monitor_runs;
```

### 可选：撤销监控账号权限/删除账号
```sql
-- 保留账号、仅收回权限（回滚后再启用只需重新 GRANT，见 003_monitoring.sql）
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ai_intel_monitor;

-- 若确认彻底不再使用，可删除账号（谨慎；会丢失登录能力）
-- DROP ROLE IF EXISTS ai_intel_monitor;
```

### 回滚后自检
```sql
SELECT to_regclass('public.monitor_runs');          -- 应为 NULL
SELECT to_regclass('public.monitor_notifications'); -- 应为 NULL
SELECT count(*) FROM daily_reports;                 -- 业务数据仍在
```

---

## 2. 代码回滚

监控代码位于 `lib/monitor/**`、`migrations/003_monitoring*`、`app/**`（监控页）、`scripts/**`（CLI）、`tests/integration/monitor.test.ts`、`docs/**`。按需选择：

### 方案 A：整段功能 revert（推荐，保留历史）
```bash
# 在主干（main）上，找到引入监控的提交
git log --oneline -- lib/monitor migrations/003_monitoring.sql

# 生成反向提交（不改历史、可追溯）
git revert <监控相关提交的 SHA>...
git commit
```

### 方案 B：分支弃用（尚未合并时）
若监控仍在独立分支（如 `feat/monitor-*`）未合并：
```bash
# 确认无未合并需要保留的改动后，删除分支（不合并即等于弃用）
git branch -D feat/monitor-xxx
```
> 注意：多 Agent 并行开发时，各 worktree 分支由主线统一合并；子任务分支**不合并、不 push**，回滚即弃用分支即可。

### 方案 C：保留代码、仅禁用入口（可逆，推荐先试）
- 注释/移除导航里的「监控」入口与路由注册，代码留在库里，随时可再启用。
- 移除 `package.json` 的 `monitor:check` 脚本与 cron 行（属共享热点文件，只删监控相关行，勿动其它脚本）。

### 代码回滚后自检
```bash
npx tsc --noEmit     # 零错误
npm run build        # 构建通过
```

---

## 3. 通知关闭（仅停告警、不撤监控）

只想**停止 Webhook 告警**、但保留检查与记录时，无需回滚库表：

```bash
# 清空 / 注释 MONITOR_WEBHOOK_URL
# .env.local
MONITOR_WEBHOOK_URL=          # 留空 → 通知自动 skipped（不发送）
```

- `MONITOR_WEBHOOK_URL` 为空时，`notifyWebhook` 返回 `{ status: "skipped" }`，不发起任何网络请求。
- 重启 Next.js/CLI 进程使环境变量生效。
- 此方案**可逆**：填回 URL 即恢复告警。检查仍会照常写 `monitor_runs`。

---

## 4. 回滚决策速查

| 想达到的效果 | 采取方案 |
|---|---|
| 只是不想被吵 | 通知关闭（清空 `MONITOR_WEBHOOK_URL`） |
| 暂停监控但保留能力 | 停 cron + 代码方案 C（禁用入口） |
| 彻底移除监控功能 | 数据库回滚 + 代码方案 A/B |
| 彻底清理含账号 | 数据库回滚 + `DROP ROLE ai_intel_monitor`（谨慎） |

> 任何回滚动作属**高风险/不可逆**（尤其 DROP 表/角色、git 强推），执行前务必备份/留档并二次确认。业务数据（`daily_reports` 等）在任何方案下都不应被删除。
