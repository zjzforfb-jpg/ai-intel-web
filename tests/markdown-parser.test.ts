// Markdown 解析器 测试 —— Owner: Agent A（阶段 2）
// 运行：node --env-file=.env.local --import tsx --test --test-concurrency=1 tests/markdown-parser.test.ts
// 覆盖契约 docs/phase2-stageB-interface.md 第 2.6 节要求的全部场景：
//   DeepSeek 旧格式 / MiniMax 新格式 / 核心判断两形态 / 趋势与机会两形态 /
//   中英标点混用 / 空行缩进列表层级 / diagnostics.unparsed / link 提取 / 字段别名映射
import { test } from "node:test";
import assert from "node:assert";
import {
  parseReport,
  parseHeadlineFields,
  extractBareUrl,
  buildToc,
  slugify,
  type ParsedReport,
} from "@/lib/markdown-parser";

/* ------------------------------------------------------------------ */
/* 固定样本                                                            */
/* ------------------------------------------------------------------ */

/** 格式 A：DeepSeek 旧格式（冒号在加粗外，趋势/机会用缩进子条目） */
const REPORT_DEEPSEEK = `# 每日AI情报内参

## 一、今日核心判断

1. **今日AI主线是Agent基础设施的"全栈协同"**：NVIDIA同时强调Vera CPU、HBM内存协同和Omniverse中的AI Agent仿真。
2. **多模态与开放世界模型继续推进，但可核实信息有限**：Google DeepMind发布Gemini Omni 1.2 Flash相关博文。

## 二、今日必读头条

### 1. OpenAI更新Model Spec，强化模型行为规范
- **来源及发布时间**：OpenAI，2026-11-05 15:31 UTC
- **核心事实**：OpenAI发布更新版Model Spec，原文链接为openai.com/index/updated-model-spec/。具体条款变更未给出，**待核实**。
- **深度解读**：Model Spec是OpenAI公开模型行为边界的重要文档。
- **对行业的影响**：头部厂商公开模型规范，会推动企业采购把"行为规范可审计性"纳入评估。
- **原文链接**：https://openai.com/index/updated-model-spec/

### 2. 百度发布ERNIE 5.5 Flash Base
- **来源及发布时间**：ernie.baidu.com，2026-11-05 09:29 UTC
- **核心事实**：百度发布ERNIE 5.5 Flash Base。采集摘要未提供参数规模、许可证、价格，**待核实**。
- **深度解读**：这是今日采集内唯一明确的国内基础模型发布动态。
- **对行业的影响**：国内模型API/开源生态可能增加一个新选项。
- **原文链接**：https://ernie.baidu.com/release/ernie-5-5-flash-base/

## 三、重点领域动态

### 大模型与Agent

- **OpenAI Codex案例**：OpenAI发布客户案例。观点：编程Agent正从个人助手向企业流程工具渗透。

## 四、行业趋势观察

1. **编码Agent竞争转向"代码理解—审查—安全修复"闭环。**
   - 判断依据：OpenAI收购Pierre以扩展Codex的代码构建、理解和审查工具。
   - 观点：单纯补全的差异化下降，工作流完整性成为新竞争点。

2. **长上下文与Agent负载推高内存成本。**
   - 判断依据：NVIDIA明确称更大模型、更长上下文和Agent应用增加GPU内存压力。
   - 观点：模型公司需要把KV cache、上下文压缩纳入核心成本工程。

## 五、开发者与创业者机会

1. **面向编码Agent的本地审计与权限治理层。**
   - 机会来源：Stroq的本地审计定位；企业采用编码Agent后审计需求上升。
   - 实现方向：记录Agent操作链、文件diff、工具调用、权限边界，生成可审计报告。
   - 潜在价值：填补企业采用Agent的信任与合规缺口。

2. **长上下文与Agent推理的内存成本优化工具。**
   - 机会来源：NVIDIA关于GPU内存压力、HBM供应趋紧的表述。
   - 实现方向：做KV cache分析、上下文压缩、请求路由和单位token成本观测。
   - 潜在价值：直接降低推理成本，具备明确ROI。

## 六、明日重点关注

1. **OpenAI Model Spec更新具体条款**：变更内容需核对原文。
`;

