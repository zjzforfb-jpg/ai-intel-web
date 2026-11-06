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

test("跨批去重：同 title 二次写入被跳过", async () => {
  const c = candidate();
  try {
    const first = await draftOpportunities(TEST_DATE, [c]);
    assert.strictEqual(first.inserted, 1);

    // 换日期再写同标题：仍然跳过（去重不分日期）
    const second = await draftOpportunities("1992-08-17", [candidate({ title: c.title })]);
    assert.strictEqual(second.inserted, 0);
    assert.strictEqual(second.skipped.length, 1);
    assert.strictEqual(second.skipped[0].title, c.title);
    assert.match(second.skipped[0].reason, /已存在/);
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
  assert.deepStrictEqual(result, { inserted: 0, skipped: [] });
});

test("formatDraftNotes：两种格式拼接", () => {
  assert.strictEqual(
    formatDraftNotes("2026-11-06", "某事实依据"),
    "判断依据：某事实依据（来源日报 2026-11-06）"
  );
  assert.strictEqual(formatDraftNotes("2026-11-06", null), "来源日报 2026-11-06");
  assert.strictEqual(formatDraftNotes("2026-11-06", "   "), "来源日报 2026-11-06");
});
