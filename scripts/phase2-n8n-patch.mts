#!/usr/bin/env node
// 阶段 D · n8n 工作流改造脚本（主控施工用）
//
// 用法：
//   node --import tsx scripts/phase2-n8n-patch.mts apply      # 应用改造，生成新版本
//   node --import tsx scripts/phase2-n8n-patch.mts inspect   # 只打印将要做的改动
//
// 前提：容器已停止，/tmp/n8n-edit/database.sqlite 是最新快照。
//
// 改造项（对应 docs/phase2-stageD-n8n-plan.md）：
//   施工项 3：日报 prompt 稳定化 —— 追加【条目格式约定】
//   施工项 4：结构校验增强 —— 移植 FIELD_ALIASES，统计 headlines_field_coverage
//   施工项 5：选题/商机写入去重 —— 查库 → 语义去重 Code → 分支写入
//
// 产出：新 versionId + 更新 workflow_entity.versionId / activeVersionId
//      + workflow_published_version.publishedVersionId（即「发布」）

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const DB_DIR = "/tmp/n8n-edit";
const DB = `${DB_DIR}/database.sqlite`;
const WF_ID = "ZtIAVVtWmcPLXywX";
const OLD_VERSION = "ca9fa476-8ec1-4653-9dd5-f89902727cd0";

const mode = process.argv[2] ?? "inspect";

function sh(cmd: string, input?: string): string {
  return execSync(cmd, {
    encoding: "utf-8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    input,
  }).trim();
}

// 用 stdin 传 SQL，避免 markdown 反引号 / 单引号经 shell 传参时被截断。
function sqlite(sql: string): string {
  return sh(`cd ${DB_DIR} && sqlite3 database.sqlite`, `${sql}\n`);
}

/**
 * 把任意字符串转成 SQLite 单引号字面量。
 * 不能用 JSON.stringify：sqlite3 会把 "..." 当成标识符，JSON 里的 \" 是非法转义。
 * 单引号字符串里只有 ' 需要转义成 ''，JSON 的双引号与反斜杠都保持字面量，
 * 写回 TEXT 列后再被 JSON.parse 解析时结果完全一致。
 */
function sqlLit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/* ------------------------------------------------------------------ */
/* 读取当前版本                                                        */
/* ------------------------------------------------------------------ */

const nodesRaw = sqlite(
  `SELECT nodes FROM workflow_history WHERE versionId='${OLD_VERSION}'`
);
const connsRaw = sqlite(
  `SELECT connections FROM workflow_history WHERE versionId='${OLD_VERSION}'`
);
const nodes = JSON.parse(nodesRaw) as any[];
const connections = JSON.parse(connsRaw) as Record<string, any>;

/* ------------------------------------------------------------------ */
/* 施工项 3：prompt 稳定化                                             */
/* ------------------------------------------------------------------ */

// ⚠️ 这段补丁会拼进 n8n 的 prompt 表达式（形式是 ={{ `...` }}），
//    所以正文里绝对不能出现反引号，否则会提前闭合 JS 模板字符串导致
//    ChainLLM 节点报 "invalid syntax"。示例一律用「」括起来。
const PROMPT_PATCH = `
【条目格式约定】
1. 核心判断用编号列表，每条格式：「1. **一句话结论**：说明」
2. 头条用「### N. 标题」分条，每条下方用无序列表写字段，字段格式严格为「- **字段名**：内容」（冒号在加粗之外，不要写成「- **字段名：** 内容」）
3. 趋势与机会用编号列表，每条格式：
   第一行是编号加粗标题，例如「1. **标题**」
   后续每行是缩进两格的字段行，例如「   - 判断依据：…」（趋势）
   「   - 观点：…」（趋势）
   「   - 机会来源：…」（机会）
   「   - 实现方向：…」（机会）
   「   - 潜在价值：…」（机会）
4. 头条字段名固定用：来源及发布时间 / 核心事实 / 深度解读 / 对行业的影响 / 原文链接
5. 中英文标点不要混用，冒号统一用中文全角「：」，破折号统一用「—」
6. 每个字段一行，不要把多个字段挤在同一行
`;

function patchPrompt(): boolean {
  const node = nodes.find((n) => n.name === "Basic LLM Chain");
  if (!node) throw new Error("找不到 Basic LLM Chain 节点");
  const text: string = node.parameters.text;
  if (text.includes("【条目格式约定】")) return false;
  // 插到「【重要】」之前（输出格式约定之后）
  const anchor = "\n【重要】";
  if (!text.includes(anchor)) throw new Error("prompt 中找不到【重要】锚点");

  // 硬校验：prompt 的值是 ={{ `...` }} 形式，正文里的反引号会提前闭合模板字符串。
  // 插入前后反引号数量必须不变，否则 ChainLLM 节点会报 "invalid syntax"。
  const before = (text.match(/`/g) || []).length;
  const patched = text.replace(anchor, `${PROMPT_PATCH}${anchor}`);
  const after = (patched.match(/`/g) || []).length;
  if (after !== before) {
    throw new Error(
      `prompt 补丁引入了多余反引号（${before} → ${after}），会破坏 ={{ \`...\` }} 模板字符串`
    );
  }
  if (PROMPT_PATCH.includes("`")) {
    throw new Error("PROMPT_PATCH 正文含反引号，禁止写入 n8n prompt 表达式");
  }

  node.parameters.text = patched;
  return true;
}

/* ------------------------------------------------------------------ */
/* 施工项 4：结构校验增强                                              */
/* ------------------------------------------------------------------ */

const VALIDATION_PATCH = `
// ========================================
// 6.5 头条字段覆盖率检查（阶段 2 新增）
//    与 TS 侧 lib/markdown-parser.ts 的 HEADLINE_FIELD_ALIASES 保持一致
//    目的：格式漂移（如冒号写在加粗内）能被 validation 捕获，
//          而不是等到页面渲染才发现「核心判断/趋势/机会都是空的」
// ========================================

const HEADLINE_FIELD_ALIASES = {
  source: ["来源及发布时间", "来源和时间", "来源及时间", "来源"],
  coreFact: ["核心事实", "事实"],
  deepAnalysis: ["深度解读", "深度分析", "解读"],
  impact: ["对行业的影响", "行业影响", "影响"],
  link: ["原文链接", "原文链接地址", "原始链接", "链接", "网址"]
};

// 归一化键名：去掉结尾冒号、剥掉括号后缀、去空白
const normalizeKey = (raw) => String(raw)
  .replace(/[：:]\\s*$/, "")
  .replace(/[（(][^）)]*[）)]\\s*$/g, "")
  .replace(/\\s+/g, "")
  .trim();

// 取「二、今日必读头条」章节原文
// 注意：不能用 /(?=^##\\s|\\s*$)/ 这种前瞻 —— \\s*$ 在多行模式下会匹配空串，
// 导致惰性量词立刻停下、捕获到空章节。这里显式按「## 」切段更稳。
const headlineSection = (() => {
  const parts = markdown.split(/^##\\s+/m);
  for (const part of parts) {
    if (part.indexOf("二、") === 0) return part;
  }
  return "";
})();

const aliasEntries = Object.entries(HEADLINE_FIELD_ALIASES);
const aliasPattern = aliasEntries
  .flatMap(([, aliases]) => aliases)
  .sort((a, b) => b.length - a.length)
  .map((a) => a.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, "\\\\$&"))
  .join("|");

// 与 TS 侧 buildMarkerRegex 同一套语义：
//   行首可有列表符 - * •
//   键名可被 ** 包裹（DeepSeek 输出就是 "- **来源及发布时间**：…"）
//   键名前不能紧跟字母/数字（避免「来源」误命中「机会来源」）
//   键名后可选括号后缀（全角或半角）
// 这里刻意不用命名捕获组：n8n Code 节点沙箱对 (?<name>...) 支持不稳定，
// 用普通下标捕获更保险 —— m[1]=键名，m[2]=全角括号后缀，m[3]=半角括号后缀。
const markerRegex = new RegExp(
  "^[ \\\\t]*(?:[-*•][ \\\\t]*)?(?:\\\\*\\\\*)?[ \\\\t]*(" + aliasPattern +
  ")[ \\\\t]*(?:\\\\*\\\\*)?(?:（([^）]*)）|\\\\(([^)]*)\\\\))?[ \\\\t]*[：:]",
  "gmu"
);

// 统计头条条目数（### N. 标题）
const headlineBlocks = headlineSection.split(/^###\\s+\\d+[.、．]\\s*/m).slice(1);
let headlinesWithFields = 0;

for (const block of headlineBlocks) {
  // 逐个字段标记扫描，统计该条命中的规范字段数
  const found = new Set();
  for (const m of block.matchAll(markerRegex)) {
    const key = normalizeKey(m[1] || "");
    for (const pair of aliasEntries) {
      if (pair[1].indexOf(key) !== -1) found.add(pair[0]);
    }
  }
  // 至少要有 source + coreFact + link 三项才算「解析出了字段」
  if (found.has("source") && found.has("coreFact") && found.has("link")) {
    headlinesWithFields += 1;
  }
}

validation.headlines_with_fields = headlinesWithFields;
validation.headlines_field_coverage =
  headlineCount > 0 ? Number((headlinesWithFields / headlineCount).toFixed(3)) : 0;
`;