/** 格式 B：MiniMax 新格式（冒号在加粗内，趋势/机会字段全部挤在同一行） */
const REPORT_MINIMAX = `# 每日AI情报内参

## 一、今日核心判断

1. **今日AI主线是Agent基础设施的"全栈协同"**：NVIDIA同时强调Vera CPU、HBM内存协同和Omniverse中的AI Agent仿真。
2. **AI开发工具的安全与隐私问题升温**：Claude Code被GitHub issue指称会将用户邮箱地址发送给网站。

## 二、今日必读头条

### 1. New NVIDIA Cosmos 3 Open Models for Interactive World Simulation

- **来源及发布时间**：Hugging Face；2026-11-05 19:35:16 UTC
- **核心事实**：Hugging Face博客出现标题为"New NVIDIA Cosmos 3 Open Models"的文章，主题为交互式世界模拟。给定摘要为空，模型参数、许可证均未提供，待核实。
- **深度解读（观点）**：目前只能确认"开放世界模拟模型"的发布信号，不能仅凭标题判断其性能或开放程度。
- **对行业的影响**：对机器人、游戏、工业仿真和Agent训练有潜在影响。开发者应等待许可与基准后再评估迁移。
- **原文链接**：https://huggingface.co/blog/nvidia/cosmos-interactive-world-simulation

### 2. Claude Code sends your email address to websites

- **来源及发布时间**：GitHub（anthropics/claude-code issue #107757）；2026-11-05 22:17:15 UTC
- **核心事实**：GitHub issue标题称"Claude Code sends your email address to websites"；该条在Hacker News获得1221 points。
- **深度解读（观点）**：AI编程Agent具备网络访问、代码执行和工具调用能力后，PII边界与网络请求审计成为企业采用前提。
- **对行业的影响**：开发者需要审计CLI/IDE Agent的网络行为；企业安全团队可能要求域名白名单、PII脱敏和审计日志。
- **原文链接**：https://github.com/anthropics/claude-code/issues/107757

## 三、重点领域动态

### AI基础设施与芯片

- **NVIDIA Vera CPU**：NVIDIA称Vera面向Agent工作负载提供最高吞吐。观点：Agent执行侧的CPU能力被重新强调。链接：https://blogs.nvidia.com/blog/vera-cpu/

## 四、行业趋势观察

1. **Agent基础设施从"GPU单点"转向全栈协同**。判断依据：NVIDIA Vera CPU强调Agent步骤依赖CPU；内存博客强调长上下文导致GPU内存压力。观点：AI工厂的瓶颈将更分散，厂商宣传需第三方基准验证。
2. **AI安全与平台治理成为采用和监管焦点**。判断依据：Claude Code邮箱地址issue高热。观点：Agent网络行为审计、PII防护需求上升。

## 五、开发者与创业者机会

1. **Agent网络请求审计与PII防泄漏网关**。机会来源：Claude Code邮箱地址issue高热，说明开发者对Agent网络行为缺乏信任。实现方向：为CLI/IDE/浏览器Agent提供网络出口代理、域名白名单、邮箱/令牌脱敏、审计日志。潜在价值：企业安全采购刚需，可降低Agent工具采用门槛。
2. **多模态长片段内容的成本路由与质量评测**。机会来源：Gemini Omni 1.2 Flash标题强调快、低成本、更长片段。实现方向：聚合多家多模态API，按片段长度、质量、价格路由。潜在价值：帮助内容团队降本。

## 六、明日重点关注

1. **NVIDIA Cosmos 3的许可证、参数与评测**：目前只有发布信号。
`;

