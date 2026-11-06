// 商业机会自动草稿 集成测试 —— Owner: Agent B（阶段1b）
// 运行：node --env-file=.env.local --import tsx --test --test-concurrency=1 tests/opportunity-draft.test.ts
// 连真实库；测试数据 title 一律 '__test__' 前缀，每个用例 finally 自清理（LIKE '__test__%' 兜底历史残留）
import { test } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { draftOpportunities, formatDraftNotes, type OpportunityCandidate } from "@/lib/opportunity-draft";
import { getWritePool } from "@/lib/db-write";
import type { OpportunityRow } from "@/lib/db-write";

const TEST_DATE = "1992-08-16"; // 真实日报不可能存在的日期，便于断言与排查

function testTitle(): string {
  return `__test__ 商机${randomUUID()}`;
}

function candidate(overrides?: Partial<OpportunityCandidate>): OpportunityCandidate {
  return {
    title: testTitle(),
    description: "测试描述：日报中提到的某个可执行机会。",
    category: "内容创业",
    rationale: "日报提到某平台放宽了分成政策，可作为判断依据。",
    ...overrides,
  };
}

async function getRowByTitle(title: string): Promise<OpportunityRow | null> {
  const { rows } = await getWritePool().query<OpportunityRow>(
    `SELECT id::int AS id, title, description, category,
            source_report_date::text AS source_report_date, status, notes,
            action_plan, created_at::text, updated_at::text
     FROM opportunities WHERE trim(title) = trim($1)`,
    [title]
  );
  return rows[0] ?? null;
}

async function cleanup(): Promise<void> {
  await getWritePool().query(`DELETE FROM opportunities WHERE title LIKE '__test__%'`);
}

test("正常写入：字段、status、notes 格式正确", async () => {
  const c = candidate();
  try {
    const result = await draftOpportunities(TEST_DATE, [c]);
    assert.strictEqual(result.inserted, 1);
    assert.strictEqual(result.skipped.length, 0);

    const row = await getRowByTitle(c.title);
    assert.ok(row, "落库后应能按标题查到");
    assert.strictEqual(row.status, "待研究");
    assert.strictEqual(row.source_report_date, TEST_DATE);
    assert.strictEqual(row.description, c.description);
    assert.strictEqual(row.category, c.category);
    assert.strictEqual(
      row.notes,
      `判断依据：${c.rationale}（来源日报 ${TEST_DATE}）`
    );
  } finally {
    await cleanup();
  }
});

test("无 rationale 时 notes 仅记录来源日报；category 空则落 NULL", async () => {
  const c = candidate({ category: "  ", rationale: null });
  try {
    const result = await draftOpportunities(TEST_DATE, [c]);
    assert.strictEqual(result.inserted, 1);

    const row = await getRowByTitle(c.title);
    assert.ok(row);
    assert.strictEqual(row.notes, `来源日报 ${TEST_DATE}`);
    assert.strictEqual(row.category, null);
  } finally {
    await cleanup();
  }
});

test("跨批去重：同 title 二次写入被跳过（语义去重）", async () => {
  const c = candidate();
  try {
    const first = await draftOpportunities(TEST_DATE, [c]);
    assert.strictEqual(first.inserted, 1);

    // 换日期再写同标题：仍然跳过（去重不分日期）
    const second = await draftOpportunities("1992-08-17", [candidate({ title: c.title })]);
    assert.strictEqual(second.inserted, 0);
    assert.strictEqual(second.skipped.length, 1);
    assert.strictEqual(second.skipped[0].title, c.title);
    assert.match(second.skipped[0].reason, /语义重复|完全一致/);
    assert.ok((second.skipped[0].matchedId ?? -1) > 0, "应记录命中的历史 id");
  } finally {
    await cleanup();
  }
});

test("同批去重：同 title 只写一次", async () => {
  const c = candidate();
  try {
    const result = await draftOpportunities(TEST_DATE, [c, candidate({ title: c.title })]);
    assert.strictEqual(result.inserted, 1);
    assert.strictEqual(result.skipped.length, 1);
    assert.strictEqual(result.skipped[0].title, c.title);
    assert.match(result.skipped[0].reason, /同批/);
  } finally {
    await cleanup();
  }
});

test("trim 去重：首尾空白不同的同标题视为重复", async () => {
  const c = candidate();
  try {
    const result = await draftOpportunities(TEST_DATE, [c, candidate({ title: `  ${c.title}  ` })]);
    assert.strictEqual(result.inserted, 1);
    assert.strictEqual(result.skipped.length, 1);
    assert.match(result.skipped[0].reason, /同批/);
  } finally {
    await cleanup();
  }
});