/** 把字段覆盖率检查插到 isValid 计算之前 */
function patchValidation(): boolean {
  const node = nodes.find((n) => n.name === "格式化数据");
  if (!node) throw new Error("找不到 格式化数据 节点");
  const code: string = node.parameters.jsCode;
  if (code.includes("headlines_field_coverage")) return false;

  // 硬校验 1：补丁里的 markerRegex 必须真的能编译。
  // （之前命名捕获组少一个右括号，静态看不出来，要等运行时才炸。）
  const literalMatch = VALIDATION_PATCH.match(
    /new RegExp\(\s*"(?:[^"\\]|\\.)*"(?:\s*\+\s*aliasPattern\s*\+\s*"(?:[^"\\]|\\.)*")*\s*,\s*"gu"\s*\)/
  );
  if (literalMatch) {
    // 把正则源码里的转义还原成真实字符，再用同样的 aliasPattern 试编译
    const src = literalMatch[0]
      .replace(/^new RegExp\(\s*/, "")
      .replace(/\s*,\s*"gu"\s*\)$/, "")
      .split(/\s*\+\s*aliasPattern\s*\+\s*/);
    const pieces = src.map((p) =>
      p.trim().replace(/^"/, "").replace(/"$/, "").replace(/\\\\/g, "\\")
    );
    const probe = pieces.join("来源|核心事实|深度解读|对行业的影响|原文链接");
    try {
      new RegExp(probe, "gu");
    } catch (e) {
      throw new Error(`VALIDATION_PATCH 里的 markerRegex 无法编译：${(e as Error).message}`);
    }
  }

  const anchor = "// ========================================\n// 6. 报告质量检查";
  const anchorIdx = code.indexOf(anchor);
  if (anchorIdx === -1) throw new Error("格式化数据 中找不到「6. 报告质量检查」锚点");
  // 字段覆盖率检查放在 validation 定义之后、isValid 计算之前
  const isValidIdx = code.indexOf("const isValid =");
  if (isValidIdx === -1) throw new Error("格式化数据 中找不到 isValid 计算");
  node.parameters.jsCode =
    code.slice(0, isValidIdx) + VALIDATION_PATCH + "\n" + code.slice(isValidIdx);
  return true;
}

/* ------------------------------------------------------------------ */
/* 施工项 5：语义去重链路                                              */
/* ------------------------------------------------------------------ */

/* 从 TS 源自动同步领域词典 ---------------------------------------------
 * 为什么这么做：DOMAIN_TERMS 有 190 条，手工抄写必然出错；
 * 一旦两边词典不一致，去重结果就会和 App 侧对不上。
 * 这里直接从 lib/normalize.ts 抽出 DOMAIN_TERMS 的字面量，
 * 原样嵌入 n8n 的 Code 节点（该段是纯对象字面量，TS 与 JS 语法等价）。
 */