/* ------------------------------------------------------------------ */
/* 用例                                                                */
/* ------------------------------------------------------------------ */

test("parseReport：空输入返回 null", () => {
  assert.strictEqual(parseReport(null), null);
  assert.strictEqual(parseReport(""), null);
});

test("格式 A（DeepSeek 旧格式）：全章节条目数与子字段", () => {
  const r = parseReport(REPORT_DEEPSEEK) as ParsedReport;
  assert.ok(r);
  assert.strictEqual(r.coreJudgments.length, 2);
  assert.strictEqual(r.headlines.length, 2);
  assert.strictEqual(r.trends.length, 2);
  assert.strictEqual(r.opportunities.length, 2);

  // 头条子字段：冒号在加粗外
  const h = r.headlines[0];
  assert.strictEqual(h.index, 1);
  assert.match(h.title, /Model Spec/);
  assert.match(h.source ?? "", /OpenAI/);
  assert.match(h.coreFact ?? "", /Model Spec/);
  assert.match(h.deepAnalysis ?? "", /行为边界/);
  assert.match(h.impact ?? "", /可审计性/);
  assert.strictEqual(h.link, "https://openai.com/index/updated-model-spec/");

  // 趋势子字段：缩进子条目形态
  assert.match(r.trends[0].title, /编码Agent竞争/);
  assert.match(r.trends[0].basis ?? "", /收购Pierre/);
  assert.match(r.trends[0].viewpoint ?? "", /差异化下降/);

  // 机会子字段：缩进子条目形态
  assert.match(r.opportunities[0].title, /本地审计/);
  assert.match(r.opportunities[0].source ?? "", /Stroq/);
  assert.match(r.opportunities[0].direction ?? "", /文件diff/);
  assert.match(r.opportunities[0].value ?? "", /信任与合规/);
});

test("格式 B（MiniMax 格式）：全章节条目数与子字段", () => {
  const r = parseReport(REPORT_MINIMAX) as ParsedReport;
  assert.ok(r);
  assert.strictEqual(r.coreJudgments.length, 2);
  assert.strictEqual(r.headlines.length, 2);
  assert.strictEqual(r.trends.length, 2);
  assert.strictEqual(r.opportunities.length, 2);

  // 头条：标题为纯英文原名，子字段齐全
  const h = r.headlines[0];
  assert.strictEqual(h.index, 1);
  assert.strictEqual(h.title, "New NVIDIA Cosmos 3 Open Models for Interactive World Simulation");
  assert.match(h.source ?? "", /Hugging Face/);
  assert.match(h.coreFact ?? "", /交互式世界模拟/);
  assert.match(h.deepAnalysis ?? "", /开放世界模拟模型/);
  assert.match(h.impact ?? "", /机器人/);
  assert.strictEqual(h.link, "https://huggingface.co/blog/nvidia/cosmos-interactive-world-simulation");

  // 趋势：字段挤在同一行也能拆出来
  assert.match(r.trends[0].title, /全栈协同/);
  assert.match(r.trends[0].basis ?? "", /Vera CPU/);
  assert.match(r.trends[0].viewpoint ?? "", /第三方基准/);

  // 机会：字段挤在同一行也能拆出来
  assert.match(r.opportunities[0].title, /PII防泄漏网关/);
  assert.match(r.opportunities[0].source ?? "", /邮箱地址issue/);
  assert.match(r.opportunities[0].direction ?? "", /域名白名单/);
  assert.match(r.opportunities[0].value ?? "", /安全采购刚需/);
});

test("双格式解析器产出条目数一致（格式鲁棒性）", () => {
  const a = parseReport(REPORT_DEEPSEEK) as ParsedReport;
  const b = parseReport(REPORT_MINIMAX) as ParsedReport;
  assert.strictEqual(a.headlines.length, b.headlines.length);
  assert.strictEqual(a.trends.length, b.trends.length);
  assert.strictEqual(a.opportunities.length, b.opportunities.length);
  assert.strictEqual(a.coreJudgments.length, b.coreJudgments.length);
});

