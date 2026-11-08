#!/usr/bin/env node
// n8n 精准更新：词表下发 + UTC 日期兜底修正
//
// 为什么不用 phase2-n8n-patch.mts：
// 那个脚本是「从阶段1的旧版本构建去重链路」的一次性迁移脚本，
// 它按节点名新建 22 个节点并重连。在当前已是 38 节点的版本上重跑，
// 会重复建节点、断掉既有连接。这里只做外科手术式改动：
//   1) 选题去重 / 商机去重 两个 Code 节点的词表字面量 → 换成真源生成的版本
//   2) 格式化数据 / 构建失败记录 两处 UTC 日期兜底 → 改成 +08 口径
// 节点、连接、位置、其余参数一律不动。
//
// 用法：
//   node --import tsx scripts/n8n-apply-lexicon.mts inspect   # 只打印将要做的改动
//   node --import tsx scripts/n8n-apply-lexicon.mts apply     # 写库并发布
//
// 前提：n8n-radar 容器已停止，/tmp/n8n-edit/database.sqlite 是最新快照
//       （node --import tsx scripts/n8n-edit-helper.mts snapshot）

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const DB_DIR = "/tmp/n8n-edit";
const WF_ID = "ZtIAVVtWmcPLXywX";
const SOURCE = "lib/lexicon/tables.ts";

const mode = process.argv[2] ?? "inspect";

/* ---------------------------- 工具 ---------------------------- */