function extractDomainTermsLiteral(): string {
  const src = readFileSync("lib/normalize.ts", "utf8");
  const start = src.indexOf("export const DOMAIN_TERMS");
  if (start === -1) throw new Error("lib/normalize.ts 中找不到 DOMAIN_TERMS");
  // 声明形如：export const DOMAIN_TERMS: readonly DomainTerm[] = [
  // 类型注解里也有 []，所以必须从「= [」之后定位真正的数组起始。
  const declEnd = src.indexOf("=", start);
  if (declEnd === -1) throw new Error("DOMAIN_TERMS 声明缺少赋值");
  const arrStart = src.indexOf("[", declEnd);
  if (arrStart === -1) throw new Error("DOMAIN_TERMS 不是数组字面量");

  // 从 [ 开始做括号配平，找到配对的 ]
  let depth = 0;
  let end = -1;
  let inStr: string | null = null;
  for (let i = arrStart; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") {
        i++; // 跳过转义字符
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("DOMAIN_TERMS 数组未闭合");

  const literal = src
    .slice(arrStart, end + 1)
    .split("\n")
    .filter((l) => !/^\s*\/\*/.test(l)) // 去掉块注释行
    .join("\n");

  // 硬校验：抽出来必须是能解析的非空数组，否则说明抽取逻辑坏了
  let parsed: unknown;
  try {
    parsed = new Function(`return (${literal});`)();
  } catch (e) {
    throw new Error(`DOMAIN_TERMS 字面量无法解析：${(e as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`DOMAIN_TERMS 抽取结果为空数组，抽取逻辑有误`);
  }
  console.log(`领域词典同步：从 lib/normalize.ts 取到 ${parsed.length} 条`);
  return literal;
}

const DOMAIN_TERMS_LITERAL = extractDomainTermsLiteral();

// —— 移植自 lib/normalize.ts + lib/dedup.ts（契约要求零 Node API 依赖）——
const NORMALIZE_JS = `
// ===== 移植自 TS 侧 lib/normalize.ts（保持同名，便于对照） =====
// 注意：本段代码严禁使用 Node 内置模块或第三方 API，只能用字符串与正则运算，
//       这样才能在 n8n Code 节点沙箱中安全执行。

// 领域词典：由 scripts/phase2-n8n-patch.mts 从 lib/normalize.ts 自动同步，
// 请勿手工修改本段 —— 要改就改 TS 源，再重新 apply。
const DOMAIN_TERMS = ${DOMAIN_TERMS_LITERAL};

const ENTITY_VARIANTS = [
  { canonical: "claude code", variants: ["claude code", "claude-code", "claudecode", "claude code cli", "claudecodecli"], related: ["anthropic", "编程agent"] },
  { canonical: "anthropic", variants: ["anthropic"], related: ["claude code"] },
  { canonical: "codex", variants: ["codex", "codex cli", "openai codex", "openai-codex"], related: ["openai", "编程agent"] },
  { canonical: "openai", variants: ["openai", "open ai", "open-ai"], related: ["codex", "gpt"] },
  { canonical: "gpt", variants: ["gpt", "gpt-4", "gpt-5", "gpt4", "gpt5", "chatgpt"], related: ["openai"] },
  { canonical: "google", variants: ["google", "谷歌"], related: ["gemini"] },
  { canonical: "gemini", variants: ["gemini", "gemini omni", "gemini omni 1.2 flash", "google gemini"], related: ["google"] },
  { canonical: "nvidia", variants: ["nvidia", "英伟达"], related: ["cosmos 3"] },
  { canonical: "cosmos 3", variants: ["cosmos 3", "cosmos3", "cosmos-3", "nvidia cosmos 3"], related: ["nvidia"] },
  { canonical: "facebook", variants: ["facebook", "meta", "fb"] },
  { canonical: "rivet", variants: ["rivet"] },
  { canonical: "microsoft", variants: ["microsoft", "微软"], related: ["copilot"] },
  { canonical: "copilot", variants: ["copilot"], related: ["microsoft"] },
  { canonical: "amazon", variants: ["amazon", "亚马逊"], related: ["aws"] },
  { canonical: "aws", variants: ["aws"], related: ["amazon"] },
  { canonical: "apple", variants: ["apple", "苹果"] },
  { canonical: "deepseek", variants: ["deepseek", "深度求索"] },
  { canonical: "qwen", variants: ["qwen", "通义千问", "通义"] },
  { canonical: "llama", variants: ["llama", "llama 3"] },
  { canonical: "cursor", variants: ["cursor"] },
  { canonical: "github", variants: ["github", "git hub"] },
  { canonical: "hugging face", variants: ["hugging face", "huggingface"] },
  { canonical: "langchain", variants: ["langchain"] },
  { canonical: "mcp", variants: ["mcp", "model context protocol"] },
  { canonical: "kubernetes", variants: ["kubernetes", "k8s"] },
  { canonical: "postgres", variants: ["postgres", "postgresql"] },
  { canonical: "redis", variants: ["redis"] },
  { canonical: "docker", variants: ["docker"] },
  { canonical: "perplexity", variants: ["perplexity"] },
  { canonical: "midjourney", variants: ["midjourney"] },
  { canonical: "sora", variants: ["sora"] },
  { canonical: "openrouter", variants: ["openrouter"] },
  { canonical: "编程agent", variants: ["ai编程agent", "ai 编程agent", "编码agent", "代码agent", "编程agent", "ai编程工具", "ai编程神器", "ai编程助手"], related: ["codex", "claude code"] },
  { canonical: "pii", variants: ["pii"] }
];

const STOP_WORDS = ["的","了","是","在","和","与","及","或","也","都","就","还","又","更","最","很","太","挺","但","却","而","并","把","被","让","使","给","从","向","到","对","为","以","于","其","之","这","那","哪","什","么","怎","样","如","何","谁","仍","已","将","曾","正","刚","才","只","再","各","某","该","本","此","一","个","些","点","种","类","位","名","事","时","年","月","日","天","中","下","上","里","外","前","后","左","右","个","家","多","少","高","低","大","小","好","新","旧","想","看","说","用","做","让","给","想","能","可","会","要","有","无","不","没","很","更","最","太","挺","或","及","与","和"];
const MEANINGLESS_PREFIXES = ["为什么","怎么样","怎么办","有没有","是不是","究竟","到底","请问","大家","如何","怎样","怎么","什么","是否","可以","能否","一个","关于","针对","基于","通过","值得","需要","建议","其实","用","做","的","了","吗","呢"];
const MARKETING_MODIFIERS = ["重磅","最新","独家","深度","终极","全新","最强","必看","实测","亲测","免费","限时","推荐","抢先","揭秘","突发","刚刚","首次","罕见","最全","最细","一文读懂","全解析","干货","收藏","必存","手把手","保姆级","惊呆","震撼","刷屏","霸榜"];
const PREFIX_EXCEPTIONS = {
  用: ["户","途","例","工","语","事","量","时","心","意","情","场","法","电","药","款","品"],
  做: ["法","空","出"],
  的: ["确"],
  了: ["解","结","事","然"],
  开: ["发","源","始","放"],
  是: ["否"],
  会: ["计","员"]
};

const TOPIC_CATEGORIES = [
  { tag: "隐私安全", triggers: ["隐私","脱敏","泄露","审计","出站","网关","代理","白名单","拦截","敏感","加密","权限","身份","合规","风控","漏洞","攻击","防护","防火墙","审查","令牌","邮箱","邮件","证书","密钥","供应链","检测","监控","溯源","pii","域名"] },
  { tag: "成本价格", triggers: ["成本","便宜","价格","降价","费用","预算","性价比","省钱","涨价","账单"] },
  { tag: "评测对比", triggers: ["评测","基准","对比","效率","准确率","成功率","质量","指标","榜单","复现","评估","性能","跑分"] },
  { tag: "模型发布", triggers: ["模型","发布","开源","权重","版本","上线","微调","蒸馏","参数","能力","gemini","openai","gpt","google","anthropic","cosmos 3"] },
  { tag: "仿真训练", triggers: ["仿真","训练场","合成数据","世界模型","机器人","训练","nvidia"] },
  { tag: "平台治理", triggers: ["广告","深伪","诈骗","治理","审核","违规","监管","标注","换脸","争议","指控","平台","诉讼","侵权","版权","金额","facebook"] },
  { tag: "部署运维", triggers: ["部署","托管","运维","编排","迁移","容器","休眠","扩容","集群","备份","恢复","架构","可观测","长任务","长周期","轻量","状态","服务","无服务器","rivet"] },
  { tag: "工具定制", triggers: ["内部","定制","看板","报表","流程","自动化","排班","工单","垂直","交付","订阅","项目","业务","场景","需求","提效","运营","工作流"] },
  { tag: "算力性能", triggers: ["gpu","cpu","算力","显卡","芯片","hbm","内存","瓶颈","延迟","吞吐","存储","带宽"] },
  { tag: "多模态创作", triggers: ["视频","图像","多模态","剪辑","生成","创作","内容","音频","画质","一致性"] },
  { tag: "开发工具", triggers: ["编程","代码","编码","开发者","开发","工具链","仓库","重构","调试","插件","编程agent","claude code","codex","cursor","copilot","microsoft"] },
  { tag: "路由调度", triggers: ["路由","调度","聚合","多模型","兜底","中转"] },
  { tag: "长文本", triggers: ["上下文","长上下文","记忆","缓存","窗口","截断","更长","长片段","长文本","长文"] }
];

const CJK = "[\\\\u3400-\\\\u4dbf\\\\u4e00-\\\\u9fff\\\\uf900-\\\\ufaff]";
const RE_CJK = new RegExp(CJK);
const STOP_SET = new Set(STOP_WORDS);

function toHalfWidth(input) {
  let out = "";
  for (const ch of String(input)) {
    const code = ch.codePointAt(0);
    if (code === 0x3000) { out += " "; continue; }
    if (code >= 0xff01 && code <= 0xff5e) { out += String.fromCharCode(code - 0xfee0); continue; }
    out += ch;
  }
  return out;
}

const PUNCT_MAP = { "、":",", "。":".", "，":",", "；":";", "：":":", "！":"!", "？":"?", "（":"(", "）":")", "【":"[", "】":"]", "《":"<", "》":">", "「":"\\"", "」":"\\"", "『":"\\"", "』":"\\"", "“":"\\"", "”":"\\"", "‘":"'", "’":"'", "—":"-", "–":"-", "―":"-", "−":"-", "＝":"=" };

function unifyPunctuation(input) {
  let out = "";
  for (const ch of String(input)) out += (PUNCT_MAP[ch] !== undefined ? PUNCT_MAP[ch] : ch);
  return out;
}

function tightenSpaces(input) {
  let out = String(input);
  let prev = "";
  let guard = 0;
  while (prev !== out && guard < 8) {
    prev = out;
    out = out.replace(new RegExp("(" + CJK + ")\\\\s+(?=" + CJK + ")", "g"), "$1");
    out = out.replace(new RegExp("(" + CJK + ")\\\\s+(?=[a-z0-9])", "g"), "$1");
    out = out.replace(new RegExp("([a-z0-9])\\\\s+(?=" + CJK + ")", "g"), "$1");
    guard++;
  }
  out = out.replace(/\\s+([,.:;!?)\\]}])/g, "$1");
  out = out.replace(/([([{])\\s+/g, "$1");
  out = out.replace(/([,.:;!?)\\]}])\\s+(?=[\\\\u3400-\\\\u4dbf\\\\u4e00-\\\\u9fff\\\\uf900-\\\\ufaffa-z0-9])/g, "$1");
  return out.replace(/\\s+/g, " ").trim();
}

function stripMarketingModifiers(input) {
  let out = String(input);
  for (const w of MARKETING_MODIFIERS) if (out.includes(w)) out = out.split(w).join("");
  return out;
}

const LEADING_DECORATION = /^[\\s!！?？.。、,，:：;；~～\\-—_"'“”‘’《》【】()（）\\[\\]]+/;

function stripMeaninglessPrefixes(input) {
  let out = String(input).trim().replace(LEADING_DECORATION, "").trim();
  let changed = true;
  let guard = 0;
  while (changed && guard < 12) {
    changed = false;
    guard++;
    for (const p of MEANINGLESS_PREFIXES) {
      if (!out.startsWith(p)) continue;
      const next = out.charAt(p.length);
      const exceptions = PREFIX_EXCEPTIONS[p];
      if (exceptions && next && exceptions.includes(next)) continue;
      out = out.slice(p.length).trim();
      changed = true;
      break;
    }
  }
  return out;
}

function escapeRegExp(s) { return String(s).replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, "\\\\$&"); }

function mergeEntityVariants(input) {
  let out = String(input);
  const all = [];
  for (const e of ENTITY_VARIANTS) for (const v of e.variants) all.push({ variant: v.toLowerCase(), canonical: e.canonical });
  all.sort((a, b) => b.variant.length - a.variant.length);
  for (const item of all) {
    if (!out.toLowerCase().includes(item.variant)) continue;
    const escaped = escapeRegExp(item.variant);
    const pattern = RE_CJK.test(item.variant)
      ? new RegExp(escaped, "gi")
      : new RegExp("(?<![a-z0-9])" + escaped + "(?![a-z0-9])", "gi");
    out = out.replace(pattern, item.canonical);
  }
  return out;
}

function basicNormalize(input) {
  if (input === null || input === undefined) return "";
  let s = String(input);
  if (!s.trim()) return "";
  s = toHalfWidth(s);
  s = unifyPunctuation(s);
  s = s.toLowerCase();
  s = tightenSpaces(s);
  s = stripMarketingModifiers(s);
  s = stripMeaninglessPrefixes(s);
  s = mergeEntityVariants(s);
  s = s.replace(new RegExp("[^a-z0-9" + CJK + "\\\\s]", "g"), " ");
  s = s.replace(/\\s+/g, " ").trim();
  return s;
}

const ENTITY_RELATED_MAP = new Map();
function linkRelated(a, b) {
  if (!ENTITY_RELATED_MAP.has(a)) ENTITY_RELATED_MAP.set(a, new Set());
  ENTITY_RELATED_MAP.get(a).add(b);
  if (!ENTITY_RELATED_MAP.has(b)) ENTITY_RELATED_MAP.set(b, new Set());
  ENTITY_RELATED_MAP.get(b).add(a);
}
for (const e of ENTITY_VARIANTS) for (const r of (e.related || [])) linkRelated(e.canonical, r);

function relatedEntities(entity) { return Array.from(ENTITY_RELATED_MAP.get(entity) || []); }

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) { if (!v || seen.has(v)) continue; seen.add(v); out.push(v); }
  return out;
}

