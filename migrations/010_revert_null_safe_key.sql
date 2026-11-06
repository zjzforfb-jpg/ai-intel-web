-- 010: 撤销 009 的 NULLS NOT DISTINCT 加固 —— 它比实际需要更严
--
-- 009 想解决「report_id 为 NULL 时唯一约束不生效」，但用了 NULLS NOT DISTINCT，
-- 副作用是：同一实体、report_id 都为 NULL、但 mention_date 不同的两条提及
-- （正常的「跨天、日报尚未入库」场景）会被误判为冲突。
--
-- 实测：加上之后 tests/entities.test.ts 直接撞
--   entity_mentions_entity_report_key 唯一约束报错。
--
-- 正确做法：数据库保持普通 UNIQUE (entity_id, report_id)，允许 NULL 多行；
-- 「report_id 为 NULL 时如何避免重复」交给应用层处理
-- （lib/entities-write.ts 已实现：按 entity_id + mention_date 先查再更新/插入）。
--
-- 正常情况下 report_id 一定有值（n8n 先写日报再抽实体），所以这个缺口在真实链路上不成立。
--
-- 执行者：主控 Agent
-- 幂等：可重复执行

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_mentions_entity_report_nullseq_key'
      AND conrelid = 'entity_mentions'::regclass
  ) THEN
    ALTER TABLE entity_mentions DROP CONSTRAINT entity_mentions_entity_report_nullseq_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_mentions_entity_report_key'
      AND conrelid = 'entity_mentions'::regclass
  ) THEN
    ALTER TABLE entity_mentions
      ADD CONSTRAINT entity_mentions_entity_report_key UNIQUE (entity_id, report_id);
  END IF;
END $$;
