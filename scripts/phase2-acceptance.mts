#!/usr/bin/env node
// 阶段 E 验收脚本（主控专用）
// 用法：node --env-file=.env.local --import tsx scripts/phase2-acceptance.ts
//
// 检查项：
//   1. 解析器对两份真实日报样本的解析结果（条目数 + 子字段命中率）
//   2. 语义去重器对真实重复数据的判定（应判重）与反例（不应误判）
//   3. 商机/选题表当前行数与重复情况
//   4. n8n 工作流版本指针状态
//   5. 定时任务状态

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const PG = "docker --context orbstack exec -i n8n-radar-postgres psql -U n8n_radar -d ai_intelligence --no-psqlrc -t -A";

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    return `ERROR: ${(e as Error).message.slice(0, 200)}`;
  }
}

function section(title: string) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

/* ---------- 1. 解析器实测 ---------- */
section("1. 解析器实测（真实日报样本）");

const samples = [
  { file: "/tmp/n8n-audit/report-1105.md", label: "2026-11-05 (DeepSeek 格式)" },
  { file: "/tmp/n8n-audit/report-1106.md", label: "2026-11-06 (MiniMax 格式)" },
];

for (const s of samples) {
  if (!existsSync(s.file)) {
    console.log(`  [跳过] 样本不存在：${s.file}`);
    continue;
  }
  const { parseReport } = await import("../lib/markdown-parser");
  const md = readFileSync(s.file, "utf-8");
  const r = parseReport(md);
  if (!r) {
    console.log(`  ${s.label} → parseReport 返回 null`);
    continue;
  }
  const h = r.headlines;
  const t = r.trends;
  const o = r.opportunities;
  const deepHit = h.filter((x) => x.deepAnalysis).length;
  const linkHit = h.filter((x) => x.link).length;
  const basisHit = t.filter((x) => x.basis).length;
  const srcHit = o.filter((x) => x.source).length;
  console.log(`  ${s.label}`);
  console.log(`    核心判断 ${r.coreJudgments.length} | 头条 ${h.length} | 趋势 ${t.length} | 机会 ${o.length}`);
  console.log(`    头条子字段: 深度解读 ${deepHit}/${h.length} | 原文链接 ${linkHit}/${h.length}`);
  console.log(`    趋势子字段: 判断依据 ${basisHit}/${t.length}`);
  console.log(`    机会子字段: 机会来源 ${srcHit}/${o.length}`);
  if (r.diagnostics) {
    console.log(
      `    diagnostics: 未解析 ${r.diagnostics.unparsed.length} 项, 空章节 ${r.diagnostics.emptySections.length} 个`
    );
  } else {
    console.log("    diagnostics: 未提供");
  }
}

/* ---------- 2. 去重器实测 ---------- */
section("2. 语义去重实测（真实数据）");

try {
  const { isDuplicate } = await import("../lib/dedup");
  const { normalizeText } = await import("../lib/normalize");

  const mustDuplicate: Array<[string, string]> = [
    ["为编码Agent提供网络出口审计与PII脱敏网关", "为AI编程Agent提供网络出口审计与PII脱敏网关"],
    ["为AI编程Agent提供网络出口审计与PII脱敏网关", "为 Claude Code 等编程Agent做本地出站隐私网关与审计层"],
    ["基于Rivet做轻量长任务Agent托管与部署服务", "基于Rivet搭建长周期Agent的托管编排与状态迁移服务"],
    ["用Codex为中小企业业务团队搭建内部小工具", "用代码Agent为中小团队定制垂直内部运营工具"],
    ["Claude Code竟把邮箱发给网站？企业该慌了", "Claude Code会把邮箱发给网站？这份报告仍待确认"],
    ["Facebook被指放任AI深伪广告？160亿美元争议来了", "AI换脸诈骗广告赚160亿？Facebook被指明知故犯"],
    ["英伟达开源世界模型Cosmos 3，机器人训练场要变天？", "NVIDIA发世界模型？Cosmos 3让AI在仿真里学干活"],
    ["谷歌新模型更便宜还更长？内容团队先别急着换", "做视频成本要降？Gemini新模型主打快、便宜、长片段"],
    ["AI Agent不只靠GPU？英伟达突然给CPU加戏", "别只盯GPU了！NVIDIA说Agent落地卡在CPU和内存"],
  ];
  const mustNotDuplicate: Array<[string, string]> = [
    ["用Codex为中小企业业务团队搭建内部小工具", "基于Rivet搭建长周期Agent的托管编排与状态迁移服务"],
    ["长上下文与Agent推理的内存成本优化工具", "为编码Agent提供网络出口审计与PII脱敏网关"],
    ["Gemini低成本长片段API评测工作流", "Cosmos 3 仿真训练平台服务"],
    ["Claude Code 邮箱泄露隐私风险", "Claude Code 编程效率对比评测"],
  ];

  let pass = 0;
  let fail = 0;
  console.log("  —— 必须判为重复 ——");
  for (const [a, b] of mustDuplicate) {
    const res = isDuplicate({ title: a }, [{ title: b }]);
    const ok = res.duplicate === true;
    ok ? pass++ : fail++;
    console.log(`    [${ok ? "PASS" : "FAIL"}] score=${res.score.toFixed(3)} "${a.slice(0, 24)}" vs "${b.slice(0, 24)}"`);
    if (!ok) console.log(`           explanation: ${res.explanation}`);
  }
  console.log("  —— 必须判为不重复 ——");
  for (const [a, b] of mustNotDuplicate) {
    const res = isDuplicate({ title: a }, [{ title: b }]);
    const ok = res.duplicate === false;
    ok ? pass++ : fail++;
    console.log(`    [${ok ? "PASS" : "FAIL"}] score=${res.score.toFixed(3)} "${a.slice(0, 24)}" vs "${b.slice(0, 24)}"`);
    if (!ok) console.log(`           explanation: ${res.explanation}`);
  }
  console.log(`  归一化示例: ${JSON.stringify(normalizeText("重磅！OpenAI 最新发布 GPT-6 深度解读"))}`);
  console.log(`  小计: ${pass} 通过 / ${fail} 失败`);
} catch (e) {
  console.log(`  [跳过] 去重模块尚未就绪：${(e as Error).message}`);
}