test("核心判断：编号列表形态", () => {
  const md = `## 一、今日核心判断

1. **第一条判断**：这是详细解释。
2. **第二条判断**：另一段解释。
`;
  const r = parseReport(md) as ParsedReport;
  assert.strictEqual(r.coreJudgments.length, 2);
  assert.match(r.coreJudgments[0].text, /第一条判断/);
  assert.match(r.coreJudgments[0].text, /这是详细解释/);
  assert.match(r.coreJudgments[1].text, /第二条判断/);
});

test("核心判断：散文段落形态（按句末标点切条）", () => {
  const md = `## 一、今日核心判断

今天有两个信号值得关注：一是Agent基础设施开始走向全栈协同，二是安全与隐私成为采用门槛。厂商口径仍需第三方基准验证。
`;
  const r = parseReport(md) as ParsedReport;
  assert.ok(r.coreJudgments.length >= 2, "散文段落应按句切条");
  assert.match(r.coreJudgments[0].text, /全栈协同/);
  assert.match(r.coreJudgments[r.coreJudgments.length - 1].text, /第三方基准/);
});

test("趋势与机会：### 编号标题形态", () => {
  const md = `## 四、行业趋势观察

### 1. 趋势甲

- 判断依据：依据甲内容。
- 观点：观点甲内容。

### 2. 趋势乙

- 判断依据：依据乙内容。
- 观点：观点乙内容。

## 五、开发者与创业者机会

### 1. 机会甲

- 机会来源：来源甲内容。
- 实现方向：方向甲内容。
- 潜在价值：价值甲内容。
`;
  const r = parseReport(md) as ParsedReport;
  assert.strictEqual(r.trends.length, 2);
  assert.strictEqual(r.trends[0].title, "趋势甲");
  assert.strictEqual(r.trends[1].title, "趋势乙");
  assert.match(r.trends[0].basis ?? "", /依据甲/);
  assert.match(r.trends[0].viewpoint ?? "", /观点甲/);
  assert.strictEqual(r.opportunities.length, 1);
  assert.strictEqual(r.opportunities[0].title, "机会甲");
  assert.match(r.opportunities[0].source ?? "", /来源甲/);
  assert.match(r.opportunities[0].direction ?? "", /方向甲/);
  assert.match(r.opportunities[0].value ?? "", /价值甲/);
});

test("中英标点混用：半角冒号 / 冒号在加粗内 / 无加粗三种写法都识别", () => {
  const md = `## 二、今日必读头条

### 1. 标题一

- **核心事实**: 半角冒号内容
- **深度解读：** 冒号在加粗内内容
- 来源及发布时间: 无加粗内容
`;
  const r = parseReport(md) as ParsedReport;
  assert.strictEqual(r.headlines.length, 1);
  const h = r.headlines[0];
  assert.match(h.coreFact ?? "", /半角冒号内容/);
  assert.match(h.deepAnalysis ?? "", /冒号在加粗内内容/);
  assert.match(h.source ?? "", /无加粗内容/);
});

test("字段别名映射：多种别名归一到同一规范字段", () => {
  const fields = parseHeadlineFields([
    "- **来源和时间**：别名来源",
    "- **事实**：别名事实",
    "- **深度分析**：别名深度",
    "- **行业影响**：别名影响",
    "- **链接**：https://example.com/alias",
  ]);
  assert.strictEqual(fields.source, "别名来源");
  assert.strictEqual(fields.coreFact, "别名事实");
  assert.strictEqual(fields.deepAnalysis, "别名深度");
  assert.strictEqual(fields.impact, "别名影响");
  assert.strictEqual(fields.link, "https://example.com/alias");
});

