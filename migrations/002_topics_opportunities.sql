-- 002: 专题追踪 + 商业机会管理 —— 纯新增（additive-only），幂等可重跑
-- 执行者：仅主 Agent 统一执行；任何子 Agent 不得执行 DDL
-- 前置：写入角色 ai_intel_writer 已由主 Agent 创建（本文件不含密码）
-- 红线：不改动 daily_reports 及任何既有表/角色/权限

CREATE TABLE IF NOT EXISTS topics (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL DEFAULT '公司' CHECK (category IN ('公司','模型','产品','技术')),
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opportunities (
  id                 BIGSERIAL PRIMARY KEY,
  title              TEXT NOT NULL,
  description        TEXT,
  category           TEXT,
  source_report_date DATE,  -- 软引用 daily_reports.report_date，不加外键以避免触碰原表
  status             TEXT NOT NULL DEFAULT '待研究' CHECK (status IN ('待研究','验证中','已实施','已放弃')),
  notes              TEXT,
  action_plan        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topics_category ON topics (category);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities (status);
CREATE INDEX IF NOT EXISTS idx_opportunities_source_date ON opportunities (source_report_date);

-- 权限：ai_intel_writer 仅获得新表 CRUD + 日报只读（不改任何既有授权）
GRANT USAGE ON SCHEMA public TO ai_intel_writer;
GRANT SELECT ON daily_reports TO ai_intel_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON topics, opportunities TO ai_intel_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_intel_writer;

-- 只读账号可读新表（展示页用），仍无任何写权限
GRANT SELECT ON topics, opportunities TO ai_intel_reader;
