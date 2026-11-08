#!/usr/bin/env node
// 词典一致性校验 —— 检出「TS 真源 / patch 脚本 / n8n 运行态」三者的漂移
//
// 背景：ENTITY_VARIANTS、STOP_WORDS 等词表需要同时存在于三处，
// 历史上靠手抄维护，已经实际漂移过（n8n 侧 STOP_WORDS 119 条 vs TS 185 条，
// 导致同一个标题在 App 侧与 n8n 侧算出不同关键词集、去重判定不一致）。
//
// 用法：
//   npx tsx scripts/verify/lexicon-drift.mts --source=ts       # 只校验真源自身的结构不变量
//   npx tsx scripts/verify/lexicon-drift.mts --source=script   # 真源 vs 两个 patch 脚本里的硬编码
//   npx tsx scripts/verify/lexicon-drift.mts --source=n8n      # 真源 vs n8n 运行态（activeVersionId）
//   npx tsx scripts/verify/lexicon-drift.mts --source=all      # 全部（默认）
//
// 输出契约：每行 `PASS|FAIL <name> <k=v ...>`，末尾汇总，退出码 0/1。
// 便于 grep 与 CI 判定。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const sourceArg = args.find((a) => a.startsWith("--source="))?.slice("--source=".length) ?? "all";
const asJson = args.includes("--json");

const WF_ID = "ZtIAVVtWmcPLXywX";

/* ==================== 读取 TS 真源 ==================== */

// 直接 import 真源模块，拿到的是运行时值，比字符串扫描可靠
const tables = await import("../../lib/lexicon/tables").then(
  (m) =>
    m as unknown as {
      ENTITY_VARIANTS: Array<{ canonical: string; variants: string[]; related?: string[] }>;
      STOP_WORDS: string[];
      DOMAIN_TERMS: Array<{ term: string; aliases: string[] }>;
      TOPIC_CATEGORIES: Array<{ tag: string; triggers: string[] }>;
      MEANINGLESS_PREFIXES: string[];
      MARKETING_MODIFIERS: string[];
      PREFIX_EXCEPTIONS: Record<string, string[]>;
      WEAK_KEYWORDS: string[];
      ENTITY_TYPE_MAP: Record<string, string>;
    }
);
const {
  ENTITY_VARIANTS,
  STOP_WORDS,
  DOMAIN_TERMS,
  TOPIC_CATEGORIES,
  MEANINGLESS_PREFIXES,
  MARKETING_MODIFIERS,
  PREFIX_EXCEPTIONS,
  WEAK_KEYWORDS,
  ENTITY_TYPE_MAP,
} = tables;

const ENTITY_TYPES = [
  "company",
  "person",
  "ai_product",
  "technology",
  "open_source",
  "organization",
  "unknown",
];

const lines: string[] = [];
let failed = 0;

function pass(name: string, kv: Record<string, string | number> = {}) {
  const body = Object.entries(kv)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  lines.push(`PASS ${name}${body ? " " + body : ""}`);
}
function fail(name: string, kv: Record<string, string | number> = {}) {
  const body = Object.entries(kv)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  lines.push(`FAIL ${name}${body ? " " + body : ""}`);
  failed++;
}

/** 归一化：小写 + 去空白，用于别名冲突判定 */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();

/* ==================== 1. 真源自身结构不变量 ==================== */

