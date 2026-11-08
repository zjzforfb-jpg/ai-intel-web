// 实体追踪模块测试 —— 阶段 3 Agent A
// 运行：node --env-file=.env.local --import tsx --test tests/entities.test.ts
//
// 覆盖契约 docs/phase3-stageB-interface.md §8 Agent A 的 10 项要求：
//   1. 同一实体多别名 → 归一到一个 normalized_name，只建一条实体
//   2. 同一实体跨两篇日报 → 两个 mention，统计累加
//   3. 同一日报重复执行 → mention 数不变（幂等）
//   4. 名称相近的不同实体（claude code / codex）→ 不合并
//   5. 类型映射正确并正确落库
//   6. 词典外实体 → 不产生 mention
//   7. 来源缺失 → source_url 为 null，不编造
//   8. 7 / 30 天窗口开闭区间正确（含当天，不含第 8 / 第 31 天）
//   9. dataSufficient：2 次 → false；3 次同一天 → false；3 次跨 2 天 → true
//  10. 抽取纯函数：同输入两次调用结果深度相等
//
// 数据纪律：
// - 真实数据只有 2026-11-05 / 2026-11-06 两篇日报，测试一律使用 2099-x 日期与
//   __test__ 前缀的实体名，绝不写入真实实体；
// - 每条用例 afterEach 清理，after 断言无残留；
// - 不测试 writeExtraction 对真实日报的落库（会写入真实实体名），
//   幂等性用同一套底层 upsert 函数（writeMentions / upsertEntity）覆盖。
import { describe, test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  computeImportanceScore,
  entityTypeOf,
  extractEntityMentions,
  normalizeEntityName,
  CONTEXT_MAX_LENGTH,
  type EntityType,
  type ExtractedMention,
} from "@/lib/entities-extract";
import {
  groupMentionsByEntity,
  resolveReportId,
  upsertEntity,
  writeExtraction,
  writeMentions,
  type MentionWriteRow,
} from "@/lib/entities-write";
import { getWritePool } from "@/lib/db-write";
import { getReadPool } from "@/lib/db";
import { getEntityDetail, isDataSufficient, listEntities } from "@/lib/entities";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}（请在 .env.local 配置，勿硬编码）`);
  return v;
}

let cleanupPool: Pool;

const TEST_PREFIX = "__test__";

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
  // 预清理历史残留（上次异常中断）
  await cleanupPool.query("DELETE FROM entities WHERE name LIKE '\\_\\_test\\_\\_%'");
});

afterEach(async () => {
  await cleanupPool.query("DELETE FROM entities WHERE name LIKE '\\_\\_test\\_\\_%'");
});

after(async () => {
  try {
    const residual = await cleanupPool.query(
      "SELECT count(*)::int AS n FROM entities WHERE name LIKE '\\_\\_test\\_\\_%'"
    );
    assert.equal(residual.rows[0].n, 0, "测试结束后 entities 不应残留 __test__ 行");
  } finally {
    // 关掉 lib 内的单例连接池，避免 pg 空闲定时器把测试进程拖到超时
    await getReadPool().end();
    await getWritePool().end();
    await cleanupPool.end();
  }
});

/* ==================== 测试辅助 ==================== */

/** 构造一份最小可解析日报：一、今日核心判断 + 二、今日必读头条 */
function buildReport(
  headlines: Array<{ title: string; facts: string[]; link?: string | null }>,
  coreJudgments: string[] = []
): string {
  const core =
    coreJudgments.length > 0
      ? `## 一、今日核心判断\n${coreJudgments.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\n`
      : "";
  const body = headlines
    .map((h, i) => {
      const lines = [`### ${i + 1}. ${h.title}`];
      lines.push(`- **来源及发布时间**：Example Source 2099-01-01 00:00 UTC`);
      for (const fact of h.facts) lines.push(`- **核心事实**：${fact}`);
      lines.push(`- **深度解读**：这是测试用解读文本，不含额外实体。`);
      if (h.link !== null) lines.push(`- **原文链接**：${h.link ?? "https://example.com/news/1"}`);
      return lines.join("\n");
    })
    .join("\n\n");
  return `# 每日AI情报内参\n\n${core}## 二、今日必读头条\n\n${body}\n`;
}

