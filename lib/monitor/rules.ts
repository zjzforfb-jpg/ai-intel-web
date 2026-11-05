// 数据质量检查规则 —— Owner: Agent A（在 v0 最小实现上补全为生产级规则集）
// 约束：纯函数 —— 不访问数据库、不发通知、不读环境变量；输入为已取回的数据行
// IssueCode 仅使用 types.ts 现有 12 码（本模块未新增码）；
// message ≤200 字、中文、可诊断（指出字段/日期/差多少）；meta 仅标量；报告正文不进 message/meta
import type { QualityIssue } from "./types";
import type { ReportRow } from "@/lib/db";
import { parseReport } from "@/lib/markdown-parser";

/** 检查上下文：一次检查所需输入（由 runner 组装） */
export interface QualityCheckContext {
  reports: ReportRow[];
  expectedDates: string[];
  today: string;
  minContentLength: number;
  /**
   * 覆盖性窗口（天），可选：
   * >0 时启用 STALE_DATA —— (today-staleDays, today] 窗口内无任何合法报告即报 error。
   * 缺省不启用：runner 现有调用只传单日行，覆盖性查询仍留在 runner（其能直接查库取窗口计数，
   * 行为保持不变、不会与本判定重复上报）；批量/离线调用方传入窗口行 + staleDays 即可复用本纯函数判定。
   */
  staleDays?: number;
}

/**
 * 六个固定章节（命名取自 lib/markdown-parser.ts 的结构约定），
 * 匹配口径与 parseReport 的分发正则一致（宽松 contains，容忍「一、」等序号前缀）。
 */
const REQUIRED_SECTIONS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "今日核心判断", pattern: /核心判断/ },
  { name: "今日必读头条", pattern: /必读头条|今日头条/ },
  { name: "重点领域动态", pattern: /重点领域/ },
  { name: "行业趋势观察", pattern: /趋势观察|行业趋势/ },
  { name: "开发者与创业者机会", pattern: /创业者机会|商业机会/ },
  { name: "明日重点关注", pattern: /明日.{0,4}(关注|重点)/ },
];

/** validation JSONB 中 n8n 校验门要求全为 true 的三个标志 */
const VALIDATION_FLAGS = ["has_content", "has_core_judgment", "has_headlines"] as const;

/** markdown_length 与实际长度允许的最大相对偏差（严格大于才触发） */
const LENGTH_DRIFT_LIMIT = 0.2;

/** Date 对象 → 日历日的取法口径（与 runner 的 todayShanghai 同为 Asia/Shanghai） */
const SHANGHAI_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });

/**
 * 宽松取日期：兼容两种真实输入 ——
 * 1) pg 对 DATE 列返回的 Date 对象（postgres-date 用本地时区午夜构造，runner 的 SELECT * 路径）；
 * 2) "YYYY-MM-DD" 或 "YYYY-MM-DD ..." 带后缀的字符串（::text 查询路径，与 runner 的 slice(0,10) 口径一致）。
 * 统一归一为 YYYY-MM-DD；非法日历日期（如 2026-13-45）、Invalid Date 返回 null。
 */
