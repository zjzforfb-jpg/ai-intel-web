// 趋势观察中心：热点词频统计、时间序列与持续热点识别（只读）
//
// 统计方案（与 lib/search.ts 的 ILIKE 中文子串方案同源结论）：
// - PG 原生 FTS 不分词中文（项目内已实测否定 plainto_tsquery），因此词频统计放在 Node 侧：
//   拉取日期范围内的日报（title + report_markdown）后做词元抽取与计数——
//   · 拉丁词元：连续 [A-Za-z][A-Za-z0-9]（含 . - + # 连接，如 GPT-5.6、Ripple-65B、K3.1-Pro）
//   · 中文词元：CJK 连续段的 2~6 字 n-gram（不引入任何分词依赖），
//     再用「固定版式短语剔除 + 虚词边界过滤 + 停用词过滤 + 长词包含剪枝」压制碎片噪声
// - 热度 = 标题出现次数 × 3 + 正文出现次数；逐日时间序列用原始出现次数（标题+正文）
// - 全部 SQL 参数化、仅 SELECT（getReadPool）；数据不足时返回空数组，由页面渲染空态，不造数

import { getReadPool, getStats } from "@/lib/db";
import { todayStr } from "@/lib/format";

/* ==================== 类型 ==================== */

export interface TrendReportRow {
  report_date: string;
  title: string;
  report_markdown: string | null;
  total_articles: number | null;
  headline_count: number | null;
}

export interface KeywordPoint {
  /** 报告日期 YYYY-MM-DD */
  date: string;
  /** 该日日报中出现次数（标题+正文） */
  count: number;
}

export interface KeywordStat {
  term: string;
  /** 热度 = 标题出现 × 3 + 正文出现 */
  score: number;
  /** 标题+正文出现总次数 */
  count: number;
  titleCount: number;
  /** 出现过的不同报告日数 */
  days: number;
  /** 逐日出现次数（与所选范围内报告日一一对齐） */
  series: KeywordPoint[];
}

export interface PersistentHotspot extends KeywordStat {
  /** 出现过的报告日期（升序） */
  activeDates: string[];
  /** 最长连续（自然日）出现天数 */
  maxStreak: number;
}

export interface DailyStatPoint {
  date: string;
  title: string;
  totalArticles: number | null;
  headlineCount: number | null;
}

export interface TrendsData {
  /** 按日期升序的每日报量 */
  daily: DailyStatPoint[];
  /** 热词榜（按热度降序） */
  keywords: KeywordStat[];
  /** 频次趋势折线图取用的前 5 个热词 */
  chartKeywords: KeywordStat[];
  /** 持续热点：在 ≥2 个不同报告日反复出现 */
  persistent: PersistentHotspot[];
  totals: {
    reports: number;
    articles: number;
    headlines: number;
    keywordCount: number;
  };
}

export interface TrendsPayload {
  data: TrendsData;
  /** 全库数据边界（供筛选控件与空态提示使用） */
  catalog: {
    totalReports: number;
    earliest: string | null;
    latest: string | null;
  };
}

/* ==================== 时间范围（URL query 状态） ==================== */

export type RangeMode = "all" | "7d" | "30d" | "custom";