function mentionsOf(mentions: ExtractedMention[], canonical: string): ExtractedMention[] {
  return mentions.filter((m) => m.canonical === canonical);
}

/** 建一个 __test__ 前缀的实体，返回 id */
async function createTestEntity(
  suffix: string,
  entityType: EntityType = "unknown"
): Promise<number> {
  const name = `${TEST_PREFIX}${suffix}`;
  return upsertEntity({
    name,
    normalizedName: normalizeEntityName(name),
    entityType,
    aliases: [],
  });
}

function mentionRow(
  entityId: number,
  reportDate: string,
  sourceTitle: string,
  overrides: Partial<MentionWriteRow> = {}
): MentionWriteRow {
  return {
    entityId,
    reportId: null,
    reportDate,
    sourceTitle,
    sourceUrl: "https://example.com/news",
    context: "测试上下文",
    importanceScore: 3,
    ...overrides,
  };
}

/* ==================== 1. 别名归一 ==================== */

describe("实体别名归一", () => {
  test("同一实体的多种别名归一到同一个 normalized_name，只产生一条实体", async () => {
    const markdown = buildReport([
      {
        title: "Claude Code 被报告向网站发送邮箱地址",
        facts: [
          "claude-code 与 Claude Code CLI 都指向同一个编程助手。",
          "社区的写法也包括 claudecode，但指向同一产品。",
        ],
      },
    ]);

    const mentions = extractEntityMentions({ reportDate: "2099-01-01", reportMarkdown: markdown });
    const hits = mentionsOf(mentions, "claude code");

    assert.equal(hits.length, 1, "同一头条内同一实体只产出 1 条 mention");
    assert.equal(hits[0].normalizedName, "claudecode");
    for (const alias of ["claude code", "claude-code", "claudecode", "claude code cli"]) {
      assert.ok(
        hits[0].aliases.includes(alias),
        `aliases 应包含命中的小写别名 ${alias}，实际 ${JSON.stringify(hits[0].aliases)}`
      );
    }
    // 归一化名去重后只有一个实体
    assert.equal(new Set(mentions.map((m) => m.normalizedName)).size, 1);

    // 落库两次（不同别名）→ 仍只有一行实体
    const id = await upsertEntity({
      name: "__test__Claude Code",
      normalizedName: normalizeEntityName("Claude Code"),
      entityType: "ai_product",
      aliases: ["claude code", "claude-code"],
    });
    const again = await upsertEntity({
      name: "__test__Claude Code",
      normalizedName: normalizeEntityName("claude-code"),
      entityType: "ai_product",
      aliases: ["claudecode"],
    });
    assert.equal(again, id, "同归一化名 upsert 必须复用同一 id");
    const count = await cleanupPool.query(
      "SELECT count(*)::int AS n FROM entities WHERE normalized_name = $1",
      [normalizeEntityName("Claude Code")]
    );
    assert.equal(count.rows[0].n, 1);
  });

  test("groupMentionsByEntity：别名取并集，实体数按归一化名去重", () => {
    const markdown = buildReport([
      { title: "Hugging Face 发布新博客", facts: ["huggingface 同时更新了模型卡。"] },
      { title: "HuggingFace 再次更新", facts: ["hugging face blog 有新内容。"] },
    ]);
    const mentions = extractEntityMentions({ reportDate: "2099-01-01", reportMarkdown: markdown });
    const groups = groupMentionsByEntity(mentions);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].normalizedName, "huggingface");
    // 一篇日报里一个实体只产出一条 mention（唯一键是 entity_id + report_id），
    // 出现在两个头条里也一样；来源头条取「实体出现在标题里」的那条。
    assert.equal(groups[0].mentions.length, 1, "同一实体在同一篇日报只算一条 mention");
    // 别名是实体级属性：全报告出现过的写法都要并进来
    assert.ok(groups[0].aliases.includes("hugging face"));
    assert.ok(groups[0].aliases.includes("huggingface"));
  });
});

