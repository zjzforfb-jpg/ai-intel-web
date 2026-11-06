-- 005: 选题自动提取（topic_ideas）—— 纯新增（additive-only），幂等可重跑
-- 执行者：Agent A（选题提取模块）按任务授权执行本文件（唯一允许的 DDL，仅限本文件内容）
-- 前置：写入角色 ai_intel_reader / ai_intel_writer / ai_intel_monitor 均已存在（本文件不含密码）
-- 红线：不改动 daily_reports 及任何既有表/角色/权限；n8n 通过 UPSERT (report_date, title) 幂等写入

CREATE TABLE IF NOT EXISTS topic_ideas (
  id                BIGSERIAL PRIMARY KEY,
  report_date       DATE NOT NULL,  -- 来源日报日期，软引用 daily_reports.report_date，不加外键以避免触碰原表
  title             TEXT NOT NULL,  -- 标题钩子：短视频标题，含钩子感
  angle             TEXT,           -- 切入角度
  source_material   TEXT,           -- 素材来源：日报中哪条/哪些文章、链接
  reference_visuals TEXT,           -- 参考画面：建议的画面/镜头描述
  value_score       SMALLINT CHECK (value_score BETWEEN 1 AND 10),  -- 选题价值评分 1-10
  status            TEXT NOT NULL DEFAULT '待制作' CHECK (status IN ('待制作','已选用','已制作','已放弃')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_date, title)  -- 同日同标题防重，供 n8n UPSERT 使用
);

CREATE INDEX IF NOT EXISTS idx_topic_ideas_report_date ON topic_ideas (report_date);
CREATE INDEX IF NOT EXISTS idx_topic_ideas_status ON topic_ideas (status);

-- 权限：ai_intel_writer 获得新表 CRUD + 本表序列（不触碰其他表的既有授权）
GRANT SELECT, INSERT, UPDATE, DELETE ON topic_ideas TO ai_intel_writer;
GRANT USAGE, SELECT ON SEQUENCE topic_ideas_id_seq TO ai_intel_writer;

-- 只读账号可读新表（展示页用），仍无任何写权限
GRANT SELECT ON topic_ideas TO ai_intel_reader;