test("字段别名映射：机会与趋势的别名表独立生效", () => {
  const md = `## 四、行业趋势观察

1. **趋势标题**。判断依据：真实依据内容。观点：真实观点内容。

## 五、开发者与创业者机会

1. **机会标题**。实现方向：真实方向内容。潜在价值：真实价值内容。
`;
  const r = parseReport(md) as ParsedReport;
  assert.match(r.trends[0].basis ?? "", /真实依据内容/);
  assert.match(r.trends[0].viewpoint ?? "", /真实观点内容/);
  assert.match(r.opportunities[0].direction ?? "", /真实方向内容/);
  assert.match(r.opportunities[0].value ?? "", /真实价值内容/);
});

test("字段别名映射：短别名（依据/观点/方向/价值）同样生效", () => {
  const md = `## 四、行业趋势观察

1. **趋势标题**。依据：短依据。观点：短观点。

## 五、开发者与创业者机会

1. **机会标题**。方向：短方向。价值：短价值。
`;
  const r = parseReport(md) as ParsedReport;
  assert.match(r.trends[0].basis ?? "", /^短依据/);
  assert.match(r.trends[0].viewpoint ?? "", /^短观点/);
  assert.match(r.opportunities[0].direction ?? "", /^短方向/);
  assert.match(r.opportunities[0].value ?? "", /^短价值/);
});

test("键名带括号后缀：归一化后仍命中别名", () => {
  const fields = parseHeadlineFields([
    "- **深度解读（观点）**：带后缀内容",
    "- **来源及发布时间**：来源内容",
  ]);
  assert.strictEqual(fields.deepAnalysis, "带后缀内容");
  assert.strictEqual(fields.source, "来源内容");
});

test("空行 / 缩进 / 列表层级：子条目仍归属正确条目", () => {
  const md = `## 五、开发者与创业者机会

1. **机会甲**

   - 机会来源：甲的来源

   - 实现方向：甲的方向
   - 潜在价值：甲的价值

2. **机会乙**
   - 机会来源：乙的来源
   - 实现方向：乙的方向
   - 潜在价值：乙的价值
`;
  const r = parseReport(md) as ParsedReport;
  assert.strictEqual(r.opportunities.length, 2);
  assert.strictEqual(r.opportunities[0].title, "机会甲");
  assert.match(r.opportunities[0].source ?? "", /甲的来源/);
  assert.match(r.opportunities[0].direction ?? "", /甲的方向/);
  assert.strictEqual(r.opportunities[1].title, "机会乙");
  assert.match(r.opportunities[1].value ?? "", /乙的价值/);
  assert.doesNotMatch(r.opportunities[1].source ?? "", /甲的来源/);
});

test("嵌套列表：二级列表不被当作新条目", () => {
  const md = `## 四、行业趋势观察

1. **趋势甲**
   - 判断依据：一级依据
     - 二级补充
   - 观点：一级观点
`;
  const r = parseReport(md) as ParsedReport;
  assert.strictEqual(r.trends.length, 1);
  assert.match(r.trends[0].basis ?? "", /一级依据/);
  assert.match(r.trends[0].viewpoint ?? "", /一级观点/);
});

test("diagnostics：识别到章节但 0 条目 → emptySections 与 unparsed 非空", () => {
  const md = `## 二、今日必读头条

这一段没有任何结构化条目，只是普通叙述文字。
`;
  const r = parseReport(md) as ParsedReport;
  assert.strictEqual(r.headlines.length, 0);
  assert.ok(r.diagnostics);
  assert.ok(r.diagnostics.emptySections.some((s) => s.includes("头条")));
  assert.ok(r.diagnostics.unparsed.length > 0);
  assert.ok(r.diagnostics.unparsed[0].reason.length > 0);
});

