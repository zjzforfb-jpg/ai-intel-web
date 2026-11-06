// 选题提取模块测试 —— Agent A（选题提取）
// 运行：node --env-file=.env.local --import tsx --test --test-concurrency=1 tests/ideas.test.ts
//
// 覆盖：
//   1. CRUD 全链路：createIdea / listIdeas（date+status 筛选与排序）/ getIdea / updateIdea / deleteIdea
//   2. 校验：状态白名单、评分 1-10 整数越界拒绝、标题必填限长、日期格式
//   3. 去重：同日同标题 UNIQUE 冲突（IdeaConflictError）
//
// 数据纪律：所有自造数据 title 一律带 __test__ 前缀；afterEach 清理并在 after 中断言无残留。

import { describe, test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  listIdeas,
  getIdea,
  createIdea,
  updateIdea,
  deleteIdea,
  IdeaConflictError,
  findDuplicateIdeas,
  createIdeaDeduplicated,
  isAngleDifferent,
} from "@/lib/ideas";
import { isIdeaStatus, validateIdea } from "@/lib/ideas-shared";

/** 固定用远古日期，绝不与真实日报数据重叠 */
const TEST_DATE = "2000-01-01";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}（请在 .env.local 配置，勿硬编码）`);
  return v;
}

/** 直连 writer 账号，仅用于清理探针行（lib 内部使用单例池，避免互相干扰） */
let cleanupPool: Pool;

before(async () => {
  cleanupPool = new Pool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5433),
    database: process.env.DB_NAME || "ai_intelligence",
    user: process.env.DB_WRITE_USER || "ai_intel_writer",
    password: requireEnv("DB_WRITE_PASSWORD"),
    max: 1,
    ssl: false,
  });
  // 预清理历史残留（如上次异常中断留下）
  await cleanupPool.query("DELETE FROM topic_ideas WHERE title LIKE '\\_\\_test\\_\\_%'");
});

afterEach(async () => {
  await cleanupPool.query("DELETE FROM topic_ideas WHERE title LIKE '\\_\\_test\\_\\_%'");
});

after(async () => {
  try {
    const residual = await cleanupPool.query(
      "SELECT count(*)::int AS n FROM topic_ideas WHERE title LIKE '\\_\\_test\\_\\_%'"
    );
    assert.equal(residual.rows[0].n, 0, "测试结束后 topic_ideas 不应残留 __test__ 行");
  } finally {
    await cleanupPool.end();
  }
});

/* ==================== CRUD ==================== */

describe("topic_ideas CRUD", () => {
  test("create + get 往返：完整字段落库一致，缺省字段为 NULL，状态默认待制作", async () => {
    const created = await createIdea({
      report_date: TEST_DATE,
      title: "__test__完整选题钩子",
      angle: "反常识角度",
      source_material: "日报第2条：https://example.com/a",
      reference_visuals: "开场 3 秒快切对比画面",
      value_score: 8,
      status: "待制作",
    });
    assert.ok(created.id > 0);
    assert.equal(created.report_date, TEST_DATE);
    assert.equal(created.title, "__test__完整选题钩子");
    assert.equal(created.angle, "反常识角度");
    assert.equal(created.value_score, 8);
    assert.equal(created.status, "待制作");

    const fetched = await getIdea(created.id);
    assert.ok(fetched);
    assert.equal(fetched.title, created.title);
    assert.equal(fetched.reference_visuals, "开场 3 秒快切对比画面");
    assert.equal(fetched.source_material, "日报第2条：https://example.com/a");

    // 最小字段创建：只给必填项
    const minimal = await createIdea({
      report_date: TEST_DATE,
      title: "__test__最小字段选题",
      angle: null,
      source_material: null,
      reference_visuals: null,
      value_score: null,
      status: "待制作",
    });
    assert.equal(minimal.status, "待制作");
    assert.equal(minimal.value_score, null);
    assert.equal(minimal.angle, null);
  });

  test("listIdeas：date 与 status 筛选，同日内按评分倒序", async () => {
    await createIdea({
      report_date: TEST_DATE,
      title: "__test__评分5",
      value_score: 5,
      status: "待制作",
      angle: null,
      source_material: null,
      reference_visuals: null,
    });
    await createIdea({
      report_date: TEST_DATE,
      title: "__test__评分9",
      value_score: 9,
      status: "已选用",
      angle: null,
      source_material: null,
      reference_visuals: null,
    });
    await createIdea({
      report_date: "2000-01-02",
      title: "__test__另一天",
      value_score: 10,
      status: "待制作",
      angle: null,
      source_material: null,
      reference_visuals: null,
    });

    // date 筛选：只含 TEST_DATE，评分倒序（9 在 5 前）
    const byDate = await listIdeas({ date: TEST_DATE });
    assert.equal(byDate.length, 2);
    assert.deepEqual(
      byDate.map((r) => r.value_score),
      [9, 5]
    );

    // status 筛选
    const byStatus = await listIdeas({ status: "已选用" });
    assert.equal(byStatus.length, 1);
    assert.equal(byStatus[0].title, "__test__评分9");

    // date + status 组合
    const both = await listIdeas({ date: TEST_DATE, status: "待制作" });
    assert.equal(both.length, 1);
    assert.equal(both[0].value_score, 5);
  });

  test("updateIdea：局部更新只写 patch 字段并刷新 updated_at；不存在返回 null", async () => {
    const created = await createIdea({
      report_date: TEST_DATE,
      title: "__test__待更新",
      angle: "原始角度",
      status: "待制作",
      source_material: null,
      reference_visuals: null,
      value_score: null,
    });
    assert.ok(created.updated_at);

    // 故意等待，保证 updated_at 时间戳可见变化
    await new Promise((r) => setTimeout(r, 30));

    const updated = await updateIdea(created.id, {
      status: "已制作",
      value_score: 7,
    });
    assert.ok(updated);
    assert.equal(updated.status, "已制作");
    assert.equal(updated.value_score, 7);
    // 未提交的字段保持不变
    assert.equal(updated.angle, "原始角度");
    assert.equal(updated.title, "__test__待更新");
    assert.ok(new Date(updated.updated_at) > new Date(created.updated_at), "updated_at 应被刷新");

    const missing = await updateIdea(999999999, { status: "已放弃" });
    assert.equal(missing, null);
  });

  test("deleteIdea：删除返回 true 且行消失；重复删除返回 false", async () => {
    const created = await createIdea({
      report_date: TEST_DATE,
      title: "__test__待删除",
      angle: null,
      source_material: null,
      reference_visuals: null,
      value_score: null,
      status: "待制作",
    });

    assert.equal(await deleteIdea(created.id), true);
    assert.equal(await getIdea(created.id), null);
    assert.equal(await deleteIdea(created.id), false);
  });

  test("getIdea：不存在的 id 返回 null", async () => {
    assert.equal(await getIdea(999999999), null);
  });
});

/* ==================== 去重（UNIQUE 冲突） ==================== */

describe("topic_ideas 去重", () => {
  test("同日同标题 create 抛 IdeaConflictError；同标题不同日期不冲突", async () => {
    await createIdea({
      report_date: TEST_DATE,
      title: "__test__重复标题",
      angle: null,
      source_material: null,
      reference_visuals: null,
      value_score: null,
      status: "待制作",
    });

    await assert.rejects(
      () =>
        createIdea({
          report_date: TEST_DATE,
          title: "__test__重复标题",
          angle: null,
          source_material: null,
          reference_visuals: null,
          value_score: null,
          status: "待制作",
        }),
      IdeaConflictError
    );

    // 不同日期同标题：合法
    const other = await createIdea({
      report_date: "2000-01-02",
      title: "__test__重复标题",
      angle: null,
      source_material: null,
      reference_visuals: null,
      value_score: null,
      status: "待制作",
    });
    assert.ok(other.id > 0);
  });
});

/* ==================== 输入校验 ==================== */

describe("validateIdea 校验", () => {
  test("状态白名单：非法状态拒绝", () => {
    const bad = validateIdea(
      { report_date: TEST_DATE, title: "t", status: "不存在" },
      "create"
    );
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.errors.status ?? "", /状态/);

    for (const s of ["待制作", "已选用", "已制作", "已放弃"]) {
      assert.equal(isIdeaStatus(s), true);
    }
    assert.equal(isIdeaStatus("已发布"), false);
    assert.equal(isIdeaStatus(123), false);
  });

  test("评分越界拒绝：0、11、小数、非数字均拒绝；1-10 整数与 null 合法", () => {
    for (const score of [0, 11, 5.5, "8", NaN]) {
      const bad = validateIdea({ report_date: TEST_DATE, title: "t", value_score: score }, "create");
      assert.equal(bad.ok, false, `评分 ${String(score)} 应被拒绝`);
      if (!bad.ok) assert.match(bad.errors.value_score ?? "", /评分/);
    }
    for (const score of [1, 10, 7, null]) {
      const ok = validateIdea({ report_date: TEST_DATE, title: "t", value_score: score }, "create");
      assert.equal(ok.ok, true, `评分 ${String(score)} 应合法`);
    }
  });

  test("标题必填限长：空/超长拒绝，create 缺 title 拒绝", () => {
    const empty = validateIdea({ report_date: TEST_DATE, title: "   " }, "create");
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.ok(empty.errors.title);

    const tooLong = validateIdea({ report_date: TEST_DATE, title: "字".repeat(201) }, "create");
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.match(tooLong.errors.title ?? "", /200/);

    const missing = validateIdea({ report_date: TEST_DATE }, "create");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.ok(missing.errors.title);
  });

  test("report_date：create 必填、格式须为真实日历日期", () => {
    const missingDate = validateIdea({ title: "t" }, "create");
    assert.equal(missingDate.ok, false);
    if (!missingDate.ok) assert.ok(missingDate.errors.report_date);

    const badFormat = validateIdea({ report_date: "2000/01/01", title: "t" }, "create");
    assert.equal(badFormat.ok, false);
    const fakeDate = validateIdea({ report_date: "2000-02-30", title: "t" }, "create");
    assert.equal(fakeDate.ok, false);
  });

  test("update 模式：至少提供一个已知字段；空对象拒绝", () => {
    const none = validateIdea({}, "update");
    assert.equal(none.ok, false);
    if (!none.ok) assert.match(none.errors.form ?? "", /没有需要更新的字段/);

    const some = validateIdea({ status: "已放弃" }, "update");
    assert.equal(some.ok, true);
    if (some.ok) assert.deepEqual(some.patch, { status: "已放弃" });
  });

  test("update 语义：白名单外的未知字段被忽略，不会触发空字段拒绝", () => {
    const r = validateIdea({ hack: "x", id: 1 }, "update");
    // 只有未知字段 = 没有可更新字段，仍拒绝（防误以为更新成功）
    assert.equal(r.ok, false);
  });
});

/* ================================================================== */
/* 阶段 2：跨日报语义查重                                              */
/* ================================================================== */

describe("阶段 2 · 跨日报语义查重", () => {
  test("findDuplicateIdeas：跨日报也能查到语义重复的选题", async () => {
    const a = await createIdea({
      report_date: TEST_DATE,
      title: "__test__ Claude Code竟把邮箱发给网站？企业该慌了",
      angle: "从开发者工具隐私翻车切入，拆解企业采用编码Agent前的数据出口审计清单。",
      source_material: null,
      reference_visuals: null,
      value_score: 9,
      status: "待制作",
    });
    assert.ok(a.id > 0);

    // 换一个日期写入，但内容语义相同
    const dup = await findDuplicateIdeas(
      "Claude Code会把邮箱发给网站？这份报告仍待确认",
      "从隐私审计视角拆解这份用户报告，给出检查Agent出站请求的实操建议。"
    );
    assert.ok(dup.length >= 1, "应跨日报查到重复选题");
    assert.ok(dup.some((d) => d.title.includes("邮箱发给网站")));
  });

  test("findDuplicateIdeas：excludeId 可排除自身", async () => {
    const a = await createIdea({
      report_date: TEST_DATE,
      title: "__test__ 排除自身用例",
      angle: "唯一角度",
      source_material: null,
      reference_visuals: null,
      value_score: 5,
      status: "待制作",
    });
    const withSelf = await findDuplicateIdeas("排除自身用例", "唯一角度");
    const withoutSelf = await findDuplicateIdeas("排除自身用例", "唯一角度", a.id);
    assert.ok(withSelf.some((d) => d.id === a.id));
    assert.ok(!withoutSelf.some((d) => d.id === a.id));
  });

  test("findDuplicateIdeas：已放弃的选题不参与判定", async () => {
    const a = await createIdea({
      report_date: TEST_DATE,
      title: "__test__ 已放弃的重复项",
      angle: "隐私审计角度",
      source_material: null,
      reference_visuals: null,
      value_score: 5,
      status: "已放弃",
    });
    const dup = await findDuplicateIdeas("已放弃的重复项", "隐私审计角度");
    assert.ok(!dup.some((d) => d.id === a.id), "已放弃的记录不应参与查重");
  });

  test("createIdeaDeduplicated：无重复时正常创建", async () => {
    const r = await createIdeaDeduplicated({
      report_date: TEST_DATE,
      title: "__test__ 完全不相关的新选题",
      angle: "讲述量子计算在药物筛选中的最新进展与落地挑战。",
      source_material: null,
      reference_visuals: null,
      value_score: 6,
      status: "待制作",
    });
    assert.ok(r.created, "无重复时应正常创建");
    assert.equal(r.duplicates.length, 0);
  });

  test("createIdeaDeduplicated：语义重复且角度相同 → 不创建，返回原因", async () => {
    await createIdea({
      report_date: TEST_DATE,
      title: "__test__ 语义重复角度相同的选题",
      angle: "从隐私审计视角拆解邮箱泄露风险，给出检查Agent出站请求的建议。",
      source_material: null,
      reference_visuals: null,
      value_score: 8,
      status: "待制作",
    });

    const r = await createIdeaDeduplicated({
      report_date: "2000-01-02",
      title: "__test__ 语义重复角度相同的选题",
      angle: "从隐私审计视角拆解邮箱泄露风险，给出检查Agent出站请求的建议。",
      source_material: null,
      reference_visuals: null,
      value_score: 8,
      status: "待制作",
    });
    assert.equal(r.created, null, "重复项不应创建");
    assert.ok(r.duplicates.length >= 1);
    assert.match(r.reason ?? "", /语义重复|完全一致/);
  });

  test("createIdeaDeduplicated：同主题但角度不同 → 允许并存并标注差异", async () => {
    await createIdea({
      report_date: TEST_DATE,
      title: "__test__ Claude Code竟把邮箱发给网站？企业该慌了",
      angle: "从企业安全审查与隐私风险的角度切入，提醒AI编程Agent的网络行为必须审计。",
      source_material: null,
      reference_visuals: null,
      value_score: 8,
      status: "待制作",
    });

    // 标题语义相同（同一事件），但切入角度显著不同 → 允许并存
    const r = await createIdeaDeduplicated({
      report_date: "2000-01-02",
      title: "__test__ Claude Code会把邮箱发给网站？这份报告仍待确认",
      angle: "换个角度：从开源许可证与合规审查切入，讨论企业引入代码助手前必须核对的条款清单。",
      source_material: null,
      reference_visuals: null,
      value_score: 8,
      status: "待制作",
    });
    assert.ok(r.created, "角度显著不同时应允许并存");
    assert.match(r.reason ?? "", /同主题但切入角度不同/);
  });

  test("isAngleDifferent：角度文本重合度低才算显著不同", () => {
    assert.equal(isAngleDifferent("隐私风险审计视角", "隐私风险审计视角"), false);
    assert.equal(isAngleDifferent(null, "任意角度"), false);
    assert.equal(isAngleDifferent("", ""), false);
    assert.equal(
      isAngleDifferent(
        "从企业安全审查与隐私风险的角度切入，提醒网络行为必须审计。",
        "换个角度：从开源许可证与合规审查切入，讨论引入前必须核对的条款清单。"
      ),
      true
    );
  });
});
