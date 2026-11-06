import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Client } from "pg";

const code = readFileSync("/tmp/n8n-verify/entity-extract.js", "utf8");

// 1) 语法校验（n8n Code 节点是 async 函数体，含顶层 return）
try {
  new vm.Script(`(async function(){ ${code} })`);
  console.log("语法校验: 通过");
} catch (e) {
  console.log("语法校验: 失败 →", (e as Error).message);
  process.exit(1);
}

const c = new Client({host:process.env.DB_HOST,port:+process.env.DB_PORT!,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,ssl:false});
await c.connect();
const r = await c.query(`SELECT report_date::text d, report_markdown FROM daily_reports WHERE report_markdown IS NOT NULL ORDER BY report_date`);
await c.end();

for (const row of r.rows) {
  const ctx: any = { $json: { report_date: row.d, report_markdown: row.report_markdown } };
  vm.createContext(ctx);
  const fn = vm.runInContext(`(async () => { ${code} })`, ctx);
  const out = await fn();
  console.log(`\n${row.d}: 抽出 ${out.length} 个实体提及`);
  for (const o of out) {
    const j = o.json;
    console.log(`  ${String(j.name).padEnd(14)} ${String(j.entity_type).padEnd(12)} score=${j.importance_score} url=${j.source_url ? "有" : "无"} ctx=${String(j.context).slice(0,34)}`);
  }
}