export interface TrendRange {
  mode: RangeMode;
  from: string | null;
  to: string | null;
  /** 展示用的范围说明 */
  label: string;
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** 仅接受合法 YYYY-MM-DD，其余一律忽略（不把非法值传给数据库） */
function sanitizeDate(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? "" : v;
}

/** UTC 纯日期加减天数，返回 YYYY-MM-DD */
function shiftDate(dateStr: string, days: number): string {
  const t = new Date(`${dateStr}T00:00:00Z`).getTime() + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * 解析 /trends 的筛选状态：
 * - range=7d / 30d：相对「今天（展示时区）」的近 7 / 30 天
 * - range=custom&from=&to=：自定义起止日期（起止颠倒自动交换；两者皆空等价于全部）
 * - range=all 或缺省：全部时间
 */
export function resolveTrendRange(sp: {
  [key: string]: string | string[] | undefined;
}): TrendRange {
  const rangeRaw = firstParam(sp.range);
  const fromRaw = sanitizeDate(firstParam(sp.from));
  const toRaw = sanitizeDate(firstParam(sp.to));

  let mode: RangeMode;
  if (rangeRaw === "7d" || rangeRaw === "30d" || rangeRaw === "all") {
    mode = rangeRaw;
  } else if (rangeRaw === "custom" || fromRaw || toRaw) {
    mode = "custom";
  } else {
    mode = "all";
  }

  const today = todayStr();
  if (mode === "7d" || mode === "30d") {
    const span = mode === "7d" ? 6 : 29;
    const from = shiftDate(today, -span);
    return {
      mode,
      from,
      to: today,
      label: `近 ${span + 1} 天（${from} ~ ${today}）`,
    };
  }

  if (mode === "custom") {
    let from = fromRaw || null;
    let to = toRaw || null;
    if (from && to && from > to) {
      [from, to] = [to, from];
    }
    if (!from && !to) {
      return { mode: "all", from: null, to: null, label: "全部时间" };
    }
    return {
      mode: "custom",
      from,
      to,
      label: `自定义范围（${from ?? "最早"} ~ ${to ?? "最新"}）`,
    };
  }

  return { mode: "all", from: null, to: null, label: "全部时间" };
}

/** 由筛选状态构造 /trends 查询串（空值不入 URL） */
export function rangeToQuery(range: Pick<TrendRange, "mode" | "from" | "to">): string {
  const sp = new URLSearchParams();
  if (range.mode === "7d" || range.mode === "30d") {
    sp.set("range", range.mode);
  } else if (range.mode === "custom") {
    sp.set("range", "custom");
    if (range.from) sp.set("from", range.from);
    if (range.to) sp.set("to", range.to);
  }
  return sp.toString();
}

/* ==================== 数据查询（仅 SELECT，参数化） ==================== */

/** 一次最多纳入统计的报告数（防止极端情况下拉爆内存） */
const MAX_TREND_REPORTS = 1000;

export async function fetchTrendReports(
  from: string | null,
  to: string | null
): Promise<TrendReportRow[]> {
  const client = await getReadPool().connect();
  try {
    const res = await client.query<TrendReportRow>(
      `SELECT report_date::text, title, report_markdown, total_articles, headline_count
       FROM daily_reports
       WHERE ($1::date IS NULL OR report_date >= $1::date)
         AND ($2::date IS NULL OR report_date <= $2::date)
       ORDER BY report_date ASC
       LIMIT $3::int`,
      [from, to, MAX_TREND_REPORTS]
    );
    return res.rows;
  } finally {
    client.release();
  }
}

/* ==================== 热词抽取（纯函数） ==================== */

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const LATIN_RE = /[A-Za-z][A-Za-z0-9]*(?:[-.+#][A-Za-z0-9]+)*/g;
const CJK_RUN_RE = /[\u4e00-\u9fff]+/g;

/**
 * 日报固定版式短语（章节名/字段名/固定注记）：出现频次极高但没有主题信息，
 * 若不剔除会以 n-gram 碎片形式霸榜，统计前整段替换为空格。
 */
const BOILERPLATE_PHRASES = [
  "每日AI情报内参",
  "AI情报内参",
  "今日核心判断",
  "今日必读头条",
  "重点领域动态",
  "行业趋势观察",
  "开发者与创业者机会",
  "明日重点关注",
  "来源及发布时间",
  "核心事实",
  "深度解读",
  "对行业的影响",
  "原文链接",
  "判断依据",
  "机会来源",
  "实现方向",
  "潜在价值",
  "待核实",
  "详见头条",
  "本内参已合并同一事件的重复来源",
  "信息不足处均标注",
  "观点与事实分开表述",
  "以下时间均为原文发布时间",
  "同日重复条目已合并",
  "重复来源已合并",
  "今日给定输入中暂无",
  "给定摘要",
  "给定输入",
];

/** 语法虚词字：n-gram 以它们开头/结尾的视为碎片，直接丢弃 */
const EDGE_STOP_CHARS = new Set([
  "的", "了", "着", "过", "吗", "呢", "吧", "啊",
  "与", "及", "或", "和", "在", "是", "把", "被", "等",
  "为", "对", "从", "但", "而", "且", "之", "其", "们",
  "也", "就", "都", "很", "更", "最", "再", "还", "只",
  "可", "以", "要", "需", "将", "已", "未", "让", "使",
  "给", "向", "由", "因", "所", "若", "则", "却", "又",
  "仅", "另", "某", "什", "么", "并", "该", "每", "各",
  "此", "些", "个", "种", "于",
]);

/**
 * 高频但无主题区分度的通用词（整词精确匹配）。
 * 只收「报告行文词」与「AI 赛道日日出现的泛词」；
 * 复合主题词（大模型 / 开放权重 / 代码智能体 / 漏洞补丁 / 许可证…）不在此列，会正常上榜。
 */
const STOP_TERMS = new Set([
  // 指代 / 时间 / 连接
  "今天", "今日", "明天", "昨日", "日前", "近日", "近期", "当前", "目前", "现在",
  "未来", "过去", "之前", "之后", "以后", "以前", "此前", "此后", "此次", "本次",
  "当天", "每日", "连日", "这个", "那个", "这些", "那些", "这样", "那样", "这里",
  "那里", "什么", "怎么", "为何", "为什么", "多少", "几个", "之一", "如下", "以上",
  "以下", "等等", "之类", "以及", "或者", "还是", "就是", "不是", "没有", "也是",
  "都是", "一直", "一样", "一般", "非常", "比较", "相对", "尤其", "此外", "另外",
  "包括", "其中", "同时", "不过", "只是", "只有", "无论", "不管", "任何", "所有",
  "全部", "部分", "方面", "情况", "过程", "结果", "原因", "问题", "方式", "方法",
  "手段", "作用", "意义", "程度", "水平", "阶段", "状态", "形式", "本质", "核心",
  "关键", "重点", "主要", "重要", "基本", "直接", "真正", "实际", "具体", "整体",
  "局部", "相关", "有关", "关于", "对于", "根据", "依据", "基于", "通过", "经过",
  "进行", "实现", "完成", "出现", "发生", "开始", "继续", "保持", "改变", "增加",
  "减少", "扩大", "降低", "提升", "推动", "促进", "带来", "使得", "导致", "成为",
  "作为", "存在", "具有", "包含", "需要", "应该", "可以", "可能", "能够", "必须",
  "将会", "已经", "正在", "尚未", "不再", "仍然", "依然", "重新", "再次", "进一步",
  "日益", "逐渐", "不断", "大幅", "显著", "明显", "较为", "越来越", "值得一提",
  // 日报行文词（出现在每条条目里，无主题信息）
  "来源", "原文", "链接", "标题", "时间", "日期", "发布", "报道", "消息", "信息",
  "内容", "表示", "认为", "指出", "显示", "宣布", "推出", "更新", "迭代", "版本",
  "系列", "详情", "全文", "摘要", "简述", "介绍", "说明", "描述", "提到", "称为",
  "名为", "叫做", "解读", "影响", "事实", "观点", "判断", "机会", "方向", "价值",
  "趋势", "观察", "动态", "领域", "场景", "关注", "竞争", "聚焦", "行业", "企业",
  "公司", "市场", "业务", "生态", "收购", "融资", "合作", "战略", "布局",
  // AI 赛道超高频泛词（几乎每期日报都会出现，压制后复合主题词才能浮出）
  "模型", "能力", "技术", "研究", "产品", "工具", "平台", "系统", "服务", "应用",
  "数据", "用户", "算法", "算力", "训练", "推理", "开发", "编程", "代码", "智能",
  "人工", "代理", "成本", "价格", "规模", "性能", "效果", "体验", "功能", "特性",
  "特点", "优势", "挑战", "风险", "潜力", "前景", "需求", "开源", "闭源", "参数",
  "安全", "合规", "生成", "发现", "国内", "支持", "提供", "利用", "采用", "使用",
  "构建", "建立", "打造",
]);

/** 拉丁停用词：英文功能词与 URL/Markdown 残留 */
const LATIN_STOP = new Set([
  "the", "and", "for", "with", "this", "that", "from", "are", "was", "were",
  "have", "has", "had", "not", "but", "you", "all", "can", "its", "into",
  "when", "what", "how", "why", "also", "more", "most", "some", "such", "than",
  "then", "them", "they", "their", "there", "here", "out", "over", "under",
  "about", "after", "before", "between", "during", "without", "within", "via",
  "com", "www", "https", "http", "html", "php", "index", "src", "href", "img",
  "png", "jpg", "jpeg", "svg", "css", "js", "span", "div", "strong", "nbsp",
  "pdf", "blog", "news", "post", "page", "item", "inc", "ltd", "llc", "et",
  "al", "vs", "pro", "plus", "max", "mini", "base", "flash", "preview",
  "release", "update", "new", "free", "full", "read", "view", "story", "utc",
]);

interface TermCount {
  display: string;
  count: number;
}

function cleanText(text: string): string {
  let t = text.replace(URL_RE, " ");
  for (const phrase of BOILERPLATE_PHRASES) {
    if (t.includes(phrase)) {
      t = t.split(phrase).join(" ");
    }
  }
  return t;
}

/**
 * 从一段文本里抽取词元及出现次数：
 * 拉丁词元按完整 token 计；中文按 2~4 字 n-gram 滑窗计（不做分词、不引入依赖）。
 */
function extractTerms(text: string): Map<string, TermCount> {
  const out = new Map<string, TermCount>();
  const add = (key: string, display: string) => {
    const cur = out.get(key);
    if (cur) cur.count += 1;
    else out.set(key, { display, count: 1 });
  };

  const cleaned = cleanText(text);

  for (const m of cleaned.matchAll(LATIN_RE)) {
    const raw = m[0];
    if (raw.length < 2) continue;
    const key = raw.toLowerCase();
    if (LATIN_STOP.has(key)) continue;
    add(key, raw);
  }

  for (const m of cleaned.matchAll(CJK_RUN_RE)) {
    const run = m[0];
    for (let len = 2; len <= 6; len++) {
      for (let i = 0; i + len <= run.length; i++) {
        const term = run.slice(i, i + len);
        if (EDGE_STOP_CHARS.has(term[0]) || EDGE_STOP_CHARS.has(term[len - 1])) continue;
        if (STOP_TERMS.has(term)) continue;
        add(term, term);
      }
    }
  }

  return out;
}

/** 长词包含剪枝：若某更长词覆盖了某短词的大部分出现次数，短词视为碎片丢弃 */
function pruneSubsumed(items: KeywordStat[]): KeywordStat[] {
  const byLenDesc = [...items].sort((a, b) => b.term.length - a.term.length);
  const kept: KeywordStat[] = [];
  for (const cand of byLenDesc) {
    const dominated = kept.some(
      (longer) =>
        longer.term !== cand.term &&
        longer.term.includes(cand.term) &&
        longer.count >= cand.count * 0.8
    );
    if (!dominated) kept.push(cand);
  }
  return kept;
}

/** 最长连续（自然日）出现天数；日期升序 */
function calcMaxStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  let best = 1;
  let cur = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(`${dates[i - 1]}T00:00:00Z`).getTime();
    const now = new Date(`${dates[i]}T00:00:00Z`).getTime();
    if (now - prev === 86400000) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 1;
    }
  }
  return best;
}

/* ==================== 聚合 ==================== */

interface TermAgg {
  display: string;
  titleCount: number;
  bodyCount: number;
  /** date → 标题+正文出现次数 */
  perDay: Map<string, number>;
}

export function computeTrends(rows: TrendReportRow[]): TrendsData {
  const daily: DailyStatPoint[] = [];
  const agg = new Map<string, TermAgg>();

  for (const row of rows) {
    const date = row.report_date;
    daily.push({
      date,
      title: row.title,
      totalArticles: row.total_articles ?? null,
      headlineCount: row.headline_count ?? null,
    });

    const titleTerms = extractTerms(row.title);
    const bodyTerms = extractTerms(row.report_markdown ?? "");

    const merge = (key: string, t: TermCount, isTitle: boolean) => {
      let a = agg.get(key);
      if (!a) {
        a = { display: t.display, titleCount: 0, bodyCount: 0, perDay: new Map() };
        agg.set(key, a);
      }
      if (isTitle) a.titleCount += t.count;
      else a.bodyCount += t.count;
      a.perDay.set(date, (a.perDay.get(date) ?? 0) + t.count);
    };

    for (const [key, t] of titleTerms) merge(key, t, true);
    for (const [key, t] of bodyTerms) merge(key, t, false);
  }

  const dates = daily.map((d) => d.date);

  const toStat = (a: TermAgg): KeywordStat => {
    const count = a.titleCount + a.bodyCount;
    return {
      term: a.display,
      score: a.titleCount * 3 + a.bodyCount,
      count,
      titleCount: a.titleCount,
      days: a.perDay.size,
      series: dates.map((date) => ({ date, count: a.perDay.get(date) ?? 0 })),
    };
  };

  const all: KeywordStat[] = [];
  for (const a of agg.values()) {
    if (STOP_TERMS.has(a.display) || LATIN_STOP.has(a.display.toLowerCase())) continue;
    all.push(toStat(a));
  }

  // 热点至少需要重复出现（≥2 次）；数据极少时放宽到 1 次（仍是真实数据，不造数）
  let kept = all.filter((k) => k.count >= 2);
  if (kept.length < 6) {
    kept = all.filter((k) => k.count >= 1);
  }
  kept = pruneSubsumed(kept);

  const byScore = (a: KeywordStat, b: KeywordStat) =>
    b.score - a.score ||
    b.count - a.count ||
    b.days - a.days ||
    b.term.length - a.term.length ||
    a.term.localeCompare(b.term);

  const keywords = [...kept].sort(byScore);

  const persistent: PersistentHotspot[] = kept
    .filter((k) => k.days >= 2)
    .map((k) => {
      const activeDates = k.series.filter((p) => p.count > 0).map((p) => p.date);
      return { ...k, activeDates, maxStreak: calcMaxStreak(activeDates) };
    })
    .sort((a, b) => b.days - a.days || b.score - a.score || b.count - a.count)
    .slice(0, 12);

  return {
    daily,
    keywords: keywords.slice(0, 30),
    chartKeywords: keywords.slice(0, 5),
    persistent,
    totals: {
      reports: rows.length,
      articles: rows.reduce((s, r) => s + (r.total_articles ?? 0), 0),
      headlines: rows.reduce((s, r) => s + (r.headline_count ?? 0), 0),
      keywordCount: kept.length,
    },
  };
}

export async function getTrendsData(range: TrendRange): Promise<TrendsPayload> {
  const [rows, stats] = await Promise.all([
    fetchTrendReports(range.from, range.to),
    getStats(),
  ]);
  return {
    data: computeTrends(rows),
    catalog: {
      totalReports: stats.total_reports,
      earliest: stats.earliest_date,
      latest: stats.latest_date,
    },
  };
}
