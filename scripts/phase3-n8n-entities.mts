#!/usr/bin/env node
// 阶段 3 · n8n 实体抽取挂载脚本
//
// 设计原则（对应 docs/phase3-stageB-interface.md §3 与 §8.3）：
//   1. 只「加」节点，不改任何既有节点的参数与连接 —— 36 节点工作流已有
//      选题/商机两条链路，任何重构都可能连带破坏，代价远大于收益。
//   2. 实体抽取挂在「取日报正文」的并行分支上：
//      该节点输出 { report_date, report_markdown }，正是抽取需要的全部输入，
//      且此时日报已成功落库，实体失败也不会回滚日报。
//   3. 抽取纯规则、零 LLM、确定性，保证可测试、可幂等。
//   4. 写入用单条 CTE SQL 完成 entity upsert + mention upsert，天然原子。
//
// 用法：
//   node --import tsx scripts/phase3-n8n-entities.mts inspect   # 只看改动
//   node --import tsx scripts/phase3-n8n-entities.mts apply     # 写库并发布
//
// 前提：n8n-radar 容器已停止，/tmp/n8n-edit/database.sqlite 是最新快照。

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const DB_DIR = "/tmp/n8n-edit";
const WF_ID = "ZtIAVVtWmcPLXywX";
const ANCHOR_NODE = "取日报正文";
const EXTRACT_NODE = "实体抽取";
const WRITE_NODE = "实体写入";

const mode = process.argv[2] ?? "inspect";

/* ---------------------------- 工具 ---------------------------- */

function sh(cmd: string, input?: string): string {
  return execSync(cmd, {
    encoding: "utf-8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    input,
  }).trim();
}

function sqlite(sql: string): string {
  return sh(`cd ${DB_DIR} && sqlite3 database.sqlite`, `${sql}\n`);
}

function sqlLit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/* ---------------------- 从 TS 源同步词典 ---------------------- */