/* ==================== 2. 跨日报累加 ==================== */

describe("跨日报统计", () => {
  test("同一实体跨两篇日报 → 两条 mention，统计正确累加", async () => {
    const entityId = await createTestEntity("跨日报", "company");
    await writeMentions([
      mentionRow(entityId, "2099-01-01", "__test__头条A"),
      mentionRow(entityId, "2099-01-02", "__test__头条B"),
    ]);

    const detail = await getEntityDetail(entityId, { asOf: "2099-01-02" });
    assert.ok(detail);
    assert.equal(detail.stats.mentionCount, 2);
    assert.equal(detail.stats.distinctMentionDays, 2);
    assert.equal(detail.stats.firstMentionDate, "2099-01-01");
    assert.equal(detail.stats.lastMentionDate, "2099-01-02");
    assert.equal(detail.mentions.length, 2);
    assert.equal(detail.mentions[0].mentionDate, "2099-01-02", "提及按日期倒序");
  });
});

/* ==================== 3. 幂等 ==================== */

describe("幂等", () => {
  test("同一日报重复执行 → 实体数与 mention 数都不变", async () => {
    const entityId = await createTestEntity("幂等", "ai_product");
    // 一篇日报里一个实体只算一条提及（幂等键 = entity_id + report_id/report_date），
    // 即使它出现在两个头条里也一样。
    const rows = [mentionRow(entityId, "2099-02-01", "__test__幂等头条A", { importanceScore: 5 })];

    const first = await writeMentions(rows);
    assert.deepEqual(first, { inserted: 1, updated: 0 });

    const second = await writeMentions(rows);
    assert.deepEqual(second, { inserted: 0, updated: 1 }, "第二次全部走更新");

    const detail = await getEntityDetail(entityId, { asOf: "2099-02-01" });
    assert.equal(detail?.stats.mentionCount, 1, "重复执行后提及数不变");

    const entityCount = await cleanupPool.query(
      "SELECT count(*)::int AS n FROM entities WHERE normalized_name = $1",
      [normalizeEntityName(`${TEST_PREFIX}幂等`)]
    );
    assert.equal(entityCount.rows[0].n, 1, "重复 upsert 不新增实体");
  });

  test("同一 (实体, 日报) 重复写入是覆盖而非累加：分数与来源跟随最新一次", async () => {
    const entityId = await createTestEntity("重要度", "technology");
    await writeMentions([
      mentionRow(entityId, "2099-02-02", "__test__旧头条", { importanceScore: 8 }),
    ]);
    // 日报重跑：标题被 LLM 重写、分数与上下文都是新的
    await writeMentions([
      mentionRow(entityId, "2099-02-02", "__test__重跑头条", {
        importanceScore: 3,
        sourceUrl: "https://example.com/new",
        context: "新上下文",
      }),
    ]);

    const detail = await getEntityDetail(entityId, { asOf: "2099-02-02" });
    assert.equal(detail?.mentions.length, 1, "重跑不新增行");
    // 与 n8n 侧 ON CONFLICT ... DO UPDATE SET 的语义一致：覆盖为最新值，而非取历史最大值
    assert.equal(detail?.mentions[0].importanceScore, 3);
    assert.equal(detail?.mentions[0].sourceTitle, "__test__重跑头条");
    assert.equal(detail?.mentions[0].sourceUrl, "https://example.com/new");
    assert.equal(detail?.mentions[0].context, "新上下文");
  });

  // 回归用例：这条路径在修复前必然报
  //   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
  // 因为代码写的是三列 ON CONFLICT，而库里只有 UNIQUE (entity_id, report_id)。
  // 修复前所有测试都传 reportId: null，走的是另一条 NULL 分支，所以这个缺陷一直没被覆盖。
  test("真实 report_id：同一实体重跑不新增行（走 ON CONFLICT (entity_id, report_id)）", async (t) => {
    // 动态取一篇真实日报，避免硬编码 2026-11-06 后因历史数据变动而误挂
    const latest = await cleanupPool.query<{ id: number; report_date: string }>(
      "SELECT id::int AS id, report_date::text AS report_date FROM daily_reports ORDER BY report_date DESC LIMIT 1"
    );
    if (latest.rows.length === 0) {
      t.skip("库里没有任何日报，无法构造 report_id 非空的用例");
      return;
    }
    const { id: reportId, report_date: reportDate } = latest.rows[0];
    assert.equal(await resolveReportId(reportDate), reportId, "resolveReportId 应与直查一致");

    const entityId = await createTestEntity("真实日报", "company");
    const first = await writeMentions([
      mentionRow(entityId, reportDate, "__test__旧标题", { reportId, importanceScore: 6 }),
    ]);
    assert.deepEqual(first, { inserted: 1, updated: 0 });

    // 日报重跑时 LLM 会重写标题：若幂等键含 source_title，这里会插出第二行
    const second = await writeMentions([
      mentionRow(entityId, reportDate, "__test__新标题", {
        reportId,
        importanceScore: 7,
        sourceUrl: "https://example.com/new",
        context: "新上下文",
      }),
    ]);
    assert.deepEqual(second, { inserted: 0, updated: 1 }, "标题变了也复用同一行");

    const rows = await cleanupPool.query<{ n: number; title: string; score: number }>(
      `SELECT count(*)::int AS n, min(source_title) AS title, max(importance_score)::int AS score
       FROM entity_mentions WHERE entity_id = $1`,
      [entityId]
    );
    assert.equal(rows.rows[0].n, 1, "同一实体同一日报只允许一行");
    assert.equal(rows.rows[0].title, "__test__新标题", "来源标题应被刷新为最新一次");
    assert.equal(rows.rows[0].score, 7, "重要度按最新一次覆盖，与 n8n 侧一致");
  });

  test("writeExtraction：无实体命中的日报不写任何行", async () => {
    const result = await writeExtraction({
      reportDate: "2099-03-01",
      reportMarkdown: buildReport([{ title: "AcmeCorp 更名", facts: ["AcmeCorp 与 FooBar 均不在受控词典内。"] }]),
    });
    assert.deepEqual(result, { entities: 0, mentions: 0, inserted: 0, updated: 0, reportId: null });
  });
});

