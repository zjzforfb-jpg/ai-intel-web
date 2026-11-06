-- 004: n8n 采集失败兜底表（report_failures）—— 纯新增 additive-only，幂等可重跑
-- 执行者：仅主 Agent 统一执行；任何子 Agent 不得执行 DDL
-- 用途：n8n 工作流在采集/生成各阶段失败时写入本表（失败也要留痕），
--       Web 侧监控规则 FAILURE_RECORD 读取（与 MISSING_REPORT 可同时触发，互不抑制）
-- 红线：不改动 daily_reports / monitor_* 及任何既有表/角色/权限

CREATE TABLE IF NOT EXISTS report_failures (
  id         serial PRIMARY KEY,
  report_date DATE NOT NULL,          -- 失败所属的报告日期
  stage      TEXT NOT NULL,          -- 失败阶段（采集/生成/校验等，由 n8n 定义）
  reason     TEXT NOT NULL,          -- 失败原因摘要
  raw_output TEXT,                   -- 原始输出（可选，供排障）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_failures_date_stage_unique UNIQUE (report_date, stage)
);

CREATE INDEX IF NOT EXISTS idx_report_failures_date ON report_failures(report_date);

-- 监控账号只读（FAILURE_RECORD 规则查询用）
GRANT SELECT ON report_failures TO ai_intel_monitor;
