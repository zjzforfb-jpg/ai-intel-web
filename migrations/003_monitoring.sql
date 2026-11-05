-- 003: 自动化监控 —— 检查记录与通知日志（纯新增 additive-only，幂等可重跑）
-- 执行者：仅主 Agent 统一执行；任何子 Agent 不得执行 DDL
-- 前置：监控角色 ai_intel_monitor 已由主 Agent 创建（本文件不含密码）
-- 红线：不改动 daily_reports / topics / opportunities 及任何既有表/角色/权限

CREATE TABLE IF NOT EXISTS monitor_runs (
  id           BIGSERIAL PRIMARY KEY,
  check_type   TEXT NOT NULL DEFAULT 'daily_quality',
  target_date  DATE,                                  -- 被检查的报告日期（全局检查可 NULL）
  status       TEXT NOT NULL CHECK (status IN ('ok','warn','error')),
  summary      TEXT NOT NULL,                         -- 一句话摘要（≤200 字，不含报告正文）
  issues       JSONB NOT NULL DEFAULT '[]',           -- QualityIssue[]（code/severity/message/meta），禁止存整篇正文
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitor_notifications (
  id         BIGSERIAL PRIMARY KEY,
  run_id     BIGINT NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
  dedup_key  TEXT NOT NULL UNIQUE,                    -- 幂等去重：同一异常不重复通知
  channel    TEXT NOT NULL DEFAULT 'webhook',
  status     TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error      TEXT,                                    -- 脱敏错误摘要，不含密钥/堆栈全文
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_type_date ON monitor_runs (check_type, target_date, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_runs_status ON monitor_runs (status);
CREATE INDEX IF NOT EXISTS idx_monitor_runs_checked_at ON monitor_runs (checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_notifications_run ON monitor_notifications (run_id);

-- 监控账号：只读业务表 + 仅监控两表 CRUD（含 DELETE 以便测试/清理监控日志；不触及业务数据）
GRANT USAGE ON SCHEMA public TO ai_intel_monitor;
GRANT SELECT ON daily_reports, topics, opportunities TO ai_intel_monitor;
GRANT SELECT, INSERT, UPDATE, DELETE ON monitor_runs, monitor_notifications TO ai_intel_monitor;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_intel_monitor;
