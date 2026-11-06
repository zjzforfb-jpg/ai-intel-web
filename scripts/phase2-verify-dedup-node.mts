// 阶段 D 辅助：单独跑「商机去重」/「选题去重」节点代码，用真实库数据看判定结果
// 用法：node --env-file=.env.local --import tsx scripts/phase2-verify-dedup-node.mts
import { readFileSync } from "node:fs";
import { Client } from "pg";

const nodes = JSON.parse(readFileSync("/tmp/n8n-verify/nodes-v6.json", "utf8")) as any[];

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: false,
});
await client.connect();

// 库里的历史商机
const histRes = await client.query(
  `SELECT id::int AS id, title, description, notes, status, action_plan FROM opportunities ORDER BY id`
);
const history = histRes.rows;

// 本轮真实产出但被判为「不重复」的 4 条（117-120），验证去重能不能把它们合并
const candidates = [
  { title: "为小团队提供 AI 编码 CLI 外发审计与脱敏代理", description: "为使用 AI 编码 CLI 的小团队提供本地出站请求审计与脱敏代理服务，拦截并脱敏发往外部站点的敏感信息。", report_date: "2026-11-06" },
  { title: "为编码与浏览器Agent做本地出站请求审计和脱敏网关", description: "面向编码 Agent 和浏览器 Agent 提供一个本地网关，对所有出站请求做审计与脱敏处理，防止敏感数据外泄。", report_date: "2026-11-06" },
  { title: "为编码和浏览器 Agent 提供网络请求脱敏与审计网关", description: "给编码类和浏览器类 Agent 提供网络请求的脱敏与审计网关，统一管控外发流量。", report_date: "2026-11-06" },
  { title: "为AI编码/浏览Agent做本地出站请求脱敏与审计网关", description: "为 AI 编码与浏览 Agent 构建本地出站请求的脱敏与审计网关，守护数据出口。", report_date: "2026-11-06" },
];

const code = nodes.find((n) => n.name === "商机去重").parameters.jsCode;

const items = history.map((h) => ({ json: h }));
const $input = { all: () => items, first: () => items[0] };
const $ = (name: string) => {
  if (name === "商机清洗") return { all: () => candidates.map((c) => ({ json: c })), first: () => ({ json: candidates[0] }) };
  throw new Error("未预期的节点引用: " + name);
};
const fn = new Function("$input", "$json", "$", `return (async () => { ${code}\n })();`);
const out = await fn($input, items[0].json, $);
console.log(`历史 ${history.length} 条，候选 ${candidates.length} 条\n`);
for (const o of out) {
  const j = o.json;
  console.log(`[${j.action}] ${String(j.title).slice(0, 40)}`);
  console.log(`     matched_id=${j.matched_id} score=${j.match_score} reason=${String(j.match_reason).slice(0, 80)}`);
}

await client.end();