function checkStructure() {
  const canonicals = ENTITY_VARIANTS.map((e) => e.canonical);
  const canonicalSet = new Set(canonicals);

  // 1.1 canonical 唯一
  const dup = canonicals.filter((c, i) => canonicals.indexOf(c) !== i);
  if (dup.length === 0) pass("lexicon.structure.canonicalUnique", { canonical: canonicals.length, dup: 0 });
  else fail("lexicon.structure.canonicalUnique", { dup: dup.length, names: dup.join(",") });

  // 1.2 每个条目的 variants 非空且包含 canonical 自身
  const badVariants = ENTITY_VARIANTS.filter(
    (e) => !Array.isArray(e.variants) || e.variants.length === 0
  ).map((e) => e.canonical);
  if (badVariants.length === 0) pass("lexicon.structure.variantsNonEmpty");
  else fail("lexicon.structure.variantsNonEmpty", { bad: badVariants.join(",") });

  const missingSelf = ENTITY_VARIANTS.filter((e) => {
    const self = norm(e.canonical);
    return !e.variants.some((v) => norm(v) === self);
  }).map((e) => e.canonical);
  if (missingSelf.length === 0) pass("lexicon.structure.variantCoversCanonical");
  else fail("lexicon.structure.variantCoversCanonical", { missing: missingSelf.join(",") });

  // 1.3 归一化后不应有同一个别名指向两个不同 canonical
  const owner = new Map<string, string>();
  const conflicts: string[] = [];
  for (const e of ENTITY_VARIANTS) {
    for (const v of [e.canonical, ...e.variants]) {
      const k = norm(v);
      if (!k) continue;
      const prev = owner.get(k);
      if (prev && prev !== e.canonical) conflicts.push(`${k}(${prev}/${e.canonical})`);
      else owner.set(k, e.canonical);
    }
  }
  if (conflicts.length === 0) pass("lexicon.structure.aliasConflictFree", { aliases: owner.size });
  else fail("lexicon.structure.aliasConflictFree", { conflicts: conflicts.length, sample: conflicts.slice(0, 3).join(",") });

  // 1.4 related 闭包：每个 related 都能在 canonical 集合里找到
  const dangling: string[] = [];
  for (const e of ENTITY_VARIANTS) {
    for (const r of e.related ?? []) {
      if (!canonicalSet.has(r)) dangling.push(`${e.canonical}->${r}`);
    }
  }
  if (dangling.length === 0) pass("lexicon.structure.relatedClosure", { canonical: canonicalSet.size });
  else fail("lexicon.structure.relatedClosure", { dangling: dangling.length, sample: dangling.slice(0, 3).join(",") });

  // 1.5 ENTITY_TYPE_MAP 覆盖全部 canonical（真源里的映射表，运行时值）
  const mappedKeys = Object.keys(ENTITY_TYPE_MAP);
  const uncovered = canonicals.filter((c) => !mappedKeys.includes(c));
  const unknownType = mappedKeys.filter((k) => !canonicalSet.has(k));
  if (uncovered.length === 0 && unknownType.length === 0) {
    pass("lexicon.structure.typeMapCoverage", { covered: `${mappedKeys.length}/${canonicals.length}` });
  } else {
    fail("lexicon.structure.typeMapCoverage", {
      uncovered: uncovered.length,
      unknownKey: unknownType.length,
      sample: [...uncovered, ...unknownType].slice(0, 3).join(","),
    });
  }

  // 1.5b 映射值是合法枚举
  const badType = Object.entries(ENTITY_TYPE_MAP)
    .filter(([, v]) => !ENTITY_TYPES.includes(v))
    .map(([k, v]) => `${k}=${v}`);
  if (badType.length === 0) pass("lexicon.structure.typeMapValues");
  else fail("lexicon.structure.typeMapValues", { bad: badType.length, sample: badType.slice(0, 3).join(",") });

  // 1.6 各表规模（作为信息输出，便于发现意外增减）
  pass("lexicon.structure.sizes", {
    entities: ENTITY_VARIANTS.length,
    stopWords: STOP_WORDS.length,
    domainTerms: DOMAIN_TERMS.length,
    topics: TOPIC_CATEGORIES.length,
    weak: WEAK_KEYWORDS.length,
    prefixes: MEANINGLESS_PREFIXES.length,
    modifiers: MARKETING_MODIFIERS.length,
    exceptions: Object.keys(PREFIX_EXCEPTIONS).length,
  });
}

/* ==================== 2. 真源 vs 两个 patch 脚本 ==================== */