function normalizeDate(raw: unknown): string | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    // Date 只代表某个日历日，用 Asia/Shanghai（与 runner/展示时区一致）取回该日期，避免本地时区漂移
    return SHANGHAI_DATE_FMT.format(raw);
  }
  if (typeof raw !== "string" || !raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** 纯日期加减（UTC 正午取整，避免时区漂移），返回 YYYY-MM-DD */
function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** 标题归一化：小写并去掉空白/标点/符号，仅保留字母与数字（含 CJK），用于雷同判定 */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function sortedEntries(byDate: Map<string, ReportRow[]>): Array<[string, ReportRow[]]> {
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * 规则集入口：对一批报告行做纯函数质量检查。
 * 覆盖：报告缺失 / 同日重复 / 标题雷同 / 空内容 / 异常短 / 必需字段 / 未来日期 /
 *      Markdown 解析失败 / 结构缺章节（含核心判断空白）/ validation 标志异常 / 覆盖性缺失（按需）。
 */
export function runQualityChecks(ctx: QualityCheckContext): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // 按合法 report_date 分组（UNIQUE 约束下同日应只有一条，重复属防御性检查）
  const byDate = new Map<string, ReportRow[]>();
  for (const r of ctx.reports) {
    const d = normalizeDate(r.report_date);
    if (!d) continue; // 日期非法的行走逐行检查里的 INVALID_FIELDS
    const rows = byDate.get(d);
    if (rows) rows.push(r);
    else byDate.set(d, [r]);
  }

  // 1) 同 report_date 多条：每日期只报一次，count 指明条数
  for (const [d, rows] of sortedEntries(byDate)) {
    if (rows.length > 1) {
      issues.push({
        code: "DUPLICATE_REPORT",
        severity: "error",
        message: `日期 ${d} 存在 ${rows.length} 条报告记录（预期 1 条）`,
        meta: { date: d, count: rows.length },
      });
    }
  }

  // 2) 预期日期缺失（预期日期由调用方传入）
  for (const e of ctx.expectedDates) {
    const d = normalizeDate(e) ?? e;
    if (!byDate.has(d)) {
      issues.push({
        code: "MISSING_REPORT",
        severity: "error",
        message: `预期日期 ${d} 缺少日报`,
        meta: { date: d },
      });
    }
  }

  // 3) 逐行检查（同日重复行也逐条检查，meta.id 区分是哪一行）
  for (const r of ctx.reports) {
    checkRow(r, ctx, issues);
  }

  // 4) 不同日期标题雷同（每日期取首行；同日重复由 DUPLICATE_REPORT 负责）
  checkDuplicateTitles(byDate, issues);

  // 5) 覆盖性缺失（staleDays > 0 时启用）
  checkStale(ctx, byDate, issues);

  return issues;
}

/** 单行检查：字段合法性 → 未来日期 → validation 标志 → 正文与结构 */
function checkRow(r: ReportRow, ctx: QualityCheckContext, issues: QualityIssue[]): void {
  const date = normalizeDate(r.report_date);
  const where = date ? `报告 ${date}` : `记录#${r.id}`;
  const base = { id: r.id, date: date ?? null };

  // —— 必需字段 ——
  if (!date) {
    const raw = typeof r.report_date === "string" ? r.report_date : String(r.report_date ?? "");
    const shown = raw.trim() === "" ? "(空)" : raw.trim().slice(0, 24);
    issues.push({
      code: "INVALID_FIELDS",
      severity: "error",
      message: `${where} 的 report_date 非法（值：${shown}）`,
      meta: { ...base, field: "report_date", value: shown },
    });
  }
  if (!r.title || !r.title.trim()) {
    issues.push({
      code: "INVALID_FIELDS",
      severity: "error",
      message: `${where} 标题为空`,
      meta: { ...base, field: "title" },
    });
  }
  if (r.total_articles == null) {
    issues.push({
      code: "INVALID_FIELDS",
      severity: "error",
      message: `${where} 缺少 total_articles`,
      meta: { ...base, field: "total_articles" },
    });
  } else if (r.total_articles < 0) {
    issues.push({
      code: "INVALID_FIELDS",
      severity: "error",
      message: `${where} 的 total_articles 为负数（${r.total_articles}）`,
      meta: { ...base, field: "total_articles", value: r.total_articles },
    });
  }
  if (r.headline_count == null) {
    issues.push({
      code: "INVALID_FIELDS",
      severity: "error",
      message: `${where} 缺少 headline_count`,
      meta: { ...base, field: "headline_count" },
    });
  } else if (r.headline_count < 0) {
    issues.push({
      code: "INVALID_FIELDS",
      severity: "error",
      message: `${where} 的 headline_count 为负数（${r.headline_count}）`,
      meta: { ...base, field: "headline_count", value: r.headline_count },
    });
  }
  if (
    r.total_articles != null && r.total_articles >= 0 &&
    r.headline_count != null && r.headline_count >= 0 &&
    r.headline_count > r.total_articles
  ) {
    issues.push({
      code: "INVALID_FIELDS",
      severity: "error",
      message: `${where} 的 headline_count（${r.headline_count}）大于 total_articles（${r.total_articles}）`,
      meta: { ...base, field: "headline_count", headline_count: r.headline_count, total_articles: r.total_articles },
    });
  }
  if (r.generated_at == null || !String(r.generated_at).trim()) {
    issues.push({
      code: "INVALID_FIELDS",
      severity: "error",
      message: `${where} 缺少 generated_at`,
      meta: { ...base, field: "generated_at" },
    });
  }

  // —— 未来日期（只对合法日期判定，字符串比较对 YYYY-MM-DD 即字典序）——
  if (date && date > ctx.today) {
    issues.push({
      code: "FUTURE_DATE",
      severity: "error",
      message: `报告日期 ${date} 在未来（今天 ${ctx.today}）`,
      meta: { date, today: ctx.today },
    });
  }

  // —— validation 标志（与解析无关，独立判定）——
  checkValidationFlags(r, issues, where, r.report_markdown ? r.report_markdown.length : null);

  // —— 正文 ——
  const md = r.report_markdown;
  if (md == null || !md.trim()) {
    // 决策：report_markdown 为 null 归入 EMPTY_CONTENT（meta.markdownNull=true 区分），
    // 不新增 IssueCode —— 与纯空白正文同属「无可展示内容」，仅缺失原因不同。
    issues.push({
      code: "EMPTY_CONTENT",
      severity: "error",
      message: md == null ? `${where} 的 report_markdown 为 null，正文缺失` : `${where} 正文为空白`,
      meta: { ...base, markdownNull: md == null },
    });
    return;
  }

  const length = md.trim().length;
  if (length < ctx.minContentLength) {
    issues.push({
      code: "SHORT_CONTENT",
      severity: "warn",
      message: `${where} 正文仅 ${length} 字符，低于阈值 ${ctx.minContentLength}（差 ${ctx.minContentLength - length}）`,
      meta: { ...base, length, threshold: ctx.minContentLength },
    });
  }

  // —— 解析与结构 ——
  let parsed;
  try {
    parsed = parseReport(md);
  } catch {
    issues.push({
      code: "PARSE_FAILED",
      severity: "warn",
      message: `${where} 的 Markdown 解析抛出异常`,
      meta: base,
    });
    return;
  }
  if (!parsed || parsed.sections.length === 0) {
    // parseReport 仅对空入参返回 null；非空但切不出任何 ## 章节同样算「无法切分章节」
    issues.push({
      code: "PARSE_FAILED",
      severity: "warn",
      message: `${where} 的 Markdown 解析失败（无法切分出任何 ## 章节）`,
      meta: base,
    });
    return;
  }

  const missing = REQUIRED_SECTIONS.filter((s) => !parsed.sections.some((sec) => s.pattern.test(sec.title))).map((s) => s.name);
  if (missing.length > 0) {
    issues.push({
      code: "MISSING_SECTION",
      severity: "warn",
      message: `${where} 缺少 ${missing.length} 个必需章节：${missing.join("、")}`,
      meta: { ...base, missing: missing.join(","), missingCount: missing.length },
    });
  }

  // 「核心判断」章节存在但内容空白：结论核心有壳无实，比章节命名漂移更严重，记 error
  const core = parsed.sections.find((sec) => /核心判断/.test(sec.title));
  if (core && !core.raw.trim()) {
    issues.push({
      code: "MISSING_SECTION",
      severity: "error",
      message: `${where} 的「核心判断」章节内容为空白`,
      meta: { ...base, section: "核心判断", reason: "blank_core_judgment" },
    });
  }
}

/**
 * validation JSONB 标志异常：
 * - has_content / has_core_judgment / has_headlines 任一显式为 false → error
 *   （标志 key 缺失不触发，容忍历史/稀疏数据不齐）
 * - markdown_length 与实际正文长度偏差 >20% → warn（偏差率 = |declared-actual| / max(declared,1)）
 */
function checkValidationFlags(
  r: ReportRow,
  issues: QualityIssue[],
  where: string,
  mdLength: number | null
): void {
  const v = r.validation;
  if (!v || typeof v !== "object") return;
  const base = { id: r.id, date: normalizeDate(r.report_date) ?? null };

  for (const flag of VALIDATION_FLAGS) {
    if (v[flag] === false) {
      issues.push({
        code: "VALIDATION_FLAG",
        severity: "error",
        message: `${where} 的 validation.${flag} 为 false（n8n 校验门要求全为 true）`,
        meta: { ...base, flag },
      });
    }
  }

  const declared = v.markdown_length;
  if (typeof declared === "number" && Number.isFinite(declared) && mdLength != null) {
    const drift = Math.abs(declared - mdLength) / Math.max(declared, 1);
    if (drift > LENGTH_DRIFT_LIMIT) {
      issues.push({
        code: "VALIDATION_FLAG",
        severity: "warn",
        message: `${where} 的 validation.markdown_length=${declared} 与实际长度 ${mdLength} 相差 ${(drift * 100).toFixed(1)}%`,
        meta: { ...base, flag: "markdown_length", declared, actual: mdLength, driftPercent: Math.round(drift * 1000) / 10 },
      });
    }
  }
}

/** 不同日期标题归一化（小写、去空白/标点）后完全相同 → 疑似重复内容 */
function checkDuplicateTitles(byDate: Map<string, ReportRow[]>, issues: QualityIssue[]): void {
  const seen = new Map<string, string>();
  for (const [d, rows] of sortedEntries(byDate)) {
    const norm = normalizeTitle(rows[0].title ?? "");
    if (!norm) continue; // 空标题已由 INVALID_FIELDS 报告，不参与雷同判定
    const first = seen.get(norm);
    if (first !== undefined) {
      issues.push({
        code: "DUPLICATE_TITLE",
        severity: "warn",
        message: `日期 ${first} 与 ${d} 的标题归一化后完全相同，疑似重复内容`,
        meta: { date1: first, date2: d },
      });
    } else {
      seen.set(norm, d);
    }
  }
}

/** 覆盖性缺失：窗口 (today-staleDays, today] 内无任何合法报告 */
function checkStale(ctx: QualityCheckContext, byDate: Map<string, ReportRow[]>, issues: QualityIssue[]): void {
  const n = ctx.staleDays;
  if (!n || n <= 0) return;
  const from = addDays(ctx.today, -n); // 开区间下界，窗口共 n 天（含今天）
  for (const d of byDate.keys()) {
    if (d > from && d <= ctx.today) return;
  }
  issues.push({
    code: "STALE_DATA",
    severity: "error",
    message: `截至 ${ctx.today}，最近 ${n} 天（${addDays(ctx.today, -n + 1)} 至 ${ctx.today}）无任何新报告`,
    meta: { date: ctx.today, days: n },
  });
}