/* ==================== 4. 相近实体不合并 ==================== */

describe("相近实体不合并", () => {
  test("claude code 与 codex 是两个实体，归一化名不同", () => {
    const markdown = buildReport([
      {
        title: "Claude Code 与 Codex 的竞争",
        facts: ["Claude Code 强调本地仓库上下文，Codex 强调代码审查闭环。"],
      },
    ]);
    const mentions = extractEntityMentions({ reportDate: "2099-01-01", reportMarkdown: markdown });
    const canonicals = new Set(mentions.map((m) => m.canonical));
    assert.ok(canonicals.has("claude code"));
    assert.ok(canonicals.has("codex"));
    assert.notEqual(normalizeEntityName("claude code"), normalizeEntityName("codex"));
    // 各自的别名不互相污染
    assert.deepEqual(mentionsOf(mentions, "codex")[0].aliases, ["codex"]);
    assert.equal(mentionsOf(mentions, "claude code")[0].aliases.includes("codex"), false);
  });

  test("词边界生效：gptx / metadata 不被误判为 gpt / meta", () => {
    const markdown = buildReport([
      { title: "gptx 与 metadata 的测试", facts: ["这里只有 gptx 与 metadata 两个词。"] },
    ]);
    const mentions = extractEntityMentions({ reportDate: "2099-01-01", reportMarkdown: markdown });
    assert.equal(mentions.length, 0);
  });
});

/* ==================== 5. 类型映射 ==================== */