/* ---------- 3. 数据现状 ---------- */
section("3. 数据库现状");
console.log(
  "  opportunities:",
  sh(`${PG} -c "SELECT count(*) FROM opportunities;"`) || "N/A",
  "| 待研究:",
  sh(`${PG} -c "SELECT count(*) FROM opportunities WHERE status='待研究';"`) || "N/A",
  "| 已放弃:",
  sh(`${PG} -c "SELECT count(*) FROM opportunities WHERE status='已放弃';"`) || "N/A"
);
console.log(
  "  topic_ideas:",
  sh(`${PG} -c "SELECT count(*) FROM topic_ideas;"`) || "N/A",
  "| 待制作:",
  sh(`${PG} -c "SELECT count(*) FROM topic_ideas WHERE status='待制作';"`) || "N/A",
  "| 已放弃:",
  sh(`${PG} -c "SELECT count(*) FROM topic_ideas WHERE status='已放弃';"`) || "N/A"
);
console.log("  日报:");
console.log(
  "   ",
  sh(`${PG} -c "SELECT report_date || ' | len=' || length(report_markdown) || ' | ' || status FROM daily_reports ORDER BY report_date DESC;"`)
    .split("\n")
    .join("\n    ")
);

/* ---------- 4. n8n 状态 ---------- */
section("4. n8n 工作流与定时任务状态");

// n8n 的 SQLite 快照目录（可用第一个参数覆盖）
// 默认读 /tmp/n8n-edit（阶段 D 施工时用的工作副本），其次是审计期快照。
const n8nDir = process.argv[2] ?? (existsSync("/tmp/n8n-edit/database.sqlite") ? "/tmp/n8n-edit" : "/tmp/n8n-audit");
const n8nSqlite = `${n8nDir}/database.sqlite`;
if (existsSync(n8nSqlite)) {
  console.log(`  快照来源: ${n8nSqlite}`);
  const q = (sql: string) => sh(`cd ${n8nDir} && sqlite3 database.sqlite "${sql}"`);
  console.log("  workflow_entity:");
  console.log(
    "   ",
    q("SELECT 'versionId=' || versionId || ' activeVersionId=' || activeVersionId FROM workflow_entity WHERE id='ZtIAVVtWmcPLXywX';")
  );
  console.log("  published:");
  console.log("   ", q("SELECT publishedVersionId FROM workflow_published_version;"));
  console.log("  节点数对比:");
  for (const [label, sql] of [
    ["active 版", "SELECT count(*) FROM json_each((SELECT nodes FROM workflow_history WHERE versionId=(SELECT activeVersionId FROM workflow_entity WHERE id='ZtIAVVtWmcPLXywX')))"],
    ["draft 版 ", "SELECT count(*) FROM json_each((SELECT nodes FROM workflow_entity WHERE id='ZtIAVVtWmcPLXywX'))"],
  ] as const) {
    console.log(`    ${label}: ${q(sql)} 节点`);
  }
  console.log("  scheduled_job:");
  console.log(
    "   ",
    q("SELECT 'cron=' || cronExpression || ' tz=' || timezone || ' enabled=' || enabled || ' lastFiredAt=' || coalesce(lastFiredAt,'(空)') || ' nextRunAt=' || coalesce(nextRunAt,'-') FROM scheduled_job;")
  );
  console.log("  执行 mode 分布:");
  console.log(
    "   ",
    q("SELECT mode || '=' || count(*) FROM execution_entity GROUP BY mode;").split("\n").join(", ")
  );
} else {
  console.log(`  [跳过] ${n8nSqlite} 不存在`);
}

console.log("\n验收脚本执行完毕。\n");