/** 从 lib/normalize.ts 抽出 ENTITY_VARIANTS 数组字面量 */
function extractEntityVariantsLiteral(): string {
  const src = readFileSync("lib/normalize.ts", "utf8");
  const start = src.indexOf("export const ENTITY_VARIANTS");
  if (start === -1) throw new Error("lib/normalize.ts 中找不到 ENTITY_VARIANTS");
  const declEnd = src.indexOf("=", start);
  if (declEnd === -1) throw new Error("ENTITY_VARIANTS 声明缺少赋值");
  const arrStart = src.indexOf("[", declEnd);
  if (arrStart === -1) throw new Error("ENTITY_VARIANTS 不是数组字面量");

  let depth = 0;
  let end = -1;
  let inStr: string | null = null;
  for (let i = arrStart; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error("ENTITY_VARIANTS 数组未闭合");

  const literal = src
    .slice(arrStart, end + 1)
    .split("\n")
    .filter((l) => !/^\s*\/\*/.test(l))
    .join("\n");

  let parsed: unknown;
  try {
    parsed = new Function(`return (${literal});`)();
  } catch (e) {
    throw new Error(`ENTITY_VARIANTS 字面量无法解析：${(e as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("ENTITY_VARIANTS 抽取结果为空数组，抽取逻辑有误");
  }
  console.log(`实体词典同步：从 lib/normalize.ts 取到 ${parsed.length} 条`);
  return literal;
}

const ENTITY_VARIANTS_LITERAL = extractEntityVariantsLiteral();

/* ------------------- 实体类型映射（契约 §3.4） ------------------- */

const ENTITY_TYPE_MAP: Record<string, string> = {
  // company
  openai: "company", anthropic: "company", google: "company", nvidia: "company",
  facebook: "company", microsoft: "company", amazon: "company", apple: "company",
  deepseek: "company", github: "company", "hugging face": "company",
  // ai_product
  gpt: "ai_product", gemini: "ai_product", "cosmos 3": "ai_product",
  "claude code": "ai_product", codex: "ai_product", copilot: "ai_product",
  cursor: "ai_product", sora: "ai_product", midjourney: "ai_product",
  perplexity: "ai_product", openrouter: "ai_product", qwen: "ai_product",
  llama: "ai_product", rivet: "ai_product",
  // technology
  mcp: "technology", langchain: "technology", kubernetes: "technology",
  postgres: "technology", redis: "technology", docker: "technology",
  pii: "technology", "编程agent": "technology",
  // organization
  aws: "organization",
};

const ENTITY_TYPE_MAP_LITERAL = JSON.stringify(ENTITY_TYPE_MAP, null, 2);

/* ---------------------- 实体抽取 Code ---------------------- */

function buildExtractCode(): string {
  // 注意：n8n Code 节点沙箱只允许字符串/正则运算，禁止 Node API。
  // 本段逻辑与 lib/entities-extract.ts（Agent A 实现）必须等价，
  // 差异会导致「App 侧和 n8n 侧抽出不同实体」——那是比不抽更糟的状态。
  return `// 实体抽取（阶段 3）—— 纯规则，零 LLM
// 输入：{ report_date, report_markdown }
// 输出：每条实体提及一个 item
//
// 词典由 scripts/phase3-n8n-entities.mts 从 lib/normalize.ts 自动同步，
// 请勿手工修改下面 ENTITY_VARIANTS —— 要加实体请改 TS 源再重新 apply。

const ENTITY_VARIANTS = ${ENTITY_VARIANTS_LITERAL};

const ENTITY_TYPE_MAP = ${ENTITY_TYPE_MAP_LITERAL};

const src = $json;
const reportDate = src.report_date;
const markdown = String(src.report_markdown || "");
if (!markdown.trim() || !reportDate) return [];

/* ---------- 1. 切章节 ---------- */
// 不用带 (?=...) 的前瞻：\\s*$ 在多行模式下会匹配空串，惰性量词会立刻停下。
const sections = markdown.split(/^##\\s+/m);
let coreSection = "";
let headlineSection = "";
for (const s of sections) {
  if (s.indexOf("一、") === 0) coreSection = s;
  else if (s.indexOf("二、") === 0) headlineSection = s;
}

/* ---------- 2. 切头条块 ---------- */
const headlines = [];
if (headlineSection) {
  const blocks = headlineSection.split(/^###\\s+\\d+[.、．]\\s*/m).slice(1);
  for (const block of blocks) {
    const lines = block.split("\\n");
    const title = String(lines[0] || "").trim();
    if (!title) continue;
    // 原文链接字段：- **原文链接**：url / - **原文链接：** url / - 链接：url
    let url = null;
    const urlRe = /^[ \\t]*(?:[-*•][ \\t]*)?(?:\\*\\*)?[ \\t]*(?:原文链接地址|原文链接|原始链接|链接|网址)[ \\t]*(?:\\*\\*)?[ \\t]*[：:][ \\t]*(?:\\*\\*)?[ \\t]*(\\S+)/m;
    const m = block.match(urlRe);
    if (m && /^https?:\\/\\//i.test(m[1])) url = m[1].replace(/[)）\\],，。]+$/, "");
    headlines.push({ title, url, text: block });
  }
}

/* ---------- 3. 逐实体匹配 ---------- */
// 去掉 markdown 标记，便于取干净的 context
function stripMd(s) {
  return String(s)
    .replace(/^[ \\t]*(?:[-*•][ \\t]*)?/, "")
    .replace(/\\*\\*/g, "")
    .replace(/^#+[ \\t]*/, "")
    .trim();
}

const lowerMd = markdown.toLowerCase();
const lowerCore = coreSection.toLowerCase();

// 统计每个实体在全文中出现的次数
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  let idx = 0;
  while (true) {
    const at = haystack.indexOf(needle, idx);
    if (at === -1) break;
    n += 1;
    idx = at + needle.length;
  }
  return n;
}

const out = [];
for (const entity of ENTITY_VARIANTS) {
  const variants = [entity.canonical].concat(entity.variants || []);
  const seen = new Set();
  const hits = [];
  for (const v of variants) {
    const lv = String(v).toLowerCase().trim();
    if (!lv || seen.has(lv)) continue;
    seen.add(lv);
    if (lowerMd.indexOf(lv) !== -1) hits.push(lv);
  }
  if (hits.length === 0) continue;

  // 定位来源头条：挑「最能代表该实体」的一条作为来源
  //   优先选实体出现在标题里的头条（信号最强），否则取第一个出现的
  // 注意：幂等键是 (entity_id, report_id)，一篇日报里一个实体只产出一条 mention。
  // 之所以不再按头条拆多条：日报重跑时 LLM 会重写标题，按标题拆会导致提及不断累积。
  const hitHeadlines = headlines.filter((h) => {
    const lt = h.text.toLowerCase();
    return hits.some((v) => lt.indexOf(v) !== -1);
  });

  // 一条头条都定位不到 → 说明实体只出现在目录/页脚等噪声里，丢弃
  if (hitHeadlines.length === 0) continue;

  const inTitle = hitHeadlines.filter((h) =>
    hits.some((v) => h.title.toLowerCase().indexOf(v) !== -1)
  );
  const source = inTitle.length > 0 ? inTitle[0] : hitHeadlines[0];

  // importance：基础 1；头条标题出现 +4；核心判断出现 +3；全文 >=3 次 +2，>=6 次再 +1
  let score = 1;
  if (inTitle.length > 0) score += 4;
  if (hits.some((v) => lowerCore.indexOf(v) !== -1)) score += 3;
  let occ = 0;
  for (const v of hits) occ += countOccurrences(lowerMd, v);
  if (occ >= 3) score += 2;
  if (occ >= 6) score += 1;
  if (score > 10) score = 10;

  // context：该头条里实体所在的那一行原文
  let context = "";
  for (const line of String(source.text || "").split("\\n")) {
    const ll = line.toLowerCase();
    if (hits.some((v) => ll.indexOf(v) !== -1)) { context = stripMd(line); break; }
  }
  if (!context) context = stripMd(source.title);
  if (context.length > 200) context = context.slice(0, 200);

  out.push({
    json: {
      name: entity.canonical,
      normalized_name: String(entity.canonical).toLowerCase().replace(/\\s+/g, ""),
      entity_type: ENTITY_TYPE_MAP[entity.canonical] || "unknown",
      aliases: hits,
      report_date: reportDate,
      source_title: source.title,
      source_url: source.url,
      context: context,
      importance_score: score
    }
  });
}

return out;
`;
}

/* ---------------------- 实体写入 SQL ---------------------- */

// 单条 CTE：先 upsert 实体，再用其 id 写 mention。
// aliases 以 JSON 数组传入再转 text[]，避免 n8n 参数绑定对数组类型的兼容问题。
// 冲突键是 (entity_id, report_id)：重跑同一篇日报时覆盖该条提及，而不是追加。
const WRITE_SQL = `WITH e AS (
  INSERT INTO entities (name, normalized_name, entity_type, aliases)
  VALUES ($1, $2, $3, ARRAY(SELECT jsonb_array_elements_text($4::jsonb)))
  ON CONFLICT (normalized_name) DO UPDATE SET updated_at = NOW()
  RETURNING id
)
INSERT INTO entity_mentions
  (entity_id, report_id, mention_date, source_title, source_url, context, importance_score)
SELECT
  e.id,
  (SELECT id FROM daily_reports WHERE report_date = $5::date),
  $5::date, $6, $7, $8, $9::smallint
FROM e
ON CONFLICT (entity_id, report_id) DO UPDATE SET
  source_title = EXCLUDED.source_title,
  source_url = EXCLUDED.source_url,
  context = EXCLUDED.context,
  importance_score = EXCLUDED.importance_score`;

const WRITE_PARAMS =
  "={{ [ $json.name, $json.normalized_name, $json.entity_type, JSON.stringify($json.aliases), $json.report_date, $json.source_title, $json.source_url, $json.context, $json.importance_score ] }}";

/* ---------------------- 主流程 ---------------------- */

// 读当前工作流
const wfRaw = sh(
  `cd ${DB_DIR} && sqlite3 -json database.sqlite "SELECT nodes, connections, versionId, activeVersionId FROM workflow_entity WHERE id='${WF_ID}';"`
);
const wf = JSON.parse(wfRaw)[0] as {
  nodes: string; connections: string; versionId: string; activeVersionId: string;
};
const nodes = JSON.parse(wf.nodes) as any[];
const connections = JSON.parse(wf.connections) as Record<string, any>;

const anchor = nodes.find((n) => n.name === ANCHOR_NODE);
if (!anchor) throw new Error(`找不到锚点节点「${ANCHOR_NODE}」`);

// 幂等：已挂过就直接更新内容，不重复加节点
const alreadyHas = nodes.some((n) => n.name === EXTRACT_NODE);

// 复用既有 postgres 节点的凭据配置，避免手写 credentials 出错
const pgTemplate = nodes.find((n) => n.type === "n8n-nodes-base.postgres");
if (!pgTemplate) throw new Error("工作流里没有可复用的 postgres 节点");
const codeTemplate = nodes.find((n) => n.type === "n8n-nodes-base.code");
if (!codeTemplate) throw new Error("工作流里没有可复用的 code 节点");

const extractNode: any = {
  parameters: { jsCode: buildExtractCode() },
  type: "n8n-nodes-base.code",
  typeVersion: codeTemplate.typeVersion,
  position: [anchor.position[0] + 220, anchor.position[1] + 260],
  id: randomUUID(),
  name: EXTRACT_NODE,
  // 抽取失败不能拖垮日报主流程
  onError: "continueRegularOutput",
  notes: "阶段3：纯规则实体抽取，零 LLM",
};

const writeNode: any = {
  parameters: {
    operation: "executeQuery",
    query: WRITE_SQL,
    options: { queryReplacement: WRITE_PARAMS },
  },
  type: "n8n-nodes-base.postgres",
  typeVersion: pgTemplate.typeVersion,
  position: [extractNode.position[0] + 220, extractNode.position[1]],
  id: randomUUID(),
  name: WRITE_NODE,
  credentials: pgTemplate.credentials ? JSON.parse(JSON.stringify(pgTemplate.credentials)) : undefined,
  onError: "continueRegularOutput",
  notes: "阶段3：entity upsert + mention upsert（单条 CTE，幂等）",
};

if (alreadyHas) {
  const i = nodes.findIndex((n) => n.name === EXTRACT_NODE);
  extractNode.id = nodes[i].id;
  extractNode.position = nodes[i].position;
  nodes[i] = extractNode;
  const j = nodes.findIndex((n) => n.name === WRITE_NODE);
  if (j >= 0) {
    writeNode.id = nodes[j].id;
    writeNode.position = nodes[j].position;
    nodes[j] = writeNode;
  } else {
    nodes.push(writeNode);
  }
  console.log("已存在实体节点，做原地更新（幂等）");
} else {
  nodes.push(extractNode, writeNode);
}

// 连接：取日报正文 → 实体抽取 → 实体写入（与选题/商机并列，互不影响）
connections[ANCHOR_NODE] = connections[ANCHOR_NODE] || { main: [[]] };
const anchorOut = connections[ANCHOR_NODE].main[0] || [];
const hasLink = anchorOut.some((c: any) => c.node === EXTRACT_NODE);
if (!hasLink) {
  anchorOut.push({ node: EXTRACT_NODE, type: "main", index: 0 });
  connections[ANCHOR_NODE].main[0] = anchorOut;
}
connections[EXTRACT_NODE] = { main: [[{ node: WRITE_NODE, type: "main", index: 0 }]] };

console.log(`\n=== 改造摘要 ===`);
console.log(`锚点节点: ${ANCHOR_NODE}`);
console.log(`新增/更新: ${EXTRACT_NODE}（Code）, ${WRITE_NODE}（Postgres）`);
console.log(`节点总数: ${nodes.length}`);
console.log(`取日报正文 输出: ${connections[ANCHOR_NODE].main[0].map((c: any) => c.node).join(", ")}`);

// 连通性自检：所有连接引用的节点都必须存在
const allNames = new Set(nodes.map((n) => n.name));
const missing: string[] = [];
for (const [from, cfg] of Object.entries(connections)) {
  if (!allNames.has(from)) missing.push(`输出节点缺失: ${from}`);
  for (const branch of (cfg as any).main || []) {
    for (const c of branch || []) if (!allNames.has(c.node)) missing.push(`${from} → ${c.node}`);
  }
}
if (missing.length) throw new Error(`连通性自检失败:\n${missing.join("\n")}`);
console.log("连通性自检: 通过");

if (mode !== "apply") {
  // inspect 模式把生成的 Code 节点源码落盘，便于写库前先做语法与结果验证
  const dumpPath = "/tmp/n8n-verify/entity-extract.js";
  try {
    writeFileSync(dumpPath, buildExtractCode(), "utf8");
    console.log(`\n实体抽取 Code 已导出: ${dumpPath}`);
  } catch {
    console.log("\n（未能导出 Code 到 /tmp，可忽略）");
  }
  console.log("\n（inspect 模式，未写库。加 apply 执行）");
  process.exit(0);
}

/* ---------------------- 写库并发布 ---------------------- */

const newVersion = randomUUID();
const now = new Date().toISOString();

sqlite(`PRAGMA wal_checkpoint(TRUNCATE);`);

sqlite(`
INSERT INTO workflow_history
  (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description, nodeGroups)
SELECT
  '${newVersion}', workflowId, authors, ${sqlLit(now)}, ${sqlLit(now)},
  ${sqlLit(JSON.stringify(nodes))}, ${sqlLit(JSON.stringify(connections))},
  'Version ${newVersion.slice(0, 8)}', autosaved, description, nodeGroups
FROM workflow_history WHERE versionId='${wf.activeVersionId}' LIMIT 1;
`);

// 关键：实体表 nodes/connections 与 history 必须同步，否则新节点不会执行
sqlite(`
UPDATE workflow_entity
SET versionId='${newVersion}',
    activeVersionId='${newVersion}',
    nodes=${sqlLit(JSON.stringify(nodes))},
    connections=${sqlLit(JSON.stringify(connections))},
    updatedAt=${sqlLit(now)}
WHERE id='${WF_ID}';
`);

sqlite(`
UPDATE workflow_published_version SET publishedVersionId='${newVersion}' WHERE workflowId='${WF_ID}';
`);

const chk = (sql: string) => sqlite(sql);
console.log("\n=== 写库完成 ===");
console.log(`新 versionId: ${newVersion}`);
console.log(`entity.nodes = ${chk(`SELECT json_array_length(nodes) FROM workflow_entity WHERE id='${WF_ID}';`)} 节点`);
console.log(`history.nodes= ${chk(`SELECT json_array_length(nodes) FROM workflow_history WHERE versionId='${newVersion}';`)} 节点`);
console.log(`published    = ${chk(`SELECT publishedVersionId FROM workflow_published_version WHERE workflowId='${WF_ID}';`)}`);

const eNodes = chk(`SELECT nodes FROM workflow_entity WHERE id='${WF_ID}';`);
const hNodes = chk(`SELECT nodes FROM workflow_history WHERE versionId='${newVersion}';`);
const eConns = chk(`SELECT connections FROM workflow_entity WHERE id='${WF_ID}';`);
const hConns = chk(`SELECT connections FROM workflow_history WHERE versionId='${newVersion}';`);
if (eNodes !== hNodes || eConns !== hConns) {
  throw new Error("实体表与 workflow_history 不一致，发布中止");
}
console.log("实体表与 history 一致: 是");
console.log(`integrity_check: ${chk("PRAGMA integrity_check;")}`);
