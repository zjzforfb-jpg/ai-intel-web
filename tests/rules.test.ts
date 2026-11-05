// 质量检查规则测试 —— Owner: Agent A
// 运行：node --env-file=.env.local --import tsx --test tests/rules.test.ts
// 纯内存构造 ReportRow 假数据，不连数据库
import { test } from "node:test";
import assert from "node:assert/strict";
import { runQualityChecks, type QualityCheckContext } from "@/lib/monitor/rules";
import type { ReportRow } from "@/lib/db";

const TODAY = "2026-11-05";

/** 六章节齐全、可正常解析的标准正文 */
function makeMarkdown(): string {
  return [
    "# 每日 AI 情报内参 · 2026-11-05",
    "",
    "## 一、今日核心判断",
    "1. 大模型竞争进入代理（Agent）阶段，工具链成为新战场。",
    "",
    "## 二、今日必读头条",
    "### 1. OpenAI 发布新一代模型",
    "- **来源及发布时间**：OpenAI，2026-11-05",
    "- **核心事实**：新模型支持长程代理任务。",
    "- **深度解读**：推理成本下降将推动应用普及。",
    "- **对行业的影响**：应用层竞争加剧。",
    "- **原文链接**：https://example.com/a",
    "",
    "## 三、重点领域动态",
    "1. 开源社区发布新推理框架。",
    "",
    "## 四、行业趋势观察",
    "1. **代理化加速**：判断依据：多款产品发布；观点：将成为明年主线。",
    "",
    "## 五、开发者与创业者机会",
    "1. **评测工具链**：机会来源：模型迭代；实现方向：自动化评测；潜在价值：降本。",
    "",
    "## 六、明日重点关注",
    "1. 关注新模型 API 定价变化。",
  ].join("\n");
}

/**
 * 构造 ReportRow。未显式给 validation 时，按当前正文自动生成与 n8n 口径一致的标志
 * （三个 has_* 全 true + markdown_length 与实际长度一致），保证默认行不会误触发规则；
 * 显式传 validation: null 或对象则完全以传入为准。
 */
function makeReport(overrides: Partial<ReportRow> = {}): ReportRow {
  const row: ReportRow = {
    id: 1,
    report_date: TODAY,
    title: "每日 AI 情报内参 · 2026-11-05",
    report_markdown: makeMarkdown(),
    report_html: null,
    generated_at: "2026-11-05T08:30:00+08:00",
    total_articles: 12,
    headline_count: 5,
    status: "success",
    validation: null,
    created_at: "2026-11-05T08:31:00+08:00",
    ...overrides,
  };
  if (overrides.validation === undefined && row.report_markdown != null) {
    row.validation = {
      has_content: true,
      has_core_judgment: true,
      has_headlines: true,
      markdown_length: row.report_markdown.length,
    };
  }
  return row;
}

function makeCtx(partial: Partial<QualityCheckContext> & { reports: ReportRow[] }): QualityCheckContext {
  return { expectedDates: [], today: TODAY, minContentLength: 100, ...partial };
}

function codes(issues: ReturnType<typeof runQualityChecks>): string[] {
  return issues.map((i) => i.code);
}

/* ------------------------- 正常路径 ------------------------- */

test("正常报告：六章节齐全、字段合法 → 零异常", () => {
  const issues = runQualityChecks(makeCtx({ reports: [makeReport()], expectedDates: [TODAY] }));
  assert.deepEqual(issues, []);
});

/* ------------------------- 缺失 / 重复 ------------------------- */

test("MISSING_REPORT：每个预期缺失日期各报一条 error", () => {
  const issues = runQualityChecks(makeCtx({ reports: [], expectedDates: ["2026-11-04", "2026-11-05"] }));
  assert.equal(issues.length, 2);
  assert.ok(issues.every((i) => i.code === "MISSING_REPORT" && i.severity === "error"));
  assert.deepEqual(issues.map((i) => i.meta?.date).sort(), ["2026-11-04", "2026-11-05"]);
});

test("DUPLICATE_REPORT：同日两条 → 仅报一次并带 count", () => {
  const issues = runQualityChecks(makeCtx({ reports: [makeReport({ id: 1 }), makeReport({ id: 2 })], expectedDates: [TODAY] }));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "DUPLICATE_REPORT");
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[0].meta?.count, 2);
});

test("DUPLICATE_TITLE：不同日期标题仅差空格/大小写/标点 → warn", () => {
  const issues = runQualityChecks(
    makeCtx({
      reports: [
        makeReport({ id: 1, report_date: "2026-11-04", title: "OpenAI 发布 GPT-6！" }),
        makeReport({ id: 2, report_date: "2026-11-05", title: "openai发布GPT－6？" }),
      ],
    })
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "DUPLICATE_TITLE");
  assert.equal(issues[0].severity, "warn");
  assert.deepEqual([issues[0].meta?.date1, issues[0].meta?.date2], ["2026-11-04", "2026-11-05"]);
});

