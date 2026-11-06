// 内容生产连接层测试 —— Agent B
// 运行：node --env-file=.env.local --import tsx --test tests/content-projects.test.ts
//
// 覆盖（对照 docs/phase3-stageB-interface.md §8）：
//   1. 从选题创建 → source_idea_id 正确、标题默认取选题标题
//   2. 同选题重复创建 → 409 且返回既有 id，不新增行
//   3. 编辑策划 → 字段写入成功，topic_ideas 未被改动
//   4. 导出 → JSON 字段齐全、schema_version = 1.0
//   5. 导出 → 状态流转 草稿 → 已导出
//   6. 回读 → script_result / production_status 正确写入
//   7. 来源不可篡改 → PATCH source_* 返回 400 且库内不变
//   8. 选题不存在 → 404
//
// 数据纪律：自造选题标题一律 __test__ 前缀；afterEach 清理并在 after 断言无残留。

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { createIdea, getIdea } from "@/lib/ideas";
import type { IdeaRow } from "@/lib/ideas-shared";
import { getContentProject } from "@/lib/content-projects";
import { generateContentPlan } from "@/lib/content-plan";
import { validateCreateProject, validateProjectPatch, validateImport } from "@/lib/content-projects-shared";

import { POST as createProjectPOST } from "@/app/api/content-projects/route";
import { PATCH as patchProject } from "@/app/api/content-projects/[id]/route";
import { GET as exportProject } from "@/app/api/content-projects/[id]/export/route";
import { POST as importProject } from "@/app/api/content-projects/[id]/import/route";

