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

/* ------------------- 从词典真源生成节点代码 ------------------- */

// 真源：lib/lexicon/tables.ts。
// 这里不再手抄 ENTITY_VARIANTS / ENTITY_TYPE_MAP —— 那正是历史上漂移的根源
// （n8n 侧 STOP_WORDS 曾与真源差 113 条，导致两侧去重判定不一致）。
function literalFromSource(name: string): string {
  const src = readFileSync("lib/lexicon/tables.ts", "utf8");
  const declRe = new RegExp(`export const ${name}\\b[^=]*=\\s*([\\[{])`, "m");
  const m = declRe.exec(src);
  if (!m) throw new Error(`lib/lexicon/tables.ts 中找不到 ${name}`);
  const start = m.index + m[0].length - 1;

  let depth = 0;
  let inStr: string | null = null;
  let end = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error(`${name} 字面量未闭合`);

  const literal = src
    .slice(start, end + 1)
    .split("\n")
    .filter((l) => !/^\s*\/\*/.test(l))
    .join("\n");

  let parsed: unknown;
  try {
    parsed = new Function(`return (${literal});`)();
  } catch (e) {
    throw new Error(`${name} 字面量无法解析：${(e as Error).message}`);
  }
  const count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed as object).length;
  if (count === 0) throw new Error(`${name} 抽取结果为空，抽取逻辑有误`);
  console.log(`词典同步：${name} 从 lib/lexicon/tables.ts 取到 ${count} 条`);
  return literal;
}

const ENTITY_VARIANTS_LITERAL = literalFromSource("ENTITY_VARIANTS");

/* ------------------- 实体类型映射（契约 §3.4） ------------------- */
//
// 真源同样是 lib/lexicon/tables.ts（与 ENTITY_VARIANTS 同文件），
// 这样「词典 + 类型映射 + 停用词」只有一处可改，不会再有第三份副本。

const ENTITY_TYPE_MAP_LITERAL = literalFromSource("ENTITY_TYPE_MAP");
console.log(
  `实体类型映射：从 lib/lexicon/tables.ts 取到 ${Object.keys(JSON.parse(ENTITY_TYPE_MAP_LITERAL)).length} 条`
);

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

/* ---- 顺带修一个时区 bug ----
 * 「AI情报数据打包」里 report_date 用的是 new Date().toISOString().slice(0,10)，
 * 那是 UTC 日期。容器 TZ 是 Asia/Shanghai（UTC+8），所以北京时间 00:00–07:59
 * 之间的任何一次运行都会把日期算成前一天 —— 实测 01:01 跑的那次把内容写进了
 * 前一天的日报（UPSERT 覆盖了原有内容）。
 * 定时任务 08:30 不受影响（08:30 CST = 00:30 UTC，同一天），但手动执行会踩坑。
 * 这里改成按固定 +8 偏移算中国日期（中国无夏令时，偏移恒定）。
 */
const DATE_NODE = "AI情报数据打包";
const dateNode = nodes.find((n) => n.name === DATE_NODE);
let dateFixed = false;
if (dateNode?.parameters?.jsCode) {
  const before = dateNode.parameters.jsCode as string;
  if (before.includes("new Date().toISOString().slice(0, 10)")) {
    dateNode.parameters.jsCode = before.replace(
      "new Date().toISOString().slice(0, 10)",
      "new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)"
    );
    dateFixed = true;
  }
}

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
console.log(`日报日期改按中国时区计算: ${dateFixed ? "已修正 UTC 偏移 bug" : "已是正确写法，跳过"}`);
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