function sqlite(sql: string): string {
  return execSync(`cd ${DB_DIR} && sqlite3 database.sqlite`, {
    encoding: "utf-8",
    input: `${sql}\n`,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function sqlLit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** 从真源抽字面量（字符级括号配平，不能用正则：字符串里也有括号） */
function literalFromSource(name: string): string {
  const src = readFileSync(SOURCE, "utf8");
  const declRe = new RegExp(`export const ${name}\\b[^=]*=\\s*([\\[{])`, "m");
  const m = declRe.exec(src);
  if (!m) throw new Error(`${SOURCE} 中找不到 ${name}`);
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
  if (end === -1) throw new Error(`${name} 未闭合`);

  const literal = src
    .slice(start, end + 1)
    .split("\n")
    .filter((l) => !/^\s*\/\*/.test(l))
    .join("\n");

  const parsed = new Function(`return (${literal});`)() as unknown;
  const count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed as object).length;
  if (count === 0) throw new Error(`${name} 为空`);
  console.log(`  · ${name}: ${count} 条`);
  return literal;
}

/* ---------------------- 读取当前发布版本 ---------------------- */

const activeVersionId = sqlite(
  `SELECT activeVersionId FROM workflow_entity WHERE id='${WF_ID}'`
);
if (!activeVersionId) throw new Error("读不到 activeVersionId，快照是否就绪？");
console.log(`当前发布版本: ${activeVersionId}`);

const nodesJson = sqlite(
  `SELECT nodes FROM workflow_history WHERE versionId='${activeVersionId}'`
);
const connectionsJson = sqlite(
  `SELECT connections FROM workflow_history WHERE versionId='${activeVersionId}'`
);
const nodes = JSON.parse(nodesJson) as Array<{
  name: string;
  parameters?: { jsCode?: string; [k: string]: unknown };
  [k: string]: unknown;
}>;
const connections = JSON.parse(connectionsJson);
console.log(`节点数: ${nodes.length}`);

/* ---------------------- 1. 替换词表字面量 ---------------------- */

console.log("\n[1] 从真源生成词表字面量");
const ENTITY_VARIANTS_LITERAL = literalFromSource("ENTITY_VARIANTS");
const STOP_WORDS_LITERAL = literalFromSource("STOP_WORDS");
const MEANINGLESS_PREFIXES_LITERAL = literalFromSource("MEANINGLESS_PREFIXES");
const MARKETING_MODIFIERS_LITERAL = literalFromSource("MARKETING_MODIFIERS");
const PREFIX_EXCEPTIONS_LITERAL = literalFromSource("PREFIX_EXCEPTIONS");
const TOPIC_CATEGORIES_LITERAL = literalFromSource("TOPIC_CATEGORIES");
const DOMAIN_TERMS_LITERAL = literalFromSource("DOMAIN_TERMS");

/**
 * 把节点代码里指定常量的字面量替换为新版。
 * 用括号配平定位旧字面量，不依赖格式（旧版是压缩成一行的）。
 */
function replaceLiteral(code: string, name: string, newLiteral: string): { code: string; changed: boolean } {
  const re = new RegExp(`(const|let|var)\\s+${name}\\s*=\\s*([\\[{])`, "m");
  const m = re.exec(code);
  if (!m) return { code, changed: false };
  const start = m.index + m[0].length - 1;

  let depth = 0;
  let inStr: string | null = null;
  let end = -1;
  for (let i = start; i < code.length; i++) {
    const ch = code[i];
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
  if (end === -1) return { code, changed: false };

  const oldLiteral = code.slice(start, end + 1);
  if (oldLiteral === newLiteral) return { code, changed: false };
  return { code: code.slice(0, start) + newLiteral + code.slice(end + 1), changed: true };
}

/** 报告某节点里各词表的新旧条数，便于确认改对了 */
function countInLiteral(literal: string): number {
  const parsed = new Function(`return (${literal});`)() as unknown;
  return Array.isArray(parsed) ? parsed.length : Object.keys(parsed as object).length;
}

const TABLES: Array<[string, string]> = [
  ["ENTITY_VARIANTS", ENTITY_VARIANTS_LITERAL],
  ["STOP_WORDS", STOP_WORDS_LITERAL],
  ["MEANINGLESS_PREFIXES", MEANINGLESS_PREFIXES_LITERAL],
  ["MARKETING_MODIFIERS", MARKETING_MODIFIERS_LITERAL],
  ["PREFIX_EXCEPTIONS", PREFIX_EXCEPTIONS_LITERAL],
  ["TOPIC_CATEGORIES", TOPIC_CATEGORIES_LITERAL],
  ["DOMAIN_TERMS", DOMAIN_TERMS_LITERAL],
];

const DEDUP_NODES = ["选题去重", "商机去重"];
let tableChanges = 0;

for (const nodeName of DEDUP_NODES) {
  const node = nodes.find((n) => n.name === nodeName);
  if (!node?.parameters?.jsCode) {
    console.log(`  ⚠ 跳过 ${nodeName}：节点不存在或没有 jsCode`);
    continue;
  }
  let code = node.parameters.jsCode;
  let nodeChanged = 0;
  for (const [name, literal] of TABLES) {
    const before = code;
    const r = replaceLiteral(code, name, literal);
    code = r.code;
    if (r.changed) {
      nodeChanged++;
      console.log(`     ${nodeName}.${name} → ${countInLiteral(literal)} 条`);
    }
    if (before === code && !r.changed) continue;
  }
  if (nodeChanged > 0) {
    node.parameters.jsCode = code;
    tableChanges += nodeChanged;
  } else {
    console.log(`     ${nodeName}: 词表已是最新，无需改动`);
  }
}

/* ---------------------- 2. 修 UTC 日期兜底 ---------------------- */

console.log("\n[2] 修 UTC 日期兜底（北京时间 00:00-07:59 会算成前一天）");

// 统一的上海日期表达式：先取 UTC 毫秒 + 8 小时，再取 ISO 前 10 位。
// 这样任何时刻都得到「北京日历日」，不依赖运行环境的 TZ 设置。
const SHANGHAI_DATE_EXPR = `new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)`;

/** 把节点代码里的 UTC 兜底替换为上海口径 */
function fixUtcDate(code: string): { code: string; hits: number } {
  const patterns = [
    // 形如 new Date().toISOString().slice(0,10)，允许空格差异
    /new Date\(\)\.toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/g,
    /new Date\(\)\.toISOString\(\)\.substring\(\s*0\s*,\s*10\s*\)/g,
  ];
  let hits = 0;
  let out = code;
  for (const p of patterns) {
    out = out.replace(p, () => {
      hits++;
      return SHANGHAI_DATE_EXPR;
    });
  }
  return { code: out, hits };
}

let dateHits = 0;
for (const nodeName of ["格式化数据", "构建失败记录"]) {
  const node = nodes.find((n) => n.name === nodeName);
  if (!node?.parameters?.jsCode) {
    console.log(`  ⚠ 跳过 ${nodeName}：节点不存在或没有 jsCode`);
    continue;
  }
  const r = fixUtcDate(node.parameters.jsCode);
  if (r.hits > 0) {
    node.parameters.jsCode = r.code;
    dateHits += r.hits;
    console.log(`  ✓ ${nodeName}: 替换 ${r.hits} 处 UTC 兜底`);
  } else {
    console.log(`  - ${nodeName}: 已无 UTC 兜底`);
  }
}

/* ---------------------- 汇总 ---------------------- */

const totalChanges = tableChanges + dateHits;
console.log(`\n合计改动：词表 ${tableChanges} 处，日期 ${dateHits} 处`);

if (mode !== "apply") {
  console.log("\n（inspect 模式，未写库。加 apply 生效）");
  process.exit(0);
}

if (totalChanges === 0) {
  console.log("\n没有任何改动，跳过写库。");
  process.exit(0);
}

/* ---------------------- 3. 写库 + 发布 ---------------------- */

const newVersionId = randomUUID();
const nodesStr = JSON.stringify(nodes);
console.log(`\n[3] 写入新版本 ${newVersionId}`);

sqlite(`BEGIN;
INSERT INTO workflow_history (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name)
SELECT '${newVersionId}', workflowId, 'ai-intel-web/improve', datetime('now'), datetime('now'),
       ${sqlLit(nodesStr)}, ${sqlLit(connectionsJson)}, name
FROM workflow_history WHERE versionId='${activeVersionId}';
COMMIT;`);

// 校验新版本确实写进去了，且节点数一致
const written = sqlite(
  `SELECT count(*) FROM workflow_history WHERE versionId='${newVersionId}'`
);
if (written !== "1") throw new Error(`新版本写入失败（history 命中 ${written} 行）`);
const writtenNodes = sqlite(
  `SELECT count(*) FROM json_each((SELECT nodes FROM workflow_history WHERE versionId='${newVersionId}'))`
);
if (Number(writtenNodes) !== nodes.length) {
  throw new Error(`节点数不一致：写入 ${writtenNodes}，期望 ${nodes.length}`);
}
console.log(`  history 已写入，节点数 ${writtenNodes}`);

// 更新 draft（workflow_entity）与发布指针
sqlite(`BEGIN;
UPDATE workflow_entity
   SET nodes=${sqlLit(nodesStr)},
       versionId='${newVersionId}',
       activeVersionId='${newVersionId}',
       updatedAt=datetime('now')
 WHERE id='${WF_ID}';
COMMIT;`);

sqlite(`INSERT INTO workflow_published_version (workflowId, publishedVersionId)
        VALUES ('${WF_ID}', '${newVersionId}')
        ON CONFLICT(workflowId) DO UPDATE SET
          publishedVersionId=excluded.publishedVersionId,
          updatedAt=datetime('now');`);

/* ---------------------- 4. 写后自检 ---------------------- */

const check = JSON.parse(
  sqlite(`SELECT json_object(
    'draft', versionId,
    'active', activeVersionId,
    'draftNodes', (SELECT count(*) FROM json_each(nodes)),
    'activeNodes', (SELECT count(*) FROM json_each((SELECT nodes FROM workflow_history WHERE versionId=activeVersionId)))
  ) FROM workflow_entity WHERE id='${WF_ID}'`)
) as { draft: string; active: string; draftNodes: number; activeNodes: number };

console.log("\n[4] 写后自检");
console.log(`  draft  = ${check.draft}`);
console.log(`  active = ${check.active}`);
console.log(`  节点数 draft=${check.draftNodes} active=${check.activeNodes}`);
if (check.draft !== check.active) throw new Error("draft 与 activeVersionId 不一致！定时任务会跑旧版");
if (Number(check.draftNodes) !== Number(check.activeNodes)) throw new Error("节点数不一致！");

const integrity = sqlite("PRAGMA integrity_check;");
console.log(`  integrity_check = ${integrity}`);
if (integrity !== "ok") throw new Error("integrity_check 未通过");

writeFileSync(
  `${DB_DIR}/applied-version.txt`,
  `new=${newVersionId}\nold=${activeVersionId}\n`,
  "utf8"
);
console.log(`\n✅ 发布完成。回滚命令：`);
console.log(`   node --import tsx scripts/n8n-edit-helper.mts publish ${activeVersionId}`);