test("DUPLICATE_TITLE：不同标题不误报", () => {
  const issues = runQualityChecks(
    makeCtx({
      reports: [
        makeReport({ id: 1, report_date: "2026-11-04", title: "AI 芯片突破" }),
        makeReport({ id: 2, report_date: "2026-11-05", title: "开源模型发布" }),
      ],
    })
  );
  assert.deepEqual(issues, []);
});

/* ------------------------- 空内容 / 异常短 ------------------------- */

test("EMPTY_CONTENT：report_markdown 为 null 与纯空白均报 error，markdownNull 区分", () => {
  const a = runQualityChecks(makeCtx({ reports: [makeReport({ report_markdown: null })] }));
  assert.equal(a.length, 1);
  assert.equal(a[0].code, "EMPTY_CONTENT");
  assert.equal(a[0].severity, "error");
  assert.equal(a[0].meta?.markdownNull, true);

  const b = runQualityChecks(makeCtx({ reports: [makeReport({ report_markdown: "  \n\t " })] }));
  assert.equal(b.length, 1);
  assert.equal(b[0].code, "EMPTY_CONTENT");
  assert.equal(b[0].meta?.markdownNull, false);
});

test("SHORT_CONTENT：低于阈值报 warn；恰好等于阈值不报（边界）", () => {
  const md = makeMarkdown();
  const len = md.trim().length;

  const exact = runQualityChecks(makeCtx({ reports: [makeReport({ report_markdown: md })], minContentLength: len }));
  assert.deepEqual(exact, []);

  const below = runQualityChecks(makeCtx({ reports: [makeReport({ report_markdown: md })], minContentLength: len + 1 }));
  assert.equal(below.length, 1);
  assert.equal(below[0].code, "SHORT_CONTENT");
  assert.equal(below[0].severity, "warn");
  assert.equal(below[0].meta?.length, len);
  assert.equal(below[0].meta?.threshold, len + 1);
});

/* ------------------------- 解析与结构 ------------------------- */

test("PARSE_FAILED：正文非空但切不出任何 ## 章节 → warn", () => {
  const md = "这是一段没有章节标题的正文。".repeat(10);
  const issues = runQualityChecks(makeCtx({ reports: [makeReport({ report_markdown: md })], minContentLength: 10 }));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "PARSE_FAILED");
  assert.equal(issues[0].severity, "warn");
});

test("MISSING_SECTION：只缺「明日重点关注」→ warn 并列明", () => {
  const md = makeMarkdown().replace(/## 六、明日重点关注[\s\S]*$/, "");
  const issues = runQualityChecks(makeCtx({ reports: [makeReport({ report_markdown: md })] }));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "MISSING_SECTION");
  assert.equal(issues[0].severity, "warn");
  assert.equal(issues[0].meta?.missing, "明日重点关注");
});

test("MISSING_SECTION：「核心判断」章节存在但内容空白 → error", () => {
  const md = makeMarkdown().replace("1. 大模型竞争进入代理（Agent）阶段，工具链成为新战场。", "   ");
  const issues = runQualityChecks(makeCtx({ reports: [makeReport({ report_markdown: md })] }));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "MISSING_SECTION");
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[0].meta?.reason, "blank_core_judgment");
  assert.match(issues[0].message, /核心判断/);
});

/* ------------------------- 必需字段 ------------------------- */

test("INVALID_FIELDS：标题空/日期非法/计数 null 或负/计数倒挂/generated_at 缺失各报一条", () => {
  const rows = [
    makeReport({ id: 1, report_date: "2026-10-27", title: "   " }),
    makeReport({ id: 2, report_date: "2026-13-45", title: "日期月份非法" }),
    makeReport({ id: 3, report_date: "not-a-date", title: "日期乱码" }),
    makeReport({ id: 4, report_date: "2026-10-30", title: "缺 total", total_articles: null }),
    makeReport({ id: 5, report_date: "2026-10-31", title: "负 total", total_articles: -3 }),
    makeReport({ id: 6, report_date: "2026-11-01", title: "缺 headline", headline_count: null }),
    makeReport({ id: 7, report_date: "2026-11-02", title: "负 headline", headline_count: -1 }),
    makeReport({ id: 8, report_date: "2026-11-03", title: "计数倒挂", total_articles: 5, headline_count: 6 }),
    makeReport({ id: 9, report_date: "2026-11-04", title: "缺生成时间", generated_at: null }),
  ];
  const issues = runQualityChecks(makeCtx({ reports: rows }));
  assert.ok(issues.every((i) => i.code === "INVALID_FIELDS" && i.severity === "error"));
  assert.deepEqual(
    issues.map((i) => `${i.meta?.id}:${i.meta?.field}`).sort(),
    [
      "1:title",
      "2:report_date",
      "3:report_date",
      "4:total_articles",
      "5:total_articles",
      "6:headline_count",
      "7:headline_count",
      "8:headline_count",
      "9:generated_at",
    ]
  );
});

/* ------------------------- validation 标志 ------------------------- */

