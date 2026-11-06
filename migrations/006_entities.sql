-- 006: 实体追踪（entities + entity_mentions）—— 纯新增（additive-only），幂等可重跑
-- 执行者：主控 Agent（阶段 3 唯一负责 DDL 的角色）
-- 前置：写入角色 ai_intel_reader / ai_intel_writer 已存在（本文件不含密码）
-- 红线：不改动 daily_reports / topic_ideas / opportunities 及任何既有表、角色、权限；
--       report_id 为软引用（不加外键），与 005 的 report_date 软引用约定一致。

-- ============ 实体主表 ============
CREATE TABLE IF NOT EXISTS entities (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,                    -- 展示名（canonical，如 'OpenAI'）
  normalized_name TEXT NOT NULL,                    -- 归一化名，查重键
  entity_type     TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (entity_type IN ('company','person','ai_product','technology','open_source','organization','unknown')),
  aliases         TEXT[] NOT NULL DEFAULT '{}',     -- 别名（小写）
  description     TEXT,                             -- 人工维护；自动流程永不覆盖
  website         TEXT,                             -- 人工维护；自动流程永不覆盖
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 同一归一化名只能有一个实体：大小写/别名差异不会重复建实体
  CONSTRAINT entities_normalized_name_key UNIQUE (normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name_lower ON entities (lower(name));

-- ============ 实体提及表 ============
CREATE TABLE IF NOT EXISTS entity_mentions (
  id               BIGSERIAL PRIMARY KEY,
  entity_id        BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  report_id        BIGINT,                          -- 软引用 daily_reports.id（不加 FK）
  mention_date     DATE NOT NULL,                   -- 冗余自日报，便于按日聚合
  source_title     TEXT,                            -- 头条标题
  source_url       TEXT,                            -- 头条原文链接；取不到即 NULL，不编造
  context          TEXT,                            -- 实体所在原文片段（≤200 字）
  importance_score SMALLINT NOT NULL DEFAULT 5
                   CHECK (importance_score BETWEEN 1 AND 10),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 幂等键：同一实体 + 同一日报 + 同一头条，只允许一行
  CONSTRAINT entity_mentions_dedup_key UNIQUE (entity_id, report_id, source_title)
);

CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity_date
  ON entity_mentions (entity_id, mention_date DESC);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_date
  ON entity_mentions (mention_date DESC);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_report
  ON entity_mentions (report_id);

-- ============ 权限 ============
-- 写入角色：实体抽取与人工维护都需要 CRUD
GRANT SELECT, INSERT, UPDATE, DELETE ON entities        TO ai_intel_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_mentions TO ai_intel_writer;
GRANT USAGE, SELECT ON SEQUENCE entities_id_seq        TO ai_intel_writer;
GRANT USAGE, SELECT ON SEQUENCE entity_mentions_id_seq TO ai_intel_writer;

-- 只读角色：页面展示
GRANT SELECT ON entities        TO ai_intel_reader;
GRANT SELECT ON entity_mentions TO ai_intel_reader;