/** 从源码里抽出 `const NAME = [...]` 或 `= {...}` 并求值 */
function evalLiteralFrom(src: string, name: string): unknown {
  const re = new RegExp(`const ${name}\\b[^=]*=\\s*([\\[{])`, "m");
  const m = re.exec(src);
  if (!m) return undefined;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let inStr: string | null = null;
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
      if (depth === 0) {
        const lit = src.slice(start, i + 1);
        try {
          return new Function(`return (${lit});`)();
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function checkScripts() {
  const phase2 = existsSync("scripts/phase2-n8n-patch.mts")
    ? readFileSync("scripts/phase2-n8n-patch.mts", "utf8")
    : null;
  const phase3 = existsSync("scripts/phase3-n8n-entities.mts")
    ? readFileSync("scripts/phase3-n8n-entities.mts", "utf8")
    : null;

  if (!phase2 || !phase3) {
    fail("lexicon.script.exists", {
      phase2: String(Boolean(phase2)),
      phase3: String(Boolean(phase3)),
    });
    return;
  }

  // 2.1 两个脚本都从 lib/lexicon/tables.ts 取，而不是硬编码
  const hardcoded: string[] = [];
  for (const [label, src] of [["phase2", phase2], ["phase3", phase3]] as const) {
    for (const name of ["STOP_WORDS", "ENTITY_VARIANTS", "DOMAIN_TERMS"]) {
      if (new RegExp(`^const ${name}\\s*(:|=)\\s*\\[`, "m").test(src)) {
        hardcoded.push(`${label}.${name}`);
      }
    }
  }
  if (hardcoded.length === 0) pass("lexicon.script.noHardcodedTable");
  else fail("lexicon.script.noHardcodedTable", { hardcoded: hardcoded.join(",") });

  // 2.2 脚本里若仍有硬编码，其内容必须与真源一致（为过渡期保留的检查）
  const issues: string[] = [];
  for (const [label, src] of [["phase2", phase2], ["phase3", phase3]] as const) {
    const stop = evalLiteralFrom(src, "STOP_WORDS");
    if (Array.isArray(stop)) {
      const onlyTs = STOP_WORDS.filter((w) => !stop.includes(w)).length;
      const onlyScript = stop.filter((w: string) => !STOP_WORDS.includes(w)).length;
      if (onlyTs || onlyScript) issues.push(`${label}.STOP_WORDS(onlyTs=${onlyTs},onlyScript=${onlyScript})`);
    }
    const ents = evalLiteralFrom(src, "ENTITY_VARIANTS");
    if (Array.isArray(ents)) {
      const a = JSON.stringify(ENTITY_VARIANTS);
      const b = JSON.stringify(ents);
      if (a !== b) issues.push(`${label}.ENTITY_VARIANTS(diff)`);
    }
  }
  if (issues.length === 0) pass("lexicon.script.contentMatchesSource");
  else fail("lexicon.script.contentMatchesSource", { issues: issues.join(",") });
}

/* ==================== 3. 真源 vs n8n 运行态 ==================== */

function n8nSqlite(code: string): string {
  // 用 base64 传代码，避免引号/反引号/$ 在多层 shell 转义里被吃掉
  const b64 = Buffer.from(code, "utf8").toString("base64");
  const wrapper = `eval(Buffer.from('${b64}','base64').toString('utf8'))`;
  return execSync(`docker exec n8n-radar node -e ${JSON.stringify(wrapper)}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function checkN8n() {
  // 取「运行态」的节点代码：必须是 activeVersionId 指向的版本，
  // 不是 workflow_entity.nodes（那是 draft，改了但没 publish 时定时任务仍跑旧版）
  const raw = n8nSqlite(`
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});
    const w=db.prepare('select versionId,activeVersionId from workflow_entity where id=?').get('${WF_ID}');
    const avail=JSON.parse(db.prepare('select nodes from workflow_history where versionId=?').get(w.activeVersionId).nodes);
    const draft=JSON.parse(db.prepare('select nodes from workflow_entity where id=?').get('${WF_ID}').nodes);
    const pick=(nodes,name)=>{const n=nodes.find(x=>x.name===name);return n?JSON.stringify(n.parameters||{}):null};
    console.log(JSON.stringify({
      draftVersionId:w.versionId, activeVersionId:w.activeVersionId,
      sameVersion:String(w.versionId===w.activeVersionId),
      draftCount:draft.length, activeCount:avail.length,
      extract:pick(avail,'实体抽取'),
      dedup:pick(avail,'选题去重'),
      oppDedup:pick(avail,'商机去重')
    }));
  `);

  let info: {
    draftVersionId: string;
    activeVersionId: string;
    sameVersion: string;
    draftCount: number;
    activeCount: number;
    extract: string | null;
    dedup: string | null;
    oppDedup: string | null;
  };
  try {
    info = JSON.parse(raw);
  } catch {
    fail("lexicon.n8n.read", { raw: raw.slice(0, 120) });
    return;
  }

  // 3.1 draft 与 published 必须同版本（否则定时任务跑的是旧代码）
  if (info.sameVersion === "true") {
    pass("lexicon.n8n.versionConsistent", { version: info.activeVersionId.slice(0, 8), nodes: info.activeCount });
  } else {
    fail("lexicon.n8n.versionConsistent", {
      draft: info.draftVersionId.slice(0, 8),
      active: info.activeVersionId.slice(0, 8),
      hint: "改了 draft 未 publish，定时任务仍跑旧版",
    });
  }

  // 3.2 实体抽取节点里的 ENTITY_VARIANTS 必须与真源逐字一致
  const extractCode = info.extract ? JSON.parse(info.extract)?.jsCode ?? "" : "";
  const n8nEntities = evalLiteralFrom(extractCode, "ENTITY_VARIANTS");
  if (!Array.isArray(n8nEntities)) {
    fail("lexicon.n8n.entities", { reason: "实体抽取节点里找不到 ENTITY_VARIANTS" });
  } else if (JSON.stringify(n8nEntities) === JSON.stringify(ENTITY_VARIANTS)) {
    pass("lexicon.n8n.entities", { entities: n8nEntities.length, onlyTs: 0, onlyN8n: 0 });
  } else {
    const n8nNames = new Set((n8nEntities as Array<{ canonical: string }>).map((e) => e.canonical));
    const tsNames = new Set(ENTITY_VARIANTS.map((e) => e.canonical));
    const onlyTs = [...tsNames].filter((n) => !n8nNames.has(n)).length;
    const onlyN8n = [...n8nNames].filter((n) => !tsNames.has(n)).length;
    fail("lexicon.n8n.entities", { ts: tsNames.size, n8n: n8nNames.size, onlyTs, onlyN8n });
  }

  // 3.3 两个去重节点里的 STOP_WORDS 必须与真源一致
  for (const [label, code] of [
    ["选题去重", info.dedup],
    ["商机去重", info.oppDedup],
  ] as const) {
    const js = code ? JSON.parse(code)?.jsCode ?? "" : "";
    const n8nStop = evalLiteralFrom(js, "STOP_WORDS");
    if (!Array.isArray(n8nStop)) {
      // phase2 的 NORMALIZE_JS 里可能不叫 STOP_WORDS，单独报告而不是直接判失败
      fail("lexicon.n8n.stopWords", { node: label, reason: "找不到 STOP_WORDS 字面量" });
      continue;
    }
    const onlyTs = STOP_WORDS.filter((w) => !(n8nStop as string[]).includes(w)).length;
    const onlyN8n = (n8nStop as string[]).filter((w) => !STOP_WORDS.includes(w)).length;
    if (onlyTs === 0 && onlyN8n === 0) {
      pass("lexicon.n8n.stopWords", { node: label, stopWords: STOP_WORDS.length, onlyTs: 0, onlyN8n: 0 });
    } else {
      fail("lexicon.n8n.stopWords", {
        node: label,
        ts: STOP_WORDS.length,
        n8n: (n8nStop as string[]).length,
        onlyTs,
        onlyN8n,
      });
    }
  }
}

/* ==================== 主流程 ==================== */

const sources = sourceArg === "all" ? ["ts", "script", "n8n"] : [sourceArg];

for (const s of sources) {
  if (s === "ts") checkStructure();
  else if (s === "script") checkScripts();
  else if (s === "n8n") checkN8n();
  else {
    console.error(`未知 --source=${s}（可选 ts | script | n8n | all）`);
    process.exit(2);
  }
}

if (asJson) {
  console.log(JSON.stringify({ ok: failed === 0, failed, lines }, null, 2));
} else {
  for (const l of lines) console.log(l);
  console.log(`--- ${failed === 0 ? "ALL PASS" : `${failed} FAILED`} (source=${sourceArg}) ---`);
}
process.exit(failed === 0 ? 0 : 1);