test("diagnostics：正常样本 unparsed 为空", () => {
  const a = parseReport(REPORT_DEEPSEEK) as ParsedReport;
  const b = parseReport(REPORT_MINIMAX) as ParsedReport;
  assert.strictEqual(a.diagnostics?.unparsed.length, 0);
  assert.strictEqual(b.diagnostics?.unparsed.length, 0);
  assert.strictEqual(a.diagnostics?.emptySections.length, 0);
  assert.strictEqual(b.diagnostics?.emptySections.length, 0);
});

test("diagnostics：混合形态（有条目 + 游离段落）时游离段落进 unparsed", () => {
  const md = `## 四、行业趋势观察

1. **趋势甲**：判断依据：甲依据。观点：甲观点。

这段游离文字不属于任何条目。
`;
  const r = parseReport(md) as ParsedReport;
  assert.strictEqual(r.trends.length, 1);
  assert.ok(r.diagnostics);
  assert.ok(r.diagnostics.unparsed.length > 0);
  assert.match(r.diagnostics.unparsed[0].fragment, /游离文字/);
});

test("extractBareUrl：多种链接形态", () => {
  assert.strictEqual(extractBareUrl("https://example.com/a"), "https://example.com/a");
  assert.strictEqual(extractBareUrl("[点击这里](https://example.com/b)"), "https://example.com/b");
  assert.strictEqual(extractBareUrl("<https://example.com/c>"), "https://example.com/c");
  assert.strictEqual(extractBareUrl("https://example.com/d。"), "https://example.com/d");
  assert.strictEqual(extractBareUrl("详见 https://example.com/e。"), "https://example.com/e");
  assert.strictEqual(extractBareUrl("www.example.com/f"), "https://www.example.com/f");
  assert.strictEqual(extractBareUrl("没有链接"), undefined);
  assert.strictEqual(extractBareUrl(null), undefined);
  // 配对括号保留（Wikipedia 风格）
  assert.strictEqual(
    extractBareUrl("https://en.wikipedia.org/wiki/Foo_(bar)"),
    "https://en.wikipedia.org/wiki/Foo_(bar)"
  );
});

test("头条 link：缺字段行时从原文兜底提取裸 URL", () => {
  const md = `## 二、今日必读头条

### 1. 标题一

- **核心事实**：详情见 https://example.com/fallback
`;
  const r = parseReport(md) as ParsedReport;
  assert.strictEqual(r.headlines.length, 1);
  assert.strictEqual(r.headlines[0].link, "https://example.com/fallback");
});

test("头条 link：Markdown 链接语法被还原为裸 URL", () => {
  const md = `## 二、今日必读头条

### 1. 标题一

- **原文链接**：[原文](https://example.com/md-link)
`;
  const r = parseReport(md) as ParsedReport;
  assert.strictEqual(r.headlines[0].link, "https://example.com/md-link");
});

test("未知字段进 extra 且不丢弃原文；无加粗普通行不污染 extra", () => {
  const fields = parseHeadlineFields([
    "- **一个未知字段**：未知值",
    "- 普通说明：不该进 extra",
  ]);
  assert.strictEqual(fields.extra["一个未知字段"], "未知值");
  assert.strictEqual(fields.extra["普通说明"], undefined);
  assert.strictEqual(Object.keys(fields.extra).length, 1);
});

test("parseHeadlineFields：空数组与非法输入返回空结果", () => {
  assert.deepStrictEqual(parseHeadlineFields([]), { extra: {} });
  const bad = parseHeadlineFields(undefined as unknown as string[]);
  assert.deepStrictEqual(bad, { extra: {} });
});

test("buildToc / slugify：锚点唯一且稳定", () => {
  const toc = buildToc(REPORT_DEEPSEEK);
  assert.ok(toc.length > 0);
  const ids = toc.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, ids.length, "锚点不得重复");
  assert.ok(ids.includes("一-今日核心判断"));
  assert.strictEqual(slugify("一、今日核心判断"), "一-今日核心判断");
  assert.strictEqual(slugify("**加粗**"), "加粗");
  assert.strictEqual(slugify("!!!"), "section");
});
