// 内容策划生成 —— 纯函数，无 IO
//
// 红线（契约 §4）：
// - 只基于传入的文本生成，不编造事实、不补链接、不加数据、不引入外部知识；
// - 信息不足的项一律进 openQuestions，不猜测；
// - 同一输入必须得到同一输出（可测试）。
//
// 本文件禁止 import pg / fs / fetch，禁止读环境变量。

export interface ContentPlanInput {
  topicTitle: string;
  angle?: string | null;
  sourceMaterial?: string | null;
  referenceVisuals?: string | null;
}

export interface ContentPlan {
  contentAngle: string;
  hook: string;
  keyPoints: string[];
  openQuestions: string[];
  suggestedDuration: number;
  videoForm: string;
}

/** 单条要点的最大长度（超出按句式截断并加省略号） */
const MAX_POINT_LEN = 80;
/** 最多提取的要点条数 */
const MAX_POINTS = 5;
/** 含未确认表述的措辞（命中即提示人工核实） */
const UNCONFIRMED_PATTERN = /(据称|疑似|传闻|未证实|未公布|被指|爆料|曝|据说|可能)/;

const URL_PATTERN = /https?:\/\/[^\s，。；、）)」』"']+/gi;
/** github issue / 普通链接都能识别，仅用于判断「有没有可追溯来源」 */
const HAS_URL_PATTERN = /https?:\/\//i;

function normalize(v: string | null | undefined): string {
  return (v ?? "").replace(/\r\n?/g, "\n").trim();
}

/** 去掉 markdown 修饰符，保留文字本身 */
function stripMarkup(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 按中文/英文标点切句，过滤空白与过短碎片 */
function sentences(text: string): string[] {
  return normalize(text)
    .split(/[。！？!?；;\n]+/)
    .map((s) => stripMarkup(s).replace(URL_PATTERN, "").trim())
    .map((s) => s.replace(/^[-—·\d.、)）\s]+/, "").trim())
    // 去掉句尾残留的冒号/逗号（原文常是「标题：链接」结构）
    .map((s) => s.replace(/[：:，,、\s]+$/, "").trim())
    // 中文短句 4 字即可承载事实（如「官方已回应」），低于 4 字多为标点碎片
    .filter((s) => s.length >= 4);
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function firstSentence(v: string | null | undefined): string {
  const list = sentences(normalize(v));
  return list[0] ?? "";
}

function uniqueByNormalized(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.replace(/[\s，。、；：！？!?.,;:]/g, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * 生成策划草稿。
 *
 * 输出语义（不夸大）：
 * - contentAngle：原文角度；缺失时给中性占位并记入 openQuestions；
 * - hook：由角度/素材首句派生的开场句，但**不添加任何新事实**；
 * - keyPoints：从 source_material 按句抽取的原文要点（去链接、去 markdown）；
 * - suggestedDuration：按要点条数线性估算的建议值，非测量结果；
 * - videoForm：只根据「有没有素材 / 有没有参考画面」决定，不假定资源条件。
 */
export function generateContentPlan(input: ContentPlanInput): ContentPlan {
  const title = normalize(input.topicTitle);
  const angle = normalize(input.angle);
  const material = normalize(input.sourceMaterial);
  const visuals = normalize(input.referenceVisuals);

  const openQuestions: string[] = [];

  // ---------- 角度 ----------
  const angleSentences = uniqueByNormalized(sentences(angle)).map((s) => clip(s, MAX_POINT_LEN * 2));
  let contentAngle: string;
  if (angleSentences.length > 0) {
    contentAngle = angleSentences.slice(0, 2).join("；");
  } else {
    contentAngle = "切入角度待确认（原始选题未提供角度）";
    openQuestions.push("缺少切入角度（angle），需人工确定本片的立场与叙述视角");
  }

  // ---------- 要点 ----------
  const materialSentences = uniqueByNormalized(sentences(material));
  let keyPoints = materialSentences.slice(0, MAX_POINTS).map((s) => clip(s, MAX_POINT_LEN));

  if (keyPoints.length === 0) {
    // 素材缺失时退回角度文本，不凭空造事实
    keyPoints = angleSentences.slice(0, MAX_POINTS).map((s) => clip(s, MAX_POINT_LEN));
    if (materialSentences.length === 0) {
      openQuestions.push("缺少来源素材（source_material），无法核对事实细节");
    }
  }

  // ---------- 钩子 ----------
  const angleLead = angleSentences[0] ?? "";
  const materialLead = materialSentences[0] ?? "";
  let hook: string;
  if (angleLead) {
    hook = `先别急着下结论：${clip(angleLead, 60)}`;
  } else if (materialLead) {
    hook = `先看事实：${clip(materialLead, 60)}`;
  } else {
    hook = `「${clip(title, 40)}」——原始素材缺失，需先补齐来源`;
  }

  // ---------- 待核实 ----------
  if (material && !HAS_URL_PATTERN.test(material)) {
    openQuestions.push("来源素材未包含原文链接，无法定位到具体头条，发布前需补链接");
  }

  // 素材只有「《文章标题》+ 链接」时，抽取到的要点其实只是标题，必须明确提示
  const factualSentences = materialSentences.filter((s) => !/^《.*》$/.test(s));
  if (material && factualSentences.length === 0) {
    openQuestions.push("来源素材只有文章标题与链接，缺少可复述的事实细节，需阅读原文后补充要点");
  }
  if (!visuals) {
    openQuestions.push("缺少参考画面（reference_visuals），需人工补充视觉方向或分镜参考");
  }
  if (title.includes("？") || title.includes("?")) {
    openQuestions.push("标题本身是疑问句，片中必须在核实后给出明确结论，不能只抛问题");
  }

  const unconfirmed = UNCONFIRMED_PATTERN.exec(`${title} ${angle} ${material}`);
  if (unconfirmed) {
    openQuestions.push(
      `来源含「${unconfirmed[1]}」等未确认表述，发布前需人工二次核实，片中不得当作既定事实`
    );
  }

  // ---------- 时长 / 形式 ----------
  const suggestedDuration = Math.min(180, Math.max(30, 45 + keyPoints.length * 15));

  let videoForm: string;
  if (material && visuals) videoForm = "口播 + 图文 + 参考画面复现";
  else if (material) videoForm = "口播 + 图文";
  else if (visuals) videoForm = "口播 + 参考画面复现";
  else videoForm = "口播（素材待补）";

  return {
    contentAngle,
    hook,
    keyPoints,
    openQuestions: uniqueByNormalized(openQuestions),
    suggestedDuration,
    videoForm,
  };
}
