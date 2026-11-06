// 对比 TS 侧 lib/dedup.ts 与 n8n 移植版在同一批真实数据上的判定差异
// 用法：node --env-file=.env.local --import tsx scripts/phase2-compare-dedup.mts
import { isDuplicate } from "../lib/dedup.js";
import { Client } from "pg";

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false,
});
await client.connect();
const res = await client.query(
  `SELECT id::int AS id, title, description, notes, status, action_plan FROM opportunities ORDER BY id`
);
await client.end();
const all = res.rows;

for (const tid of [117, 118, 119, 120]) {
  const cand = all.find((r) => r.id === tid);
  if (!cand) continue;
  const history = all
    .filter((r) => r.id !== tid)
    .map((h) => ({ id: h.id, title: h.title, description: h.description }));
  const r = isDuplicate({ title: cand.title, description: cand.description }, history);
  console.log(`#${tid} ${String(cand.title).slice(0, 34)}`);
  console.log(`   TS 判定=${r.duplicate} score=${r.score?.toFixed?.(3) ?? r.score}`);
  console.log(`   ${String(r.explanation).slice(0, 160)}`);
}
