// 阶段 D 辅助：验证跨批次语义去重是否真的拦住「同义改写」
// 用法：node --env-file=.env.local --import tsx scripts/phase2-verify-crossdup.mts
//
// 关键：历史池必须排除候选自己，否则会命中「标题完全一致」造成假阳性。
import { readFileSync } from "node:fs";
import { Client } from "pg";

const nodes = JSON.parse(readFileSync("/tmp/n8n-verify/nodes-v6.json", "utf8")) as any[];
const code = nodes.find((n) => n.name === "商机去重").parameters.jsCode;

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false,
});
await client.connect();
const histRes = await client.query(
  `SELECT id::int AS id, title, description, notes, status, action_plan FROM opportunities ORDER BY id`
);
const all = histRes.rows;
await client.end();

// 4 次执行各自插入的那一条，逐一验证：把它从历史里剔除后，
// 去重器能不能认出它和已有记录是同一件事。
const cliIds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const targets = cliIds.length > 0 ? cliIds : [117, 118, 119, 120];

for (const tid of targets) {
  const cand = all.find((r) => r.id === tid);
  if (!cand) continue;
  const history = all.filter((r) => r.id !== tid);

  const items = history.map((h) => ({ json: h }));
  const $input = { all: () => items, first: () => items[0] };
  const $ = (_n: string) => ({
    all: () => [{ json: { title: cand.title, description: cand.description, report_date: "2026-11-06" } }],
    first: () => ({ json: { title: cand.title, description: cand.description, report_date: "2026-11-06" } }),
  });
  const fn = new Function("$input", "$json", "$", `return (async () => { ${code}\n })();`);
  const out = await fn($input, items[0].json, $);
  const j = out[0].json;
  console.log(`#${tid} ${String(cand.title).slice(0, 36)}`);
  console.log(`   → action=${j.action}  reason=${String(j.match_reason).slice(0, 70)}`);
  if (j.action === "insert") console.log(`   ✗ 漏判：本应识别为重复`);
}