// 用于切分中文片段的单字停用字集合（与 TS 侧 FRAGMENT_CUT_CHARS 一致）
const FRAGMENT_CUT_SET = new Set(STOP_WORDS.filter((w) => w.length === 1 && RE_CJK.test(w)));

/** 按单字停用词切分中文片段（与 TS 侧 splitByCutChars 一致） */
function splitByCutChars(run) {
  const out = [];
  let buf = "";
  for (const ch of run) {
    if (FRAGMENT_CUT_SET.has(ch)) {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

// ===== 词典最长匹配切分（逐行移植自 TS 侧 tokenize，行为必须完全一致）=====
// 构建 词典：别名(小写) → { term, kind }，实体优先于普通领域词
const DICT = new Map();
let MAX_ALIAS_LEN = 1;
function addAlias(alias, term, kind) {
  if (!alias) return;
  const key = alias.toLowerCase();
  const existed = DICT.get(key);
  if (existed && existed.kind === "entity") return;
  DICT.set(key, { term: term, kind: kind });
  if (key.length > MAX_ALIAS_LEN) MAX_ALIAS_LEN = key.length;
}
for (const e of ENTITY_VARIANTS) for (const v of e.variants) addAlias(v, e.canonical, "entity");
for (const t of DOMAIN_TERMS) for (const a of t.aliases) addAlias(a, t.term, "term");

const RE_LATIN_NUM = /[a-z0-9]/;
function isLatinNum(ch) { return ch.length > 0 && RE_LATIN_NUM.test(ch); }

/** 词典最长匹配切分：与 TS 侧 tokenize() 同算法，返回 { tokens, entities } */
function tokenize(input) {
  const text = basicNormalize(input);
  const tokens = [];
  const entities = [];
  if (!text) return { tokens: tokens, entities: entities };

  let i = 0;
  let cjkRun = "";

  const flushCjk = () => {
    if (!cjkRun) return;
    const run = cjkRun;
    cjkRun = "";
    const segs = splitByCutChars(run);
    for (const seg of segs) {
      if (seg.length >= 2 && seg.length <= 4 && !STOP_SET.has(seg)) tokens.push(seg);
    }
  };

  while (i < text.length) {
    const firstCh = text.charAt(i);
    const prevCh = i > 0 ? text.charAt(i - 1) : "";
    // 拉丁词需要词边界；中文词不需要
    const canStartHere = isLatinNum(firstCh) ? !isLatinNum(prevCh) : true;
    let matched = false;
    if (canStartHere) {
      const maxLen = Math.min(MAX_ALIAS_LEN, text.length - i);
      for (let len = maxLen; len >= 1; len--) {
        const slice = text.slice(i, i + len);
        const hit = DICT.get(slice);
        if (!hit) continue;
        flushCjk();
        tokens.push(hit.term);
        if (hit.kind === "entity") entities.push(hit.term);
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (RE_CJK.test(firstCh)) {
      cjkRun += firstCh;
      i++;
      continue;
    }
    flushCjk();
    if (isLatinNum(firstCh)) {
      let j = i;
      while (
        j < text.length &&
        (isLatinNum(text.charAt(j)) || text.charAt(j) === "." || text.charAt(j) === "_" || text.charAt(j) === "-")
      ) {
        j++;
      }
      const word = text.slice(i, j).replace(/[._-]+$/, "");
      if (word.length >= 2) tokens.push(word);
      i = j;
      continue;
    }
    i++;
  }
  flushCjk();
  return { tokens: tokens, entities: entities };
}

/** 提取实体 / 关键词 / 主题（与 TS 侧 normalizeText 的产出结构一致） */
function extractFeatures(input) {
  const text = basicNormalize(input);
  const r = tokenize(input);
  const keywords = dedupe(r.tokens.filter((t) => !STOP_SET.has(t)));
  const entities = dedupe(r.entities);
  const topics = [];
  for (const c of TOPIC_CATEGORIES) {
    const hit = c.triggers.some((tr) => keywords.indexOf(tr) !== -1 || entities.indexOf(tr) !== -1 || text.indexOf(tr) !== -1);
    if (hit) topics.push(c.tag);
  }
  return { keywords: keywords, entities: entities, topics: topics };
}

function normalizeText(input) {
  const text = basicNormalize(input);
  const f = extractFeatures(input);
  return { text, keywords: f.keywords, entities: f.entities, topics: f.topics };
}

function normalizeTitle(title) {
  const f = normalizeText(title);
  return f.text;
}

// ===== 移植自 TS 侧 lib/dedup.ts =====
const DEFAULT_DEDUP_OPTIONS = { keywordThreshold: 0.55, topicThreshold: 0.6, entityRelaxFactor: 0.7, requireEntity: false };

function keywordSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a), setB = new Set(b);
  let inter = 0;
  for (const k of setA) if (setB.has(k)) inter += 1;
  if (!inter) return 0;
  return Math.max(inter / setA.size, inter / setB.size);
}

function topicSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a), setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  if (!inter) return 0;
  return Math.max(inter / setA.size, inter / setB.size);
}

function entityHit(a, b) {
  const strong = [];
  const setB = new Set(b);
  for (const e of a) if (setB.has(e) && strong.indexOf(e) === -1) strong.push(e);
  const weak = [];
  for (const e of a) {
    for (const r of relatedEntities(e)) {
      if (!setB.has(r)) continue;
      const key = e + "->" + r;
      if (weak.some((w) => w.key === key)) continue;
      weak.push({ key, from: e, to: r });
    }
  }
  return { hit: strong.length > 0 || weak.length > 0, strong, weak };
}

function describeEntityHit(hit) {
  const parts = [];
  if (hit.strong.length) parts.push("共同实体 " + hit.strong.join("/"));
  if (hit.weak.length) parts.push("关联实体 " + hit.weak.map((w) => w.from + "≈" + w.to).join("/"));
  return parts.join("，");
}

function isDuplicate(candidate, history, options) {
  const opts = Object.assign({}, DEFAULT_DEDUP_OPTIONS, options || {});
  const cText = normalizeText(candidate.title || "");
  const cDesc = candidate.description ? normalizeText(candidate.description) : { keywords: [], entities: [], topics: [] };
  const c = {
    title: cText.text,
    entities: cText.entities,
    keywords: dedupe(cText.keywords.concat(cDesc.keywords)),
    topics: cText.topics
  };
  const hist = Array.isArray(history) ? history : [];

  // 第 1 步：归一化标题完全一致
  for (const h of hist) {
    const hTitle = normalizeTitle(h.title || "");
    if (c.title.length > 0 && c.title === hTitle) {
      return {
        duplicate: true,
        match: { id: -1, title: h.title, reason: "标题归一化后完全一致", score: 1, matched: { keywords: [], entities: [], topics: [] } },
        score: 1,
        explanation: "与历史条目「" + h.title + "」重复：标题归一化后完全一致。"
      };
    }
  }

  let best = { duplicate: false, match: null, score: 0, explanation: "与 " + hist.length + " 条历史条目均不重复。" };
  let closestExplanation = "";
  let closestScore = -1;

  for (const h of hist) {
    const hText = normalizeText(h.title || "");
    const hDesc = h.description ? normalizeText(h.description) : { keywords: [], entities: [], topics: [] };
    const hf = {
      entities: hText.entities,
      keywords: dedupe(hText.keywords.concat(hDesc.keywords)),
      topics: hText.topics
    };

    const kwSim = keywordSimilarity(c.keywords, hf.keywords);
    const tpSim = topicSimilarity(c.topics, hf.topics);
    const eh = entityHit(c.entities, hf.entities);
    const score = Math.max(kwSim, tpSim);
    const relaxed = opts.keywordThreshold * opts.entityRelaxFactor;

    let duplicate = false, reason = "", explanation = "";

    if (opts.requireEntity && !eh.hit) {
      explanation = "与「" + h.title + "」：无共同重要实体（要求实体命中），不判重。关键词重合 " + pct(kwSim) + "，主题相似 " + pct(tpSim) + "。";
    } else if (eh.hit) {
      if (tpSim >= opts.topicThreshold) {
        duplicate = true;
        reason = "主题相似度 " + pct(tpSim) + " ≥ " + pct(opts.topicThreshold) + "，且" + describeEntityHit(eh);
      } else if (kwSim >= relaxed) {
        duplicate = true;
        reason = "关键词重合度 " + pct(kwSim) + " ≥ " + pct(relaxed) + "（实体命中放宽系数 " + opts.entityRelaxFactor + "），且" + describeEntityHit(eh);
      } else {
        explanation = "与「" + h.title + "」：命中" + describeEntityHit(eh) + "，但主题相似 " + pct(tpSim) + " < " + pct(opts.topicThreshold) + " 且关键词重合 " + pct(kwSim) + " < " + pct(relaxed) + "，不判重。";
      }
    } else {
      if (tpSim >= opts.topicThreshold && kwSim >= opts.keywordThreshold) {
        duplicate = true;
        reason = "主题相似度 " + pct(tpSim) + " ≥ " + pct(opts.topicThreshold) + " 且关键词重合度 " + pct(kwSim) + " ≥ " + pct(opts.keywordThreshold);
      } else {
        explanation = "与「" + h.title + "」：无共同重要实体，主题相似 " + pct(tpSim) + "、关键词重合 " + pct(kwSim) + "，未同时达到 " + pct(opts.topicThreshold) + " / " + pct(opts.keywordThreshold) + "，不判重。";
      }
    }

    if (duplicate) {
      const commonKeywords = c.keywords.filter((k) => hf.keywords.indexOf(k) !== -1);
      const commonTopics = c.topics.filter((t) => hf.topics.indexOf(t) !== -1);
      const result = {
        duplicate: true,
        match: { id: -1, title: h.title, reason, score, matched: { keywords: commonKeywords, entities: eh.strong, topics: commonTopics } },
        score,
        explanation: "与历史条目「" + h.title + "」重复：" + reason + "。"
      };
      if (!best.duplicate || score >= best.score) best = result;
      continue;
    }
    if (score > closestScore) { closestScore = score; closestExplanation = explanation; }
  }

  if (!best.duplicate && closestExplanation) {
    best = { duplicate: false, match: null, score: Math.max(0, closestScore), explanation: closestExplanation };
  }
  return best;
}

function pct(v) { return Math.round(v * 100) + "%"; }
`;

/** 商机去重 Code 节点 */
function buildOppDedupCode(): string {
  return `// 商机语义去重（阶段 2）—— 移植自 TS 侧 lib/dedup.ts，规则与 App 侧一致
// 输入：全表历史 =「商机查库」节点的输出行；本批候选 =「商机清洗」节点的输出
// 输出：每条候选带上 action（insert / update / skip）+ 匹配到的历史 id
${NORMALIZE_JS}

// 注意：$input 是「商机查库」的 SQL 结果行（每行一个历史商机），
//       候选必须显式从「商机清洗」节点取，不能从 $input 里找。
const historyRows = $input.all().map((i) => i.json);
const historyPool = historyRows.map((h) => ({
  id: Number(h.id),
  title: String(h.title || ""),
  description: h.description == null ? null : String(h.description),
  notes: h.notes == null ? null : String(h.notes),
  status: String(h.status || ""),
  action_plan: h.action_plan == null ? null : String(h.action_plan)
}));

const candidates = $("商机清洗").all().map((i) => i.json);

// 判断历史记录是否是「AI 草稿」（可安全覆盖 notes 的前提）
const isAiDraftNotes = (notes) => {
  if (!notes) return true;
  const s = String(notes).trim();
  return s.startsWith("判断依据：") || /^来源日报 \\d{4}-\\d{2}-\\d{2}$/.test(s);
};

const out = [];
for (const cand of candidates) {
  const result = isDuplicate(
    { title: cand.title, description: cand.description },
    historyPool
  );

  if (!result.duplicate) {
    out.push({ json: { ...cand, action: "insert", matched_id: null, match_reason: "", match_score: 0 } });
    historyPool.push({ id: -1, title: cand.title, description: cand.description, notes: null, status: "待研究", action_plan: null });
    continue;
  }

  const matched = historyPool.find((h) => h.title === result.match.title);
  const matchedId = matched ? matched.id : -1;
  const curDesc = matched ? (matched.description || "") : "";
  const richer = cand.description && cand.description.trim().length > curDesc.trim().length;

  // 只更新 description；notes 仅当历史是 AI 草稿格式时才更新；
  // action_plan 与 status 永不更新（人工字段）
  const canUpdate = matchedId > 0 && richer && matched && isAiDraftNotes(matched.notes);

  out.push({
    json: {
      ...cand,
      action: canUpdate ? "update" : "skip",
      matched_id: canUpdate ? matchedId : null,
      match_reason: result.match.reason,
      match_score: result.score,
      matched_title: result.match.title
    }
  });

  if (canUpdate) {
    matched.description = cand.description;
  }
}
return out;
`;
}

/** 商机查库 SQL */
const OPP_LOOKUP_SQL = `SELECT id::int AS id, title, description, notes, status, action_plan
FROM public.opportunities
ORDER BY id ASC`;

/** 商机写入：把去重结果整理成可写入的条目
 *
 * ⚠️ 关键：必须遍历 $input.all()，不能只看 $json。
 *    n8n 会把多条候选作为多个 item 传给同一个 Code 节点，
 *    用 $json 只会处理第一条，其余条目会被静默丢弃。
 *
 *    另外 Code 节点只能有一个输出口，没法按 action 分到不同分支，
 *    所以这里把所有非 skip 的条目都输出（各自带 mode），
 *    由下游两条 SQL 自己按 mode 过滤：
 *      - 插入 SQL：WHERE $6::text <> 'update'  → 只处理 insert
 *      - 更新 SQL：WHERE id = $1::int          → matched_id 为 null 时天然不命中
 */
function buildOppWriteCode(): string {
  return `// 商机写入分流（阶段 2）
// insert → 新增；update → 合并更完整的描述（只改 description 与 AI 草稿 notes）；
//           action_plan / status 永不出现在 UPDATE 的 SET 里
const out = [];
const skipped = [];

for (const item of $input.all()) {
  const d = item.json;
  const action = d.action;
  const date = d.report_date;
  const title = d.title;

  if (action === "skip") {
    skipped.push({ title: title, reason: d.match_reason });
    continue;
  }

  const notes = d.rationale
    ? "判断依据：" + d.rationale + "（来源日报 " + date + "）"
    : "来源日报 " + date;

  if (action === "update") {
    out.push({ json: {
      mode: "update",
      matched_id: d.matched_id,
      title: title,
      description: d.description,
      notes: notes
    } });
    continue;
  }

  out.push({ json: {
    mode: "insert",
    matched_id: null,
    title: title,
    description: d.description,
    category: d.category,
    report_date: date,
    notes: notes
  } });
}

// 全部被跳过时输出一条汇总，方便在 n8n 里看到「本批没有新商机」
if (out.length === 0) {
  return [{ json: { mode: "none", skipped_count: skipped.length, skipped: JSON.stringify(skipped) } }];
}
return out;
`;
}

/** 选题去重 Code 节点 */
function buildIdeaDedupCode(): string {
  return `// 选题语义去重（阶段 2）—— 移植自 TS 侧 lib/dedup.ts
// 输入：全表历史 =「选题查库」节点的输出行；本批候选 =「选题清洗」节点的输出
// 输出：每条候选带上 action（insert / update / skip）
${NORMALIZE_JS}

// 注意：$input 是「选题查库」的 SQL 结果行（每行一条历史选题），
//       候选必须显式从「选题清洗」节点取，不能从 $input 里找。
const historyRows = $input.all().map((i) => i.json);
const historyPool = historyRows.map((h) => ({
  id: Number(h.id),
  title: String(h.title || ""),
  angle: h.angle == null ? null : String(h.angle),
  source_material: h.source_material == null ? null : String(h.source_material),
  reference_visuals: h.reference_visuals == null ? null : String(h.reference_visuals),
  value_score: h.value_score == null ? null : Number(h.value_score),
  status: String(h.status || ""),
  report_date: h.report_date == null ? null : String(h.report_date)
}));

const candidates = $("选题清洗").all().map((i) => i.json);

/** 角度是否显著不同（字符级 Jaccard，与 TS 侧 isAngleDifferent 一致） */
function isAngleDifferent(a, b) {
  const s1 = String(a == null ? "" : a).replace(/\\s+/g, "");
  const s2 = String(b == null ? "" : b).replace(/\\s+/g, "");
  if (!s1 || !s2) return false;
  const setA = new Set(s1.split(""));
  const setB = new Set(s2.split(""));
  let inter = 0;
  for (const ch of setA) if (setB.has(ch)) inter += 1;
  const union = setA.size + setB.size - inter;
  if (!union) return false;
  return inter / union < 0.6;
}

const out = [];
for (const cand of candidates) {
  const result = isDuplicate(
    { title: cand.title, description: cand.angle },
    historyPool
  );

  if (!result.duplicate) {
    out.push({ json: { ...cand, action: "insert", matched_id: null, match_reason: "", match_score: 0 } });
    historyPool.push({ id: -1, title: cand.title, angle: cand.angle, source_material: cand.source_material, reference_visuals: cand.reference_visuals, value_score: cand.value_score, status: "待制作", report_date: cand.report_date });
    continue;
  }

  const matched = historyPool.find((h) => h.title === result.match.title);
  const matchedId = matched ? matched.id : -1;

  // 「角度不同就并存」只在跨日报时成立。
  // 同一份日报重复执行时，LLM 会把同一个新闻换个说法重写一遍，
  // 角度文字天然不同，但这不该算成一条新选题 —— 否则每次重跑都多 5 条。
  const sameReportDate =
    !!matched && !!matched.report_date && !!cand.report_date &&
    matched.report_date === cand.report_date;

  if (matched && !sameReportDate && isAngleDifferent(matched.angle, cand.angle)) {
    out.push({
      json: {
        ...cand,
        action: "insert",
        matched_id: null,
        match_reason: "同主题但切入角度不同（跨日报），已并存保留",
        match_score: result.score,
        angle: (cand.angle || "") + "｜同主题变体（历史 #" + matchedId + "）"
      }
    });
    historyPool.push({ id: -1, title: cand.title, angle: cand.angle, source_material: cand.source_material, reference_visuals: cand.reference_visuals, value_score: cand.value_score, status: "待制作", report_date: cand.report_date });
    continue;
  }

  // 角度相同或缺失 → 合并：取字段更全的更新主记录
  const richerScore = (matched && matched.value_score != null && cand.value_score != null)
    ? Math.max(matched.value_score, cand.value_score)
    : (cand.value_score != null ? cand.value_score : (matched ? matched.value_score : null));
  const richerAngle = (cand.angle && String(cand.angle).length > String(matched && matched.angle ? matched.angle : "").length)
    ? cand.angle : (matched ? matched.angle : cand.angle);
  const richerSource = (cand.source_material && String(cand.source_material).length > String(matched && matched.source_material ? matched.source_material : "").length)
    ? cand.source_material : (matched ? matched.source_material : cand.source_material);
  const richerVisuals = (cand.reference_visuals && String(cand.reference_visuals).length > String(matched && matched.reference_visuals ? matched.reference_visuals : "").length)
    ? cand.reference_visuals : (matched ? matched.reference_visuals : cand.reference_visuals);

  const canUpdate = matchedId > 0;
  out.push({
    json: {
      ...cand,
      action: canUpdate ? "update" : "skip",
      matched_id: canUpdate ? matchedId : null,
      match_reason: result.match.reason,
      match_score: result.score,
      merged_angle: richerAngle,
      merged_source_material: richerSource,
      merged_reference_visuals: richerVisuals,
      merged_value_score: richerScore
    }
  });
}
return out;
`;
}

/** 选题查库 SQL */
const IDEA_LOOKUP_SQL = `SELECT id::int AS id, title, angle, source_material, reference_visuals, value_score::int AS value_score, status, report_date::text AS report_date
FROM public.topic_ideas
WHERE status <> '已放弃'
ORDER BY id ASC`;

/** 选题写入分流
 *
 * 同「商机写入分流」：必须遍历 $input.all()，且不按 action 拆分支，
 * 由下游两条 SQL 自己按 mode / matched_id 过滤。
 */
function buildIdeaWriteCode(): string {
  return `// 选题写入分流（阶段 2）
// insert → 新增；update → 合并更全的字段到主记录（不覆盖 status）
const out = [];
const skipped = [];

for (const item of $input.all()) {
  const d = item.json;
  const action = d.action;
  const date = d.report_date;

  if (action === "skip") {
    skipped.push({ title: d.title, reason: d.match_reason });
    continue;
  }

  if (action === "update") {
    out.push({ json: {
      mode: "update",
      matched_id: d.matched_id,
      title: d.title,
      angle: d.merged_angle,
      source_material: d.merged_source_material,
      reference_visuals: d.merged_reference_visuals,
      value_score: d.merged_value_score
    } });
    continue;
  }

  out.push({ json: {
    mode: "insert",
    matched_id: null,
    title: d.title,
    angle: d.angle,
    source_material: d.source_material,
    reference_visuals: d.reference_visuals,
    value_score: d.value_score,
    report_date: date
  } });
}

if (out.length === 0) {
  return [{ json: { mode: "none", skipped_count: skipped.length, skipped: JSON.stringify(skipped) } }];
}
return out;
`;
}

/* ------------------------------------------------------------------ */
/* 节点构造工具                                                        */
/* ------------------------------------------------------------------ */

function uuid(): string {
  return randomUUID();
}

/** 取下一个 postgres 节点用的凭据与连接配置（沿用现有节点） */
function templateOf(nodeName: string): any {
  const n = nodes.find((x) => x.name === nodeName);
  if (!n) throw new Error(`找不到节点模板：${nodeName}`);
  return n;
}

function makePostgres(name: string, template: any, query: string, replacement: string): any {
  const t = JSON.parse(JSON.stringify(template));
  t.name = name;
  t.id = uuid();
  t.parameters.query = query;
  t.parameters.options = { queryReplacement: replacement };
  t.position = [template.position[0] + 260, template.position[1]];
  t.notes = t.notes ?? undefined;
  t.onError = "continueRegularOutput";
  t.alwaysOutputData = true;
  return t;
}

function makeCode(name: string, template: any, jsCode: string): any {
  const t = JSON.parse(JSON.stringify(template));
  t.name = name;
  t.id = uuid();
  t.parameters.jsCode = jsCode;
  t.position = [template.position[0] + 260, template.position[1]];
  t.onError = "continueRegularOutput";
  t.alwaysOutputData = true;
  return t;
}

/* ------------------------------------------------------------------ */
/* 应用改造                                                            */
/* ------------------------------------------------------------------ */

function applyOppChain(): { added: string[] } {
  const added: string[] = [];

  const oppClean = nodes.find((n) => n.name === "商机清洗")!;
  const oppWrite = nodes.find((n) => n.name === "商机写入")!;

  // 商机清洗 改为输出候选数组（不直接给写入节点）
  const newOppClean = makeCode("商机清洗", oppClean, `// 商机候选清洗（阶段 2）：剥围栏 → 解析 JSON 数组 → 拆 item
// 改为返回候选数组，供「商机查库」与「商机去重」使用
const raw = $json.text ?? $json.output ?? $json.content ?? "";
let s = String(raw).trim();
const fence = s.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/i);
if (fence) s = fence[1].trim();
const start = s.indexOf("[");
const end = s.lastIndexOf("]");
if (start === -1 || end === -1 || end <= start) return [];
let arr;
try { arr = JSON.parse(s.slice(start, end + 1)); } catch (e) { return []; }
if (!Array.isArray(arr)) return [];
const date = $("取日报正文").first().json.report_date;
return arr
  .filter((x) => x && typeof x.title === "string" && typeof x.description === "string")
  .slice(0, 3)
  .map((x) => ({
    json: {
      report_date: date,
      title: String(x.title).trim(),
      description: x.description,
      category: typeof x.category === "string" ? x.category : null,
      rationale: typeof x.rationale === "string" ? x.rationale : null
    }
  }));