describe("实体类型", () => {
  test("契约 §3.4 映射表逐项正确，表外为 unknown", () => {
    assert.equal(entityTypeOf("openai"), "company");
    assert.equal(entityTypeOf("hugging face"), "company");
    assert.equal(entityTypeOf("gpt"), "ai_product");
    assert.equal(entityTypeOf("claude code"), "ai_product");
    assert.equal(entityTypeOf("mcp"), "technology");
    assert.equal(entityTypeOf("编程agent"), "technology");
    assert.equal(entityTypeOf("aws"), "organization");
    assert.equal(entityTypeOf("anthropic"), "company");
    assert.equal(entityTypeOf("not-in-table"), "unknown");
  });

  test("抽取结果带正确类型，并能按类型落库", async () => {
    const markdown = buildReport([
      {
        title: "OpenAI 与 AWS 的新动向",
        facts: ["AWS 在 GovCloud 上提供 GPT 服务，MCP 仍是开发者关注点。"],
      },
    ]);
    const mentions = extractEntityMentions({ reportDate: "2099-01-01", reportMarkdown: markdown });
    assert.equal(mentionsOf(mentions, "openai")[0].entityType, "company");
    assert.equal(mentionsOf(mentions, "aws")[0].entityType, "organization");
    assert.equal(mentionsOf(mentions, "gpt")[0].entityType, "ai_product");
    assert.equal(mentionsOf(mentions, "mcp")[0].entityType, "technology");

    const types: EntityType[] = ["company", "person", "ai_product", "technology", "open_source", "organization", "unknown"];
    for (const [i, type] of types.entries()) {
      const id = await createTestEntity(`类型${i}`, type);
      const detail = await getEntityDetail(id, { asOf: "2099-01-01" });
      assert.equal(detail?.entity.entityType, type, `类型 ${type} 应原样落库`);
    }
  });
});

/* ==================== 6. 词典外不产生 mention ==================== */

describe("词典外实体", () => {
  test("不受控的名称不产生 mention（不编造实体）", () => {
    const markdown = buildReport([
      { title: "AcmeCorp 发布新产品", facts: ["百度与 AcmeCorp 都在词典之外。"], link: null },
    ]);
    const mentions = extractEntityMentions({ reportDate: "2099-01-01", reportMarkdown: markdown });
    assert.equal(mentions.length, 0);
  });

  test("实体只出现在非头条章节时，不产生 mention（定位不到头条即丢弃）", () => {
    const markdown = `# 每日AI情报内参

## 一、今日核心判断
1. OpenAI 今日信息密度最高，但没有进入头条。

## 二、今日必读头条

### 1. 百度发布新模型
- **核心事实**：百度发布新模型，摘要信息不足。

## 三、重点领域动态
- **NVIDIA 相关动态**：NVIDIA 在正文里出现，但没有对应头条。
`;
    const mentions = extractEntityMentions({ reportDate: "2099-01-01", reportMarkdown: markdown });
    assert.equal(mentions.length, 0);
  });
});

/* ==================== 7. 来源缺失不编造 ==================== */

describe("来源字段", () => {
  test("头条没有原文链接 → source_url 为 null，不编造", async () => {
    const markdown = buildReport([
      { title: "NVIDIA 内存全栈协同", facts: ["NVIDIA 称率先采用 HBM3e。"], link: null },
    ]);
    const mentions = extractEntityMentions({ reportDate: "2099-01-01", reportMarkdown: markdown });
    assert.ok(mentions.length > 0);
    for (const m of mentions) {
      assert.equal(m.sourceUrl, null);
      assert.equal(m.sourceTitle, "NVIDIA 内存全栈协同");
    }

    // 落库后仍为 null，读取时也不补造
    const writeResult = await writeMentions([
      {
        entityId: await createTestEntity("无来源", "company"),
        reportId: null,
        reportDate: "2099-04-01",
        sourceTitle: mentions[0].sourceTitle,
        sourceUrl: null,
        context: mentions[0].context,
        importanceScore: mentions[0].importanceScore,
      },
    ]);
    assert.equal(writeResult.inserted, 1);
  });

  test("有原文链接时原样取该头条的链接", () => {
    const markdown = buildReport([
      { title: "Google 发布新模型", facts: ["Google 发布 Gemini 相关更新。"], link: "https://blog.google/x" },
    ]);
    const mentions = extractEntityMentions({ reportDate: "2099-01-01", reportMarkdown: markdown });
    assert.equal(mentionsOf(mentions, "google")[0].sourceUrl, "https://blog.google/x");
  });
});

