-- 008: 修正 entity_mentions 的幂等键粒度 —— 纯约束变更，不动数据语义
--
-- 背景（实测发现）：
--   006 把幂等键定成 (entity_id, report_id, source_title)。
--   但日报重跑时 LLM 会重写头条标题，source_title 随之变化，
--   导致「同一实体在同一篇日报」的提及不断累积。
--   实测：连续执行两次，entity_mentions 从 8 条涨到 17 条，不满足幂等要求。
--
-- 修正：幂等键改为 (entity_id, report_id)。
--   「一个实体在一篇日报里出现过」= 一条提及，这是实体统计正确的粒度。
--   重跑同一篇日报时，是覆盖该条提及（更新标题/上下文/分数），而不是追加。
--
-- 影响：source_title / source_url / context 仍保留，用于展示「在哪条头条出现」，
--       只是不再参与唯一性判断。
--
-- 执行者：主控 Agent
-- 幂等：可重复执行（先判断约束是否存在）

DO $$
BEGIN
  -- 删除旧约束（若存在）
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_mentions_dedup_key'
      AND conrelid = 'entity_mentions'::regclass
  ) THEN
    ALTER TABLE entity_mentions DROP CONSTRAINT entity_mentions_dedup_key;
  END IF;

  -- 建立新约束（若尚未存在）
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_mentions_entity_report_key'
      AND conrelid = 'entity_mentions'::regclass
  ) THEN
    ALTER TABLE entity_mentions
      ADD CONSTRAINT entity_mentions_entity_report_key UNIQUE (entity_id, report_id);
  END IF;
END $$;
