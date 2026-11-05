// 数据质量检查规则 —— Owner: Agent A（主 Agent 提供 v0 最小实现，Agent A 补全规则）
// 输入为已取回的数据行，纯函数、不访问数据库、不发通知
import type { QualityIssue } from "./types";
import type { ReportRow } from "@/lib/db";
import { parseReport } from "@/lib/markdown-parser";

/** 检查上下文：一次检查所需输入（由 runner 组装） */
export interface QualityCheckContext {
  reports: ReportRow[];
  expectedDates: string[];
  today: string;
  minContentLength: number;
}

/** v0 规则：缺失 / 空内容 / 异常短 / 必需字段 / 未来日期 / 结构缺章节 */
export function runQualityChecks(ctx: QualityCheckContext): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const byDate = new Map<string, ReportRow>();
  for (const r of ctx.reports) {
    const d = r.report_date.slice(0, 10);
    if (byDate.has(d)) {
      issues.push({
        code: "DUPLICATE_REPORT",
        severity: "error",
        message: `日期 ${d} 存在多条报告记录`,
        meta: { date: d },
      });
    }
    byDate.set(d, r);
  }

  for (const d of ctx.expectedDates) {
    if (!byDate.has(d)) {
      issues.push({
        code: "MISSING_REPORT",
        severity: "error",
        message: `预期日期 ${d} 缺少日报`,
        meta: { date: d },
      });
    }
  }

  for (const [d, r] of byDate) {
    if (d > ctx.today) {
      issues.push({ code: "FUTURE_DATE", severity: "error", message: `报告日期 ${d} 在未来`, meta: { date: d } });
    }
    if (!r.title || !r.title.trim()) {
      issues.push({ code: "INVALID_FIELDS", severity: "error", message: `报告 ${d} 标题为空`, meta: { date: d, field: "title" } });
    }
    const md = r.report_markdown ?? "";
    if (!md.trim()) {
      issues.push({ code: "EMPTY_CONTENT", severity: "error", message: `报告 ${d} 正文为空`, meta: { date: d } });
      continue;
    }
    if (md.trim().length < ctx.minContentLength) {
      issues.push({
        code: "SHORT_CONTENT",
        severity: "warn",
        message: `报告 ${d} 正文仅 ${md.trim().length} 字符（阈值 ${ctx.minContentLength}）`,
        meta: { date: d, length: md.trim().length },
      });
    }
    try {
      const parsed = parseReport(md);
      if (!parsed) {
        issues.push({ code: "PARSE_FAILED", severity: "warn", message: `报告 ${d} Markdown 解析失败`, meta: { date: d } });
        continue;
      }
      const missing = (["核心判断", "今日 AI 头条", "今日趋势", "商业机会"] as const).filter(
        (s) => !parsed.sections.some((sec) => sec.title.includes(s))
      );
      if (missing.length) {
        issues.push({
          code: "MISSING_SECTION",
          severity: "warn",
          message: `报告 ${d} 缺少章节：${missing.join("、")}`,
          meta: { date: d, missing: missing.join(",") },
        });
      }
    } catch {
      issues.push({ code: "PARSE_FAILED", severity: "warn", message: `报告 ${d} Markdown 解析异常`, meta: { date: d } });
    }
  }

  return issues;
}