`);

  // 商机查库（postgres）
  const oppLookup = makePostgres(
    "商机查库",
    templateOf("Execute a SQL query"),
    OPP_LOOKUP_SQL,
    "={{ [] }}"
  );
  oppLookup.position = [oppClean.position[0] + 200, oppClean.position[1]];

  // 商机去重（Code）
  const oppDedup = makeCode("商机去重", oppClean, buildOppDedupCode());
  oppDedup.position = [oppLookup.position[0] + 200, oppLookup.position[1]];

  // 商机写入分流（Code）
  const oppRoute = makeCode("商机写入分流", oppClean, buildOppWriteCode());
  oppRoute.position = [oppDedup.position[0] + 200, oppDedup.position[1]];

  // 商机插入 / 更新（postgres）
  // 两条 SQL 都会收到分流节点的全部条目，各自按 mode 自我过滤：
  //   插入只处理 mode='insert'（matched_id 为 null）
  //   更新只处理 id 命中的行（insert 条目的 matched_id 是 null，天然不命中）
  const oppInsert = makePostgres(
    "商机插入",
    oppWrite,
    `INSERT INTO public.opportunities (title, description, category, source_report_date, status, notes)
SELECT $1, $2, $3, $4::date, '待研究', $5
WHERE $6::text = 'insert'
  AND NOT EXISTS (SELECT 1 FROM public.opportunities WHERE trim(title) = trim($1))`,
    "={{ [ $json.title, $json.description, $json.category, $json.report_date, $json.notes, $json.mode ] }}"
  );
  oppInsert.position = [oppRoute.position[0] + 200, oppRoute.position[1]];

  const oppUpdate = makePostgres(
    "商机更新",
    oppWrite,
    `-- 合并更完整的描述；notes 仅当历史是 AI 草稿格式时才更新