const TEST_DATE = "2000-01-01";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}（请在 .env.local 配置，勿硬编码）`);
  return v;
}

let cleanupPool: Pool;

/** 仅用于清理与计数，不参与被测逻辑 */
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
  await cleanupPool.query("DELETE FROM content_projects WHERE title LIKE '\\_\\_test\\_\\_%'");
  await cleanupPool.query("DELETE FROM topic_ideas WHERE title LIKE '\\_\\_test\\_\\_%'");
});

after(async () => {
  try {
    // 本链路的选题/项目在多个用例间共享，统一在结束时清理
    await cleanupPool.query("DELETE FROM content_projects WHERE title LIKE '\\_\\_test\\_\\_%'");
    await cleanupPool.query("DELETE FROM topic_ideas WHERE title LIKE '\\_\\_test\\_\\_%'");

    const p = await cleanupPool.query(
      "SELECT count(*)::int AS n FROM content_projects WHERE title LIKE '\\_\\_test\\_\\_%'"
    );
    const i = await cleanupPool.query(
      "SELECT count(*)::int AS n FROM topic_ideas WHERE title LIKE '\\_\\_test\\_\\_%'"
    );
    assert.equal(p.rows[0].n, 0, "测试结束后 content_projects 不应残留 __test__ 行");
    assert.equal(i.rows[0].n, 0, "测试结束后 topic_ideas 不应残留 __test__ 行");
  } finally {
    await cleanupPool.end();
  }
});

/* ==================== 工具 ==================== */

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id: number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

async function countProjectsByIdea(ideaId: number): Promise<number> {
  const res = await cleanupPool.query(
    "SELECT count(*)::int AS n FROM content_projects WHERE source_idea_id = $1::int",
    [ideaId]
  );
  return res.rows[0].n as number;
}

async function makeIdea(): Promise<IdeaRow> {
  return createIdea({
    report_date: TEST_DATE,
    title: "__test__AI编程工具被指外发邮箱？开发者要求给出解释",
    angle: "从企业安全审查与隐私风险切入，要求给出可验证的审计方式。",
    source_material: "《Claude Code sends your email address to websites》：https://example.com/issues/107757",
    reference_visuals: "开场拍 issue 标题与红框标注的 email address，随后切终端网络请求示意。",
    value_score: 9,
    status: "待制作",
  });
}

/* ==================== 主链路（按顺序共享状态） ==================== */

describe("内容项目全链路", () => {
  let idea: IdeaRow;
  let projectId = 0;

  test("1. 从选题创建：source_idea_id 正确、标题默认取选题标题", async () => {
    idea = await makeIdea();

    const res = await createProjectPOST(
      jsonRequest("http://localhost/api/content-projects", "POST", {
        topicIdeaId: idea.id,
        contentType: "ai_news",
        targetAudience: "AI 从业者",
      })
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as { ok: boolean; id: number };
    assert.equal(body.ok, true);
    projectId = body.id;

    const row = await getContentProject(projectId);
    assert.ok(row, "项目应可读回");
    assert.equal(row.source_idea_id, idea.id);
    assert.equal(row.title, idea.title);
    assert.equal(row.source_report_date, idea.report_date);
    assert.equal(row.content_type, "ai_news");
    assert.equal(row.target_audience, "AI 从业者");
    assert.equal(row.status, "草稿");
    assert.equal(row.production_status, "未导出");
    assert.deepEqual(row.key_points, []);
  });

  test("2. 同选题重复创建：409 + 返回既有 id，不新增行", async () => {
    const res = await createProjectPOST(
      jsonRequest("http://localhost/api/content-projects", "POST", { topicIdeaId: idea.id })
    );
    assert.equal(res.status, 409);
    const body = (await res.json()) as { ok: boolean; existingId: number };
    assert.equal(body.ok, false);
    assert.equal(body.existingId, projectId);
    assert.equal(await countProjectsByIdea(idea.id), 1);
  });

  test("3. 编辑策划：写入成功，topic_ideas 完全未被改动", async () => {
    const beforeIdea = await getIdea(idea.id);
    assert.ok(beforeIdea);

    const res = await patchProject(
      jsonRequest(`http://localhost/api/content-projects/${projectId}`, "PATCH", {
        hook: "别急着用，先把这条 issue 看完。",
        content_angle: "从审计可行性切入。",
        key_points: ["要点一：原文只给出了 issue 链接", "要点二：官方尚未回应"],
        open_questions: ["是否已修复？"],
        duration_seconds: 75,
        video_form: "口播 + 图文",
        reference_materials: [
          { title: "原始 issue", url: "https://example.com/issues/107757", note: "唯一一手来源" },
        ],
        status: "策划中",
      }),
      ctx(projectId)
    );
    assert.equal(res.status, 200);

    const row = await getContentProject(projectId);
    assert.ok(row);
    assert.equal(row.hook, "别急着用，先把这条 issue 看完。");
    assert.equal(row.duration_seconds, 75);
    assert.deepEqual(row.key_points, ["要点一：原文只给出了 issue 链接", "要点二：官方尚未回应"]);
    assert.equal(row.reference_materials[0].url, "https://example.com/issues/107757");
    assert.equal(row.status, "策划中");

    const afterIdea = await getIdea(idea.id);
    assert.deepEqual(afterIdea, beforeIdea, "topic_ideas 任何字段都不应被修改");
  });

  test("4. 导出：production_input.json 字段齐全，schema_version=1.0", async () => {
    const res = await exportProject(
      new Request(`http://localhost/api/content-projects/${projectId}/export`),
      ctx(projectId)
    );
    assert.equal(res.status, 200);

    const data = (await res.json()) as Record<string, unknown>;
    const required = [
      "schema_version",
      "generator",
      "project_id",
      "title",
      "content_type",
      "target_audience",
      "duration_seconds",
      "video_form",
      "hook",
      "content_angle",
      "key_points",
      "reference_materials",
      "source_reports",
      "source_ideas",
      "production_requirements",
      "target_pipeline",
    ];
    for (const key of required) {
      assert.ok(key in data, `导出 JSON 缺少字段 ${key}`);
    }

    assert.equal(data.schema_version, "1.0");
    assert.equal(data.project_id, projectId);
    assert.equal(data.title, idea.title);
    assert.deepEqual(data.key_points, ["要点一：原文只给出了 issue 链接", "要点二：官方尚未回应"]);

    const sourceIdeas = data.source_ideas as Array<{ id: number }>;
    assert.equal(sourceIdeas[0].id, idea.id);

    const sourceReports = data.source_reports as Array<{ report_date: string; url: string }>;
    assert.equal(sourceReports[0].report_date, TEST_DATE);
    assert.equal(sourceReports[0].url, `/report/${TEST_DATE}`);

    const req = data.production_requirements as Record<string, unknown>;
    assert.equal(req.aspect_ratio, "16:9");
    assert.equal(req.language, "zh-CN");
    assert.equal(req.must_cite_sources, true);
    assert.equal(req.no_fabrication, true);
    assert.deepEqual(req.open_questions, ["是否已修复？"]);

    const pipeline = data.target_pipeline as Record<string, unknown>;
    assert.equal(pipeline.system, "AI_DIRECTOR_PROJECT");
    assert.equal(pipeline.entry_dir, "00_source");
    assert.equal(pipeline.state_file, "project_state.json");
    assert.deepEqual(pipeline.read_back, ["05_storyboards/storyboard.md", "project_state.json"]);
  });

  test("5. 导出后状态流转：草稿/策划中 → 已导出 + 已导出待生产", async () => {
    const row = await getContentProject(projectId);
    assert.ok(row);
    assert.equal(row.status, "已导出");
    assert.equal(row.production_status, "已导出待生产");
    assert.ok(row.exported_at, "exported_at 应被写入");
    assert.ok(row.export_path, "export_path 应记录建议路径");
  });

  test("6. 回读：script_result / production_status 正确写入", async () => {
    const script = { version: "draft-1", scenes: [{ no: 1, line: "开场白" }] };
    const res = await importProject(
      jsonRequest(`http://localhost/api/content-projects/${projectId}/import`, "POST", {
        scriptResult: script,
        productionStatus: "已导入脚本",
      }),
      ctx(projectId)
    );
    assert.equal(res.status, 200);

    const row = await getContentProject(projectId);
    assert.ok(row);
    assert.deepEqual(row.script_result, script);
    assert.equal(row.production_status, "已导入脚本");
    assert.equal(row.status, "已回传");
    assert.equal(row.storyboard_result, null, "未提供的 JSONB 列不应被覆盖");
  });

  test("7. 来源不可篡改：PATCH source_* 返回 400，库内来源不变", async () => {
    const res = await patchProject(
      jsonRequest(`http://localhost/api/content-projects/${projectId}`, "PATCH", {
        source_idea_id: 999999,
        source_report_date: "1999-12-31",
        title: "__test__标题可以改但来源不行",
      }),
      ctx(projectId)
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { errors: Record<string, string> };
    assert.ok(body.errors.source_idea_id);
    assert.ok(body.errors.source_report_date);

    const row = await getContentProject(projectId);
    assert.ok(row);
    assert.equal(row.source_idea_id, idea.id);
    assert.equal(row.source_report_date, idea.report_date);
  });

  test("8. 选题不存在：404", async () => {
    const res = await createProjectPOST(
      jsonRequest("http://localhost/api/content-projects", "POST", { topicIdeaId: 2147483000 })
    );
    assert.equal(res.status, 404);
    const body = (await res.json()) as { ok: boolean; errors: Record<string, string> };
    assert.equal(body.ok, false);
    assert.equal(body.errors.topicIdeaId, "选题不存在或已删除");
  });
});

