-- 007: 内容项目（content_projects）—— 纯新增（additive-only），幂等可重跑
-- 执行者：主控 Agent（阶段 3 唯一负责 DDL 的角色）
-- 前置：ai_intel_reader / ai_intel_writer 已存在；topic_ideas 已存在（005）
-- 红线：不改动 topic_ideas / daily_reports 及任何既有表；source_idea_id 为软引用，不加外键。
--       内容项目只「引用」选题，绝不回写选题字段。

CREATE TABLE IF NOT EXISTS content_projects (
  id                   BIGSERIAL PRIMARY KEY,
  title                TEXT NOT NULL,

  -- 来源（软引用，不设外键以避免触碰既有表）
  source_idea_id       BIGINT,                      -- 引用 topic_ideas.id
  source_report_date   DATE,                        -- 引用 daily_reports.report_date

  -- 策划
  content_type         TEXT NOT NULL DEFAULT 'ai_news'
                       CHECK (content_type IN ('ai_news','ai_product','ai_tutorial','tech_trend','biz_opportunity','story_case')),
  target_audience      TEXT,
  content_angle        TEXT,
  hook                 TEXT,
  key_points           JSONB NOT NULL DEFAULT '[]'::jsonb,
  reference_materials  JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_questions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  production_notes     TEXT,
  duration_seconds     INTEGER CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 5 AND 3600),
  video_form           TEXT,

  -- 项目状态
  status               TEXT NOT NULL DEFAULT '草稿'
                       CHECK (status IN ('草稿','策划中','待生产','已导出','已回传','已完成','已放弃')),

  -- 与用户生产系统（AI_DIRECTOR_PROJECT 文件流水线）的对接状态
  production_status    TEXT NOT NULL DEFAULT '未导出'
                       CHECK (production_status IN ('未导出','已导出待生产','已导入脚本','已出分镜','已完成')),
  exported_at          TIMESTAMPTZ,
  export_path          TEXT,

  -- 生产回传结果
  script_result        JSONB,
  storyboard_result    JSONB,
  quality_check        JSONB,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_projects_status      ON content_projects (status);
CREATE INDEX IF NOT EXISTS idx_content_projects_production  ON content_projects (production_status);
CREATE INDEX IF NOT EXISTS idx_content_projects_source_date ON content_projects (source_report_date);

-- 一条选题只允许建一个内容项目；手工项目（source_idea_id 为 NULL）不受限
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_projects_idea
  ON content_projects (source_idea_id)
  WHERE source_idea_id IS NOT NULL;

-- ============ 权限 ============
GRANT SELECT, INSERT, UPDATE, DELETE ON content_projects            TO ai_intel_writer;
GRANT USAGE, SELECT ON SEQUENCE content_projects_id_seq             TO ai_intel_writer;
GRANT SELECT ON content_projects                                    TO ai_intel_reader;
