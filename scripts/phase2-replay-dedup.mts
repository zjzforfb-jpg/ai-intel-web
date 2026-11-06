// 阶段 D 辅助：按时间点还原历史池，复现「为什么这一条被插入了」
// 用法：node --env-file=.env.local --import tsx scripts/phase2-replay-dedup.mts <candidateId>
import { readFileSync } from "node:fs";
import { Client } from "pg";

const tid = Number(process.argv[2]);
if (!Number.isFinite(tid)) throw new Error("用法: phase2-replay-dedup.mts <candidateId>");

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
const all = (
  await client.query(
    `SELECT id::int AS id, title, description, notes, status, action_plan, created_at::text AS ca
     FROM opportunities ORDER BY id`
  )
).rows;
await client.end();

const cand = all.find((r) => r.id === tid);
if (!cand) throw new Error(`找不到 #${tid}`);

// 严格还原：只用「候选插入之前」就存在的记录
const before = all.filter((r) => r.id !== tid && r.ca < cand.ca);
console.log(`候选 #${tid} 创建于 ${cand.ca}`);
console.log(`当时历史池：${before.length} 条\n`);

const items = before.map((h) => ({ json: h }));
const $input = { all: () => items, first: () => items[0] };
const $ = (_n: string) => ({ all: () => [{ json: cand }], first: () => ({ json: cand }) });
const fn = new Function("$input", "$json", "$", `return (async () => { ${code}\n })();`);
const out = await fn($input, items[0].json, $);
const j = out[0].json;
console.log(`判定：action=${j.action}`);
console.log(`原因：${String(j.match_reason).slice(0, 160)}`);
console.log(`\n当时最接近的几条：`);
for (const h of before.slice(-6)) console.log(`  #${h.id} ${String(h.title).slice(0, 40)}`);
