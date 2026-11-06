// 阶段 D 辅助：验证 headlines_field_coverage 能捕获「格式漂移」
// 构造三种样本，确认覆盖率会随格式劣化而下降：
//   1. 正常格式（冒号在加粗外）：- **来源及发布时间**：xxx        → 覆盖 100%
//   2. 冒号在加粗内：- **来源及发布时间：** xxx                   → 仍算命中
//      （TS 侧 parseFieldLine 同样能剥掉加粗识别出来，这里保持一致，不算漂移）
//   3. 字段名漂移（模型自创字段名）                                → 覆盖 0%
//   4. 完全无字段（只有标题）                                      → 覆盖 0%
// 用法：node --env-file=.env.local --import tsx scripts/phase2-verify-drift.mts
import { readFileSync } from "node:fs";

const code = readFileSync("/tmp/n8n-verify/format-node.js", "utf8");

function buildReport(head: string): string {
  return [
    "# 每日AI情报内参",
    "",
    "> 报告日期：2026-11-06；采集10条",
    "",
    "## 一、今日核心判断",
    "",
    "1. 测试结论一。",
    "2. 测试结论二。",
    "",
    "## 二、今日必读头条",
    "",
    head,
    "",
    "## 三、重点领域动态",
    "",
    "### 大模型与Agent",
    "",
    "- 一些动态。",
    "",
    "## 四、行业趋势观察",
    "",
    "1. **趋势一**",
    "   - 判断依据：测试。",
    "",
    "## 五、开发者与创业者机会",
    "",
    "1. **机会一**",
    "   - 机会来源：测试。",
    "",
    "## 六、明日重点关注",
    "",
    "1. 明日事项。",
  ].join("\n");
}

const GOOD = [
  "### 1. 测试头条一",
  "- **来源及发布时间**：OpenAI，2026-11-06",
  "- **核心事实**：这是一条事实。",
  "- **深度解读**：这是一段解读。",
  "- **对行业的影响**：这是一段影响。",
  "- **原文链接**：https://example.com/a",
  "",
  "### 2. 测试头条二",
  "- **来源及发布时间**：Google，2026-11-06",
  "- **核心事实**：这是第二条事实。",
  "- **深度解读**：这是第二段解读。",
  "- **对行业的影响**：这是第二段影响。",
  "- **原文链接**：https://example.com/b",
].join("\n");

// 冒号写进加粗内部（TS 解析器能兼容，覆盖率应保持 100%）
const COLON_INSIDE_BOLD = GOOD.replace(/\*\*：/g, "：**");

// 模型自创字段名 —— 这才是真正的格式漂移，覆盖率必须掉到 0
const RENAMED = GOOD.replace(/来源及发布时间/g, "出处")
  .replace(/核心事实/g, "事件经过")
  .replace(/深度解读/g, "我的看法")
  .replace(/对行业的影响/g, "行业意义")
  .replace(/原文链接/g, "参考地址");

const BARE = [
  "### 1. 测试头条一",
  "这条只有一个标题，没有任何结构化字段。",
  "",
  "### 2. 测试头条二",
  "这条也是。",
].join("\n");

const cases: Array<[string, string, number]> = [
  ["正常格式（冒号在加粗外）", GOOD, 1],
  ["冒号在加粗内（解析器兼容）", COLON_INSIDE_BOLD, 1],
  ["字段名漂移（模型自创名称）", RENAMED, 0],
  ["无字段（只有标题）", BARE, 0],
];

let failed = 0;
for (const [label, head, expect] of cases) {
  const md = buildReport(head);
  const items = [{ json: { text: md, report_date: "2026-11-06", total_articles: 10, headline_count: 2 } }];
  const $input = { all: () => items, first: () => items[0] };
  const fn = new Function("$input", "$json", "$", `return (async () => { ${code}\n })();`);
  const $ = (_n: string) => ({ first: () => ({ json: items[0].json }) });
  try {
    const out = await fn($input, items[0].json, $);
    const v = out?.[0]?.json?.validation ?? {};
    const got = v.headlines_field_coverage;
    const ok = got === expect;
    if (!ok) failed++;
    console.log(`${ok ? "✓" : "✗"} ${label}: 覆盖率=${got}（期望 ${expect}）有字段=${v.headlines_with_fields}/${v.headline_count}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${label}: 执行失败 - ${(e as Error).message}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
