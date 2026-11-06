-- 009: entity_mentions 唯一约束加固 —— 让 NULL 也参与去重
--
-- 背景：
--   008 把幂等键定为 (entity_id, report_id)。但 PostgreSQL 默认认为
--   「NULL 不等于 NULL」，所以当 report_id 为 NULL 时，唯一约束形同虚设，
--   同一实体可以插入任意多条 report_id 为 NULL 的提及。
--
--   report_id 为 NULL 只会在「日报还没落库就先抽实体」这种异常时序下出现。
--   正常链路里 n8n 先写日报再抽实体，report_id 一定有值。
--   但既然这是唯一约束的最后一道防线，就不该留这个缺口。
--
-- 修正：改用 UNIQUE NULLS NOT DISTINCT（PostgreSQL 15+ 支持，本项目是 16）。
--   这样 (entity_id, NULL) 与 (entity_id, NULL) 会被判定为冲突，从而走 UPSERT。
--
-- 执行者：主控 Agent
-- 幂等：可重复执行

DO $$
BEGIN
  -- 先删掉 008 建的那个普通唯一约束
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_mentions_entity_report_key'
      AND conrelid = 'entity_mentions'::regclass
  ) THEN
    ALTER TABLE entity_mentions DROP CONSTRAINT entity_mentions_entity_report_key;
  END IF;

  -- 再建 NULLS NOT DISTINCT 版本
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_mentions_entity_report_nullseq_key'
      AND conrelid = 'entity_mentions'::regclass
  ) THEN
    ALTER TABLE entity_mentions
      ADD CONSTRAINT entity_mentions_entity_report_nullseq_key
      UNIQUE NULLS NOT DISTINCT (entity_id, report_id);
  END IF;
END $$;
