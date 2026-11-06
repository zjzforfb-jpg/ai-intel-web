#!/usr/bin/env node
// 清理阶段 D 端到端测试注入的重复记录
//
// 背景：阶段 D 调试去重逻辑期间，n8n 端到端跑了 4 次，每次因为去重器
// 的关键词切分与 TS 侧不一致而各插入了 1 条重复商机（117-120）和 1 条重复选题（161-164）。
// 这些是测试污染，不是真实业务数据。
//
// 处理原则（与 docs/phase2-history-merge-plan.md 一致）：
//   不物理删除，置 status='已放弃'，并在 notes 里写明合并去向。
//
// 用法：
//   node --env-file=.env.local --import tsx scripts/phase2-cleanup-e2e-rows.mts           # 预演
//   node --env-file=.env.local --import tsx scripts/phase2-cleanup-e2e-rows.mts --apply   # 执行
import { Client } from "pg";

const APPLY = process.argv.includes("--apply");

// 必须用 writer 账号：只读账号 ai_intel_reader 无 UPDATE 权限
const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_WRITE_USER ?? "ai_intel_writer",
  password: process.env.DB_WRITE_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false,
});
await client.connect();

// 商机：保留最早的那条（42 是 21:08 那次真实采集），把 117-120 置为已放弃
const oppKeep = 42;
const oppDrop = [117, 118, 119, 120];

// 选题：保留最早的 21（21:08 真实采集），把 161-164 置为已放弃
const ideaKeep = 21;
const ideaDrop = [161, 162, 163, 164];

const oppKeepRes = await client.query(`SELECT id, title FROM opportunities WHERE id = $1`, [oppKeep]);
const ideaKeepRes = await client.query(`SELECT id, title FROM topic_ideas WHERE id = $1`, [ideaKeep]);

if (oppKeepRes.rowCount === 0) throw new Error(`商机 #${oppKeep} 不存在，放弃清理`);
if (ideaKeepRes.rowCount === 0) throw new Error(`选题 #${ideaKeep} 不存在，放弃清理`);

console.log(`商机保留 #${oppKeep} ${oppKeepRes.rows[0].title}`);
const oppDropRes = await client.query(
  `SELECT id, title FROM opportunities WHERE id = ANY($1::int[]) AND status <> '已放弃' ORDER BY id`,
  [oppDrop]
);
for (const r of oppDropRes.rows) console.log(`  将合并 #${r.id} → #${oppKeep}：${r.title}`);

console.log(`\n选题保留 #${ideaKeep} ${ideaKeepRes.rows[0].title}`);
const ideaDropRes = await client.query(
  `SELECT id, title FROM topic_ideas WHERE id = ANY($1::int[]) AND status <> '已放弃' ORDER BY id`,
  [ideaDrop]
);
for (const r of ideaDropRes.rows) console.log(`  将合并 #${r.id} → #${ideaKeep}：${r.title}`);

if (!APPLY) {
  console.log("\n（预演模式，未写库。加 --apply 执行）");
  await client.end();
  process.exit(0);
}

await client.query("BEGIN");
try {
  for (const r of oppDropRes.rows) {
    await client.query(
      `UPDATE opportunities
       SET status = '已放弃',
           notes = COALESCE(notes, '') || E'\n【合并】与 #' || $2 || ' 语义重复，本条已并入该记录（阶段 D 测试污染清理）',
           updated_at = NOW()
       WHERE id = $1`,
      [r.id, oppKeep]
    );
  }
  for (const r of ideaDropRes.rows) {
    await client.query(
      `UPDATE topic_ideas
       SET status = '已放弃',
           updated_at = NOW()
       WHERE id = $1`,
      [r.id]
    );
  }
  await client.query("COMMIT");
  console.log(`\n已置为已放弃：商机 ${oppDropRes.rowCount} 条，选题 ${ideaDropRes.rowCount} 条`);
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
}

const after = await client.query(
  `SELECT 'opportunities' AS t, count(*) FILTER (WHERE status <> '已放弃')::int AS active,
          count(*)::int AS total FROM opportunities
   UNION ALL
   SELECT 'topic_ideas', count(*) FILTER (WHERE status <> '已放弃')::int, count(*)::int FROM topic_ideas
   ORDER BY 1`
);
console.log("\n清理后：");
for (const r of after.rows) console.log(`  ${r.t}: 有效 ${r.active} / 总 ${r.total}`);

await client.end();