-- action_plan 与 status 永不更新（人工字段）
UPDATE public.opportunities
SET description = $2,
    notes = CASE
      WHEN notes IS NULL OR notes = '' OR notes LIKE '判断依据：%' OR notes LIKE '来源日报 %' THEN $3
      ELSE notes
    END,
    updated_at = NOW()
WHERE id = $1::int
  AND $4::text = 'update'`,
    "={{ [ $json.matched_id, $json.description, $json.notes, $json.mode ] }}"
  );
  oppUpdate.position = [oppInsert.position[0], oppInsert.position[1] + 200];

  // 替换原「商机清洗」「商机写入」节点
  const oppCleanIdx = nodes.findIndex((n) => n.name === "商机清洗");
  nodes[oppCleanIdx] = newOppClean;
  const oppWriteIdx = nodes.findIndex((n) => n.name === "商机写入");
  nodes[oppWriteIdx] = oppInsert;

  nodes.push(oppLookup, oppDedup, oppRoute, oppUpdate);
  added.push("商机查库", "商机去重", "商机写入分流", "商机更新");

  // 重连
  connections["商机清洗"] = { main: [[{ node: "商机查库", type: "main", index: 0 }]] };
  connections["商机查库"] = { main: [[{ node: "商机去重", type: "main", index: 0 }]] };
  connections["商机去重"] = { main: [[{ node: "商机写入分流", type: "main", index: 0 }]] };
  connections["商机写入分流"] = {
    main: [[{ node: "商机插入", type: "main", index: 0 }], [{ node: "商机更新", type: "main", index: 0 }]],
  };

  return { added };
}

function applyIdeaChain(): { added: string[] } {
  const added: string[] = [];

  const ideaClean = nodes.find((n) => n.name === "选题清洗")!;
  const ideaWrite = nodes.find((n) => n.name === "选题写入")!;

  const ideaLookup = makePostgres(
    "选题查库",
    templateOf("Execute a SQL query"),
    IDEA_LOOKUP_SQL,
    "={{ [] }}"
  );
  ideaLookup.position = [ideaClean.position[0] + 200, ideaClean.position[1]];

  const ideaDedup = makeCode("选题去重", ideaClean, buildIdeaDedupCode());
  ideaDedup.position = [ideaLookup.position[0] + 200, ideaLookup.position[1]];

  const ideaRoute = makeCode("选题写入分流", ideaClean, buildIdeaWriteCode());
  ideaRoute.position = [ideaDedup.position[0] + 200, ideaDedup.position[1]];

  // 选题插入 / 更新：同样由 SQL 自己按 mode 过滤（见商机链路的说明）
  const ideaInsert = makePostgres(
    "选题插入",
    ideaWrite,
    `INSERT INTO public.topic_ideas
  (report_date, title, angle, source_material, reference_visuals, value_score, status)
