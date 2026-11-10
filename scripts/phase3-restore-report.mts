// 阶段 3 修复脚本：把 2026-11-06 日报恢复到阶段 3 开始前的原始内容
//
// 背景：阶段 3 调试实体抽取时，为了做端到端验证，多次执行了 CR-01 工作流。
// 该工作流对同日日报是 UPSERT，于是 11-06 那篇日报被重新生成，
// 原始内容（21:08 采集，7749 字符）被覆盖成了凌晨新抓的内容。
// 这不是预期行为，属于调试副作用，必须还原。
//
// 做法：从 pre-phase3 备份的 COPY 块里精确取出 id=5 那一行，
// 反转义后 UPDATE 回去。不整库恢复，避免冲掉阶段 3 新建的表与实体数据。
//
// 用法：
//   node --env-file=.env.local --import tsx scripts/phase3-restore-report.mts           # 预演
//   node --env-file=.env.local --import tsx scripts/phase3-restore-report.mts --apply   # 执行
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Client } from "pg";

const APPLY = process.argv.includes("--apply");
const TARGET_ID = 5;

// 备份目录：可用 AIINTEL_PHASE3_BACKUP_DIR 覆盖，
// 默认 $HOME/WorkBuddyData/backups/phase3（不写死任何机器的个人目录名）
const backupDir =
  process.env.AIINTEL_PHASE3_BACKUP_DIR ??
  path.join(homedir(), "WorkBuddyData", "backups", "phase3");
const file = readdirSync(backupDir)
  .filter((f) => f.startsWith("pre-phase3-") && f.endsWith(".sql"))
  .sort()
  .pop();
if (!file) throw new Error("找不到 pre-phase3 备份文件");
const dumpPath = `${backupDir}/${file}`;
console.log("备份文件:", dumpPath);

const sql = readFileSync(dumpPath, "utf8");
const lines = sql.split("\n");

// 定位 daily_reports 的 COPY 块
let inBlock = false;
let rowLine: string | null = null;
const cols =
  "id, report_date, title, report_markdown, report_html, generated_at, total_articles, headline_count, status, validation, created_at".split(
    ", "
  );

for (const line of lines) {
  if (!inBlock && line.startsWith("COPY public.daily_reports")) {
    inBlock = true;
    continue;
  }
  if (inBlock) {
    if (line === "\\.") break;
    if (line.startsWith(`${TARGET_ID}\t`)) {
      rowLine = line;
      break;
    }
  }
}
if (!rowLine) throw new Error(`备份里找不到 id=${TARGET_ID} 的日报`);

/** 反转义 PostgreSQL COPY 文本格式 */
function unescapeCopy(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") {
      out += s[i];
      continue;
    }
    const n = s[i + 1];
    if (n === "n") { out += "\n"; i++; }
    else if (n === "t") { out += "\t"; i++; }
    else if (n === "r") { out += "\r"; i++; }
    else if (n === "\\") { out += "\\"; i++; }
    else { out += n; i++; }
  }
  return out;
}

const cells = rowLine.split("\t").map((c) => (c === "\\N" ? null : unescapeCopy(c)));
const row: Record<string, string | null> = {};
cols.forEach((c, i) => (row[c] = cells[i] ?? null));

console.log(`备份中的日报: id=${row.id} date=${row.report_date} markdown 长度=${row.report_markdown?.length}`);

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_WRITE_USER ?? "ai_intel_writer",
  password: process.env.DB_WRITE_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false,
});
await client.connect();

const cur = await client.query(
  `SELECT length(report_markdown) len, generated_at::text FROM daily_reports WHERE id=$1`,
  [TARGET_ID]
);
console.log(`数据库当前: markdown 长度=${cur.rows[0]?.len} generated_at=${cur.rows[0]?.generated_at}`);

if (!APPLY) {
  console.log("\n（预演模式，未写库。加 --apply 执行）");
  await client.end();
  process.exit(0);
}

await client.query("BEGIN");
try {
  await client.query(
    `UPDATE daily_reports
     SET title=$2, report_markdown=$3, report_html=$4, generated_at=$5::timestamptz,
         total_articles=$6::int, headline_count=$7::int, status=$8, validation=$9::jsonb
     WHERE id=$1`,
    [
      TARGET_ID,
      row.title,
      row.report_markdown,
      row.report_html,
      row.generated_at,
      row.total_articles,
      row.headline_count,
      row.status,
      row.validation,
    ]
  );
  await client.query("COMMIT");
  console.log("已恢复");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
}

const after = await client.query(
  `SELECT length(report_markdown) len, headline_count, status FROM daily_reports WHERE id=$1`,
  [TARGET_ID]
);
console.log("恢复后:", JSON.stringify(after.rows[0]));
await client.end();