/* ==================== 校验与纯函数 ==================== */

describe("校验与策划纯函数", () => {
  test("校验：创建载荷缺 topicIdeaId 被拒", () => {
    const r = validateCreateProject({ contentType: "ai_news" });
    assert.equal(r.ok, false);
  });

  test("校验：PATCH 不接受任何来源字段", () => {
    const r = validateProjectPatch({ source_idea_id: null });
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.source_idea_id);
  });

  test("校验：回读 productionStatus 必须落在枚举内", () => {
    const ok = validateImport({ scriptResult: {}, productionStatus: "已出分镜" });
    assert.equal(ok.ok, true);
    const bad = validateImport({ productionStatus: "随便什么状态" });
    assert.equal(bad.ok, false);
  });

  test("策划生成：只依赖输入，同输入同输出；素材缺失进 openQuestions", () => {
    const input = { topicTitle: "标题", angle: "", sourceMaterial: "", referenceVisuals: "" };
    const a = generateContentPlan(input);
    const b = generateContentPlan(input);
    assert.deepEqual(a, b);
    assert.deepEqual(a.keyPoints, []);
    assert.ok(a.openQuestions.some((q) => q.includes("来源素材")));
    assert.ok(a.openQuestions.some((q) => q.includes("切入角度")));
    assert.ok(a.suggestedDuration >= 30 && a.suggestedDuration <= 180);
  });

  test("策划生成：要点逐句取自 source_material，不新增事实与链接", () => {
    const source = "第一条事实。第二条事实！详见 https://example.com/x";
    const plan = generateContentPlan({
      topicTitle: "标题",
      angle: "从风险切入。",
      sourceMaterial: source,
      referenceVisuals: "参考画面",
    });
    assert.ok(plan.keyPoints.length >= 2);
    for (const p of plan.keyPoints) {
      assert.ok(!p.includes("http"), "要点中不应带链接");
      assert.ok(source.includes(p.replace(/…$/, "").trim()), `要点必须来自原文：${p}`);
    }
    assert.ok(plan.hook.length > 0);
  });
});