SELECT
  $1::date, $2, $3, $4, $5, $6::smallint, '待制作'
WHERE $7::text = 'insert'
ON CONFLICT (report_date, title) DO UPDATE SET
  angle = EXCLUDED.angle,
  source_material = EXCLUDED.source_material,
  reference_visuals = EXCLUDED.reference_visuals,
  value_score = EXCLUDED.value_score,
  updated_at = NOW()`,
    "={{ [ $json.report_date, $json.title, $json.angle, $json.source_material, $json.reference_visuals, $json.value_score, $json.mode ] }}"
  );
  ideaInsert.position = [ideaRoute.position[0] + 200, ideaRoute.position[1]];

  const ideaUpdate = makePostgres(
    "选题更新",
    ideaWrite,
    `-- 合并更全的字段到主记录；status 永不更新（人工字段）
UPDATE public.topic_ideas
SET angle = COALESCE($2, angle),
    source_material = COALESCE($3, source_material),
    reference_visuals = COALESCE($4, reference_visuals),
    value_score = COALESCE($5::smallint, value_score),
    updated_at = NOW()
WHERE id = $1::int
  AND $6::text = 'update'`,
    "={{ [ $json.matched_id, $json.angle, $json.source_material, $json.reference_visuals, $json.value_score, $json.mode ] }}"
  );
  ideaUpdate.position = [ideaInsert.position[0], ideaInsert.position[1] + 200];

  const ideaCleanIdx = nodes.findIndex((n) => n.name === "选题清洗");
  // 选题清洗：输出候选数组
  const newIdeaClean = makeCode("选题清洗", ideaClean, `// 选题提取结果清洗（阶段 2）：剥围栏 → 解析 JSON 数组 → 拆 item