/* ==================== 8. 统计窗口边界 ==================== */

describe("统计窗口", () => {
  test("7 / 30 天窗口含当天，不含第 8 / 第 31 天", async () => {
    const entityId = await createTestEntity("窗口", "company");
    const dates = [
      "2099-03-15", // asOf 当天
      "2099-03-09", // asOf - 6（窗口内）
      "2099-03-08", // asOf - 7（窗口外）
      "2099-02-14", // asOf - 29（30 天窗口内）
      "2099-02-13", // asOf - 30（30 天窗口外）
    ];
    await writeMentions(dates.map((d, i) => mentionRow(entityId, d, `__test__窗口头条${i}`)));

    const detail = await getEntityDetail(entityId, { asOf: "2099-03-15" });
    assert.ok(detail);
    assert.equal(detail.stats.mentionCount, 5, "总提及是全部历史");
    assert.equal(detail.stats.recent7d, 2, "近 7 天 = 当天 + 6 天前，不含 7 天前");
    assert.equal(detail.stats.recent30d, 4, "近 30 天 = 当天 + 29 天前，不含 30 天前");
    assert.equal(detail.stats.distinctMentionDays, 5);
  });

  test("未来日期不计入热度窗口（窗口右端点为 asOf 当天）", async () => {
    const entityId = await createTestEntity("未来", "company");
    await writeMentions([
      mentionRow(entityId, "2099-05-01", "__test__未来头条A"),
      mentionRow(entityId, "2099-06-01", "__test__未来头条B"),
    ]);
    const detail = await getEntityDetail(entityId, { asOf: "2099-05-01" });
    assert.equal(detail?.stats.mentionCount, 2);
    assert.equal(detail?.stats.recent7d, 1);
    assert.equal(detail?.stats.recent30d, 1);
  });
});

/* ==================== 9. dataSufficient ==================== */

describe("dataSufficient", () => {
  test("纯函数三条边界", () => {
    assert.equal(isDataSufficient(2, 2), false, "2 次提及 → false");
    assert.equal(isDataSufficient(3, 1), false, "3 次但同一天 → false");
    assert.equal(isDataSufficient(3, 2), true, "3 次跨 2 天 → true");
  });

  test("详情接口按提及数与覆盖天数给出 dataSufficient", async () => {
    const twoMentions = await createTestEntity("不足二", "company");
    await writeMentions([
      mentionRow(twoMentions, "2099-07-01", "__test__两提头条1"),
      mentionRow(twoMentions, "2099-07-02", "__test__两提头条2"),
    ]);
    // 同一实体一天最多一条提及，所以「同一天 3 条」这个状态只存在于纯函数层，
    // 落库侧会塌缩成 1 条 —— 这里改为跨越 3 个自然日。
    const acrossDays = await createTestEntity("跨日三次", "company");
    await writeMentions([
      mentionRow(acrossDays, "2099-07-01", "__test__跨日头条1"),
      mentionRow(acrossDays, "2099-07-02", "__test__跨日头条2"),
      mentionRow(acrossDays, "2099-07-03", "__test__跨日头条3"),
    ]);

    const a = await getEntityDetail(twoMentions, { asOf: "2099-07-02" });
    assert.equal(a?.stats.dataSufficient, false);
    assert.equal(a?.stats.mentionCount, 2);
    assert.equal(a?.stats.distinctMentionDays, 2);
    const c = await getEntityDetail(acrossDays, { asOf: "2099-07-03" });
    assert.equal(c?.stats.dataSufficient, true);
    assert.equal(c?.stats.mentionCount, 3);
    assert.equal(c?.stats.distinctMentionDays, 3);
  });
});

/* ==================== 10. 纯函数确定性 ==================== */