test("语义去重：措辞不同的同一机会被跳过，且写明判定依据", async () => {
  // 用一组不与库中真实商机冲突的措辞，验证「同主题不同措辞」能被识别
  const a = candidate({
    title: "__test__ 为内部研发团队搭建轻量工单自动化工具",
    description: "编码Agent让内部工单与审批流程的自动化交付成本明显下降，业务团队可自建内部工具。",
  });
  const b = candidate({
    title: "__test__ 给研发团队做轻量工单自动化工具",
    description: "编码Agent降低内部工单自动化工具的交付成本，业务部门可以自己做内部工具。",
  });
  try {
    const first = await draftOpportunities(TEST_DATE, [a]);
    assert.strictEqual(first.inserted, 1);

    const second = await draftOpportunities(TEST_DATE, [b]);
    assert.strictEqual(second.inserted, 0, "语义重复的候选不应重复落库");
    assert.strictEqual(second.skipped.length, 1);
    assert.match(second.skipped[0].reason, /语义重复/);
    assert.ok((second.skipped[0].score ?? 0) > 0, "应记录判定得分");
  } finally {
    await cleanup();
  }
});

test("语义去重：新候选描述更完整时合并更新历史记录，不丢数据", async () => {
  const short = candidate({
    title: "__test__ Agent网络出口审计网关服务",
    description: "为Agent提供网络出口审计。",
  });
  const rich = candidate({
    title: "__test__ Agent网络出口审计网关服务",
    description: "为Agent提供网络出口审计、域名白名单、PII脱敏与审计日志，面向企业安全采购刚需。",
  });
  try {
    await draftOpportunities(TEST_DATE, [short]);
    const rowBefore = await getRowByTitle(short.title);
    assert.ok(rowBefore);
    assert.strictEqual(rowBefore.description, short.description);

    const second = await draftOpportunities("1992-08-17", [rich]);
    assert.strictEqual(second.inserted, 0, "重复项不新增行");
    assert.strictEqual(second.merged, 1, "应合并到历史记录");

    const rowAfter = await getRowByTitle(short.title);
    assert.ok(rowAfter);
    assert.match(rowAfter.description ?? "", /域名白名单/, "更完整的描述应被合并进历史记录");
    assert.strictEqual(rowAfter.status, "待研究", "status 不得被覆盖");
  } finally {
    await cleanup();
  }
});

test("语义去重：不覆盖人工编辑过的 notes / action_plan / status", async () => {
  const c = candidate({ title: "__test__ 人工编辑保护用例" });
  try {
    await draftOpportunities(TEST_DATE, [c]);
    const before = await getRowByTitle(c.title);
    assert.ok(before);

    // 模拟人工编辑：改 status / notes / action_plan
    await getWritePool().query(
      `UPDATE opportunities SET status = '验证中', notes = '人工备注：请先做单行业试点', action_plan = '第一步：访谈3家客户'
       WHERE id = $1::int`,
      [before.id]
    );

    // 再来一条语义重复、且描述更长的候选
    const dup = candidate({
      title: "__test__ 人工编辑保护用例",
      description: "这是一条明显更完整的描述，包含更多实现细节与验证路径，应当被合并但不得覆盖人工字段。",
    });
    const second = await draftOpportunities("1992-08-17", [dup]);
    assert.strictEqual(second.inserted, 0);

    const after = await getRowByTitle(c.title);
    assert.ok(after);
    assert.strictEqual(after.status, "验证中", "status 不得被覆盖");
    assert.strictEqual(after.notes, "人工备注：请先做单行业试点", "人工 notes 不得被覆盖");
    assert.strictEqual(after.action_plan, "第一步：访谈3家客户", "action_plan 不得被覆盖");
  } finally {
    await cleanup();
  }
});

test("输入校验：缺标题 / 缺描述 / 超长分类 均跳过并记原因", async () => {
  const bad1 = candidate({ title: "   " });
  const bad2 = candidate({ description: "   " });
  const bad3 = candidate({ category: "x".repeat(101) });
  const good = candidate();
  try {
    const result = await draftOpportunities(TEST_DATE, [bad1, bad2, bad3, good]);
    assert.strictEqual(result.inserted, 1, "合法候选应正常写入");
    assert.strictEqual(result.skipped.length, 3);
    assert.match(result.skipped[0].reason, /标题/);
    assert.match(result.skipped[1].reason, /描述/);
    assert.match(result.skipped[2].reason, /分类/);
  } finally {
    await cleanup();
  }
});

test("reportDate 非法时整批拒绝（抛错且不落库）", async () => {
  const c = candidate();
  try {
    await assert.rejects(
      () => draftOpportunities("2026/01/01", [c]),
      /YYYY-MM-DD/
    );
    await assert.rejects(() => draftOpportunities("2026-02-30", [c]), /YYYY-MM-DD/);
    const row = await getRowByTitle(c.title);
    assert.strictEqual(row, null, "抛错前不应有部分写入");
  } finally {
    await cleanup();
  }
});

test("空候选列表：返回零写入零跳过，不报错", async () => {
  const result = await draftOpportunities(TEST_DATE, []);
  assert.deepStrictEqual(result, { inserted: 0, skipped: [], merged: 0 });
});

test("formatDraftNotes：两种格式拼接", () => {
  assert.strictEqual(
    formatDraftNotes("2026-11-06", "某事实依据"),
    "判断依据：某事实依据（来源日报 2026-11-06）"
  );
  assert.strictEqual(formatDraftNotes("2026-11-06", null), "来源日报 2026-11-06");
  assert.strictEqual(formatDraftNotes("2026-11-06", "   "), "来源日报 2026-11-06");
});