const raw = $json.text ?? $json.output ?? "";
let s = String(raw).trim();
const fence = s.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/i);
if (fence) s = fence[1].trim();
const start = s.indexOf("[");
const end = s.lastIndexOf("]");
if (start === -1 || end === -1 || end <= start) return [];
let arr;
try { arr = JSON.parse(s.slice(start, end + 1)); } catch (e) { return []; }
if (!Array.isArray(arr)) return [];
const date = $("取日报正文").first().json.report_date;
return arr
  .filter((i) => i && typeof i.title === "string" && i.title.trim())
  .slice(0, 5)
  .map((i) => ({
    json: {
      report_date: date,
      title: String(i.title).trim(),
      angle: typeof i.angle === "string" ? i.angle : null,
      source_material: typeof i.source_material === "string" ? i.source_material : null,
      reference_visuals: typeof i.reference_visuals === "string" ? i.reference_visuals : null,
      value_score: Number.isInteger(i.value_score) ? Math.min(10, Math.max(1, i.value_score)) : null
    }
  }));
`);
  nodes[ideaCleanIdx] = newIdeaClean;

  const ideaWriteIdx = nodes.findIndex((n) => n.name === "选题写入");
  nodes[ideaWriteIdx] = ideaInsert;

  nodes.push(ideaLookup, ideaDedup, ideaRoute, ideaUpdate);
  added.push("选题查库", "选题去重", "选题写入分流", "选题更新");

  connections["选题清洗"] = { main: [[{ node: "选题查库", type: "main", index: 0 }]] };
  connections["选题查库"] = { main: [[{ node: "选题去重", type: "main", index: 0 }]] };
  connections["选题去重"] = { main: [[{ node: "选题写入分流", type: "main", index: 0 }]] };
  connections["选题写入分流"] = {
    main: [[{ node: "选题插入", type: "main", index: 0 }], [{ node: "选题更新", type: "main", index: 0 }]],
  };

  return { added };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const promptPatched = patchPrompt();
const validationPatched = patchValidation();
const opp = applyOppChain();
const idea = applyIdeaChain();

console.log("=== 阶段 D 改造摘要 ===");
console.log(`施工项 3 prompt 稳定化: ${promptPatched ? "已应用" : "已存在（跳过）"}`);
console.log(`施工项 4 结构校验增强: ${validationPatched ? "已应用" : "已存在（跳过）"}`);
console.log(`施工项 5 商机链路: 新增节点 ${opp.added.join(", ")}`);
console.log(`施工项 5 选题链路: 新增节点 ${idea.added.join(", ")}`);
console.log(`节点总数: ${nodes.length}`);

// 连通性自检
const nodeNames = new Set(nodes.map((n) => n.name));
const missing: string[] = [];
for (const [src, cfg] of Object.entries(connections)) {
  if (!nodeNames.has(src)) missing.push(`连接源不存在: ${src}`);
  for (const outs of cfg.main ?? []) {
    for (const c of outs) {
      if (!nodeNames.has(c.node)) missing.push(`连接目标不存在: ${src} -> ${c.node}`);
    }
  }
}
if (missing.length) {
  console.error("❌ 连通性自检失败：");
  for (const m of missing) console.error("   " + m);
  process.exit(1);
}
console.log("连通性自检: 通过");

if (mode === "inspect") {
  writeFileSync("/tmp/n8n-edit/nodes-new.json", JSON.stringify(nodes, null, 2));
  writeFileSync("/tmp/n8n-edit/conn-new.json", JSON.stringify(connections, null, 2));
  console.log("\n（inspect 模式：仅生成 /tmp/n8n-edit/nodes-new.json 与 conn-new.json，未写库）");
  process.exit(0);
}

/* --------------------------- 写库 --------------------------- */

const newVersion = uuid();
const now = new Date().toISOString();

// 写入 workflow_history（复制旧版本的其余字段）
sqlite(`PRAGMA wal_checkpoint(TRUNCATE);`);
const cols = sqlite(`PRAGMA table_info(workflow_history);`);
console.log("\nworkflow_history 列:", cols.split("\n").map((l) => l.split("|")[1]).filter(Boolean).join(", "));

// 用 INSERT ... SELECT 复制旧版本行，再覆盖 versionId / nodes / connections
// 注意：workflow_history 主键是 versionId，没有 id 列。
const templateRow = sqlite(
  `SELECT versionId FROM workflow_history WHERE versionId='${OLD_VERSION}' LIMIT 1`
);
if (!templateRow) throw new Error("找不到旧版本所在的 workflow_history 行");

const shortVersion = newVersion.slice(0, 8);
sqlite(`
INSERT INTO workflow_history
  (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description, nodeGroups)
SELECT
  '${newVersion}', workflowId, authors, ${sqlLit(now)}, ${sqlLit(now)},
  ${sqlLit(JSON.stringify(nodes))}, ${sqlLit(JSON.stringify(connections))},
  'Version ${shortVersion}', autosaved, description, nodeGroups
FROM workflow_history WHERE versionId='${OLD_VERSION}' LIMIT 1;
`);

// 更新 workflow_entity：
//   1. draft 与 active 都指向新版本（即「发布」）
//   2. nodes / connections 必须同步为新内容 —— n8n 运行时读的是实体表这两个字段，
//      只写 workflow_history 的话新节点不会真正生效（这是阶段 D 第一版踩过的坑）
sqlite(`
UPDATE workflow_entity
SET versionId='${newVersion}',
    activeVersionId='${newVersion}',
    nodes=${sqlLit(JSON.stringify(nodes))},
    connections=${sqlLit(JSON.stringify(connections))},
    updatedAt=${sqlLit(now)}
WHERE id='${WF_ID}';
`);

// 更新 published_version
sqlite(`
UPDATE workflow_published_version
SET publishedVersionId='${newVersion}'
WHERE workflowId='${WF_ID}';
`);

console.log("\n=== 写库完成 ===");
console.log(`新 versionId: ${newVersion}`);
console.log(`workflow_entity.versionId      = ${sqlite(`SELECT versionId FROM workflow_entity WHERE id='${WF_ID}';`)}`);
console.log(`workflow_entity.activeVersionId= ${sqlite(`SELECT activeVersionId FROM workflow_entity WHERE id='${WF_ID}';`)}`);
console.log(`published_versionId            = ${sqlite(`SELECT publishedVersionId FROM workflow_published_version WHERE workflowId='${WF_ID}';`)}`);
console.log(`workflow_entity.nodes 节点数    = ${sqlite(`SELECT json_array_length(nodes) FROM workflow_entity WHERE id='${WF_ID}';`)}`);
console.log(`workflow_history 新版本节点数   = ${sqlite(`SELECT json_array_length(nodes) FROM workflow_history WHERE versionId='${newVersion}';`)}`);

// 一致性自检：实体表与 history 的 nodes/connections 必须逐字节一致
const entityNodes = sqlite(`SELECT nodes FROM workflow_entity WHERE id='${WF_ID}';`);
const historyNodes = sqlite(`SELECT nodes FROM workflow_history WHERE versionId='${newVersion}';`);
const entityConns = sqlite(`SELECT connections FROM workflow_entity WHERE id='${WF_ID}';`);
const historyConns = sqlite(`SELECT connections FROM workflow_history WHERE versionId='${newVersion}';`);
const nodesMatch = entityNodes === historyNodes;
const connsMatch = entityConns === historyConns;
console.log(`实体表与 history 的 nodes 一致  = ${nodesMatch ? "是" : "否 ✗"}`);
console.log(`实体表与 history 的 connections 一致 = ${connsMatch ? "是" : "否 ✗"}`);
if (!nodesMatch || !connsMatch) throw new Error("实体表与 workflow_history 不一致，发布中止");

console.log(`integrity_check                = ${sqlite("PRAGMA integrity_check;")}`);