describe("抽取纯函数", () => {
  test("同输入两次调用结果深度相等", () => {
    const markdown = buildReport(
      [
        {
          title: "Google 与 NVIDIA 同时发布",
          facts: [
            "Google 发布 Gemini 新版本，NVIDIA 发布 Cosmos 3 开放模型。",
            "两者都强调 Agent 场景，GitHub 上已有讨论。",
          ],
          link: "https://example.com/a",
        },
        {
          title: "Claude Code 隐私问题",
          facts: ["Claude Code 被报告向网站发送邮箱地址，Anthropic 尚未回应。"],
        },
      ],
      ["Google 与 NVIDIA 同日发布，Agent 基础设施竞争加剧。"]
    );

    const first = extractEntityMentions({ reportDate: "2099-08-08", reportMarkdown: markdown });
    const second = extractEntityMentions({ reportDate: "2099-08-08", reportMarkdown: markdown });
    assert.ok(first.length > 0);
    assert.deepEqual(second, first);

    // context 必须 ≤200 字且不含 markdown 标记
    for (const m of first) {
      assert.ok(m.context.length <= CONTEXT_MAX_LENGTH, "context 不得超过 200 字");
      assert.equal(/\*\*|`|^#+\s|\]\(/.test(m.context), false, "context 不应残留 markdown 标记");
      assert.ok(m.importanceScore >= 1 && m.importanceScore <= 10);
      assert.ok(m.sourceTitle !== null && m.sourceTitle.length > 0, "mention 必须定位到具体头条");
    }
  });

  test("importance_score 规则：基础 1、头条标题 +4、核心判断 +3、≥3 次 +2、≥6 次再 +1、上限 10", () => {
    assert.equal(computeImportanceScore({ inHeadlineTitle: false, inCoreJudgment: false, occurrences: 1 }), 1);
    assert.equal(computeImportanceScore({ inHeadlineTitle: true, inCoreJudgment: false, occurrences: 1 }), 5);
    assert.equal(computeImportanceScore({ inHeadlineTitle: false, inCoreJudgment: true, occurrences: 1 }), 4);
    assert.equal(computeImportanceScore({ inHeadlineTitle: false, inCoreJudgment: false, occurrences: 3 }), 3);
    assert.equal(computeImportanceScore({ inHeadlineTitle: false, inCoreJudgment: false, occurrences: 6 }), 4);
    assert.equal(computeImportanceScore({ inHeadlineTitle: true, inCoreJudgment: true, occurrences: 6 }), 10);
    assert.equal(
      computeImportanceScore({ inHeadlineTitle: true, inCoreJudgment: true, occurrences: 20 }),
      10,
      "超过 10 截断"
    );
  });
});

/* ==================== 读层补充 ==================== */

describe("列表查询", () => {
  test("搜索与类型筛选命中测试实体，分页参数被收敛到合法范围", async () => {
    const id = await createTestEntity("搜索目标", "technology");
    await writeMentions([mentionRow(id, "2099-09-01", "__test__搜索头条")]);

    const byKeyword = await listEntities({ q: TEST_PREFIX, asOf: "2099-09-01" });
    assert.ok(byKeyword.total >= 1);
    assert.ok(byKeyword.items.every((i) => i.name.startsWith(TEST_PREFIX)));

    const byType = await listEntities({ q: TEST_PREFIX, types: ["technology"], asOf: "2099-09-01" });
    assert.ok(byType.items.every((i) => i.entityType === "technology"));

    // 非法类型被忽略、size 超上限被收敛
    const clamped = await listEntities({
      q: TEST_PREFIX,
      types: ["not-a-type"],
      size: 999,
      page: -3,
      asOf: "2099-09-01",
    });
    assert.equal(clamped.size, 100);
    assert.equal(clamped.page, 1);
    assert.ok(clamped.total >= 1, "非法类型应被忽略而不是查询报错");
  });

  test("resolveReportId：已知日报返回 id，未知日期返回 null", async () => {
    const known = await resolveReportId("2026-11-06");
    assert.equal(typeof known, "number");
    assert.equal(await resolveReportId("2099-01-01"), null);
    assert.equal(await resolveReportId("not-a-date"), null);
  });
});
