// 阶段 3：按当前日报内容重建实体提及
//
// 用途：
//   1) 日报内容被修正/恢复后，实体提及需要与之对齐（否则 source_title 指向已不存在的头条）
//   2) 验证 App 侧「抽取 → 写入」链路能独立跑通（不依赖 n8n）
//
// 用法：
//   node --env-file=.env.local --import tsx scripts/phase3-rebuild-mentions.mts           # 预演
//   node --env-file=.env.local --import tsx scripts/phase3-rebuild-mentions.mts --apply   # 执行
import { Client } from "pg";
import { extractEntityMentions } from "../lib/entities-extract.js";

const APPLY = process.argv.includes("--apply");

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_WRITE_USER ?? "ai_intel_writer",
  password: process.env.DB_WRITE_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false,
});
await client.connect();

const reports = await client.query(
  `SELECT id, report_date::text AS d, report_markdown FROM daily_reports WHERE report_markdown IS NOT NULL ORDER BY report_date`
);

let totalMentions = 0;
for (const r of reports.rows) {
  const mentions = extractEntityMentions({
    reportDate: r.d,
    reportMarkdown: r.report_markdown,
  });
  totalMentions += mentions.length;
  console.log(`${r.d} (report_id=${r.id}): 抽出 ${mentions.length} 条提及`);
  for (const m of mentions) {
    console.log(`   ${m.normalizedName.padEnd(14)} ${m.entityType.padEnd(12)} score=${m.importanceScore}`);
  }

  if (!APPLY) continue;

  // 先清掉该日报的旧提及，再按新内容写入
  await client.query(`DELETE FROM entity_mentions WHERE report_id = $1`, [r.id]);

  for (const m of mentions) {
    await client.query(
      `WITH e AS (
         INSERT INTO entities (name, normalized_name, entity_type, aliases)
         VALUES ($1, $2, $3, $4::text[])
         ON CONFLICT (normalized_name) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO entity_mentions
         (entity_id, report_id, mention_date, source_title, source_url, context, importance_score)
       SELECT e.id, $5::bigint, $6::date, $7, $8, $9, $10::smallint FROM e
       ON CONFLICT (entity_id, report_id) DO UPDATE SET
         source_title = EXCLUDED.source_title,
         source_url = EXCLUDED.source_url,
         context = EXCLUDED.context,
         importance_score = EXCLUDED.importance_score`,
      [
        m.canonical,
        m.normalizedName,
        m.entityType,
        m.aliases,
        r.id,
        m.reportDate,
        m.sourceTitle,
        m.sourceUrl,
        m.context,
        m.importanceScore,
      ]
    );
  }
}

console.log(`\n合计 ${totalMentions} 条提及`);

if (APPLY) {
  const stat = await client.query(
    `SELECT (SELECT count(*)::int FROM entities) ent,
            (SELECT count(*)::int FROM entity_mentions) ment,
            (SELECT count(DISTINCT entity_id)::int FROM entity_mentions) with_mention`
  );
  console.log("写入后:", JSON.stringify(stat.rows[0]));
} else {
  console.log("\n（预演模式，未写库。加 --apply 执行）");
}

await client.end();