test("VALIDATION_FLAG：has_* 显式 false 报 error，标志缺失不误报", () => {
  const one = runQualityChecks(
    makeCtx({
      reports: [makeReport({ validation: { has_content: true, has_core_judgment: true, has_headlines: false } })],
    })
  );
  assert.equal(one.length, 1);
  assert.equal(one[0].code, "VALIDATION_FLAG");
  assert.equal(one[0].severity, "error");
  assert.equal(one[0].meta?.flag, "has_headlines");

  const two = runQualityChecks(
    makeCtx({ reports: [makeReport({ validation: { has_content: false, has_core_judgment: false } })] })
  );
  assert.deepEqual(two.map((i) => i.meta?.flag).sort(), ["has_content", "has_core_judgment"]);

  // 部分标志缺失（只有 has_content: true）→ 不触发
  const partial = runQualityChecks(makeCtx({ reports: [makeReport({ validation: { has_content: true } })] }));
  assert.deepEqual(partial, []);

  // validation 整体为 null → 不触发且不崩
  const none = runQualityChecks(makeCtx({ reports: [makeReport({ validation: null })] }));
  assert.deepEqual(none, []);
});

test("VALIDATION_FLAG：markdown_length 偏差恰好 20% 不报、超过 20% 报 warn（边界）", () => {
  const flags = { has_content: true, has_core_judgment: true, has_headlines: true };
  // 实际 1000、声明 1250 → |1250-1000|/1250 = 20% → 不报
  const exact = makeReport({
    report_markdown: makeMarkdown().padEnd(1000, "字"),
    validation: { ...flags, markdown_length: 1250 },
  });
  assert.deepEqual(runQualityChecks(makeCtx({ reports: [exact] })), []);

  // 实际 999、声明 1250 → 20.08% → 报
  const over = makeReport({
    report_markdown: makeMarkdown().padEnd(999, "字"),
    validation: { ...flags, markdown_length: 1250 },
  });
  const issues = runQualityChecks(makeCtx({ reports: [over] }));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "VALIDATION_FLAG");
  assert.equal(issues[0].severity, "warn");
  assert.equal(issues[0].meta?.flag, "markdown_length");
  assert.equal(issues[0].meta?.declared, 1250);
  assert.equal(issues[0].meta?.actual, 999);
});

/* ------------------------- 未来日期 ------------------------- */

test("FUTURE_DATE：report_date 晚于今天 → error；等于今天不报", () => {
  const issues = runQualityChecks(makeCtx({ reports: [makeReport({ report_date: "2026-11-06" })] }));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "FUTURE_DATE");
  assert.equal(issues[0].severity, "error");
  assert.equal(issues[0].meta?.date, "2026-11-06");
});

/* ------------------------- 覆盖性缺失 ------------------------- */

test("STALE_DATA：staleDays 窗口内无报告报 error，有报告或未启用则不报", () => {
  // 窗口 (2026-11-02, 2026-11-05]，11-01 在窗口外 → 断更
  const old = makeReport({ id: 1, report_date: "2026-11-01", title: "旧报告" });
  const a = runQualityChecks(makeCtx({ reports: [old], staleDays: 3 }));
  assert.equal(a.length, 1);
  assert.equal(a[0].code, "STALE_DATA");
  assert.equal(a[0].severity, "error");

  // 窗口内有报告 → 不报
  const fresh = makeReport({ id: 2, report_date: "2026-11-04", title: "新报告" });
  const b = runQualityChecks(makeCtx({ reports: [fresh], staleDays: 3 }));
  assert.deepEqual(b, []);

  // 未传 staleDays（runner 现有调用方式）→ 不做覆盖性判定，保持兼容
  const c = runQualityChecks(makeCtx({ reports: [] }));
  assert.deepEqual(c, []);

  // 与 MISSING_REPORT 可叠加
  const d = runQualityChecks(makeCtx({ reports: [], expectedDates: [TODAY], staleDays: 3 }));
  assert.deepEqual(codes(d).sort(), ["MISSING_REPORT", "STALE_DATA"]);
});

/* ------------------------- 全局约束 ------------------------- */

test("NOTIFY_FAILED 不由 runQualityChecks 产生（通知归 runner/notify）", () => {
  const issues = runQualityChecks(
    makeCtx({
      reports: [makeReport({ id: 1, report_date: "2026-13-45", title: "", report_markdown: null })],
      expectedDates: [TODAY],
      staleDays: 3,
    })
  );
  assert.ok(issues.length > 0);
  assert.ok(!issues.some((i) => i.code === "NOTIFY_FAILED"));
});

test("所有 issue：message 非空且 ≤200 字，meta 仅标量", () => {
  const issues = runQualityChecks(
    makeCtx({
      reports: [
        makeReport({ id: 1, report_date: "2026-13-45", title: "", report_markdown: null }),
        makeReport({ id: 2, report_date: "2026-11-06", title: "x".repeat(50), generated_at: null }),
      ],
      expectedDates: [TODAY],
      staleDays: 3,
    })
  );
  assert.ok(issues.length > 0);
  for (const i of issues) {
    assert.ok(i.message.length > 0 && i.message.length <= 200, `message 长度异常：${i.message}`);
    if (!i.meta) continue;
    for (const v of Object.values(i.meta)) {
      assert.ok(v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean", `meta 非标量：${String(v)}`);
    }
  }
});
