// 检查执行器 —— Owner: Agent B（主 Agent 提供 v0 最小实现，Agent B 补全）
// 组装上下文 → rules → 记录 → 通知（通知失败不影响主流程）
import type { CheckRun, NotifyFn, QualityIssue } from "./types";
import { runQualityChecks } from "./rules";
import { saveCheckRun, saveNotificationLog, isNotified } from "./store";
import { notifyWebhook, makeDedupKey } from "./notify";
import { getReadPool } from "@/lib/db";

export interface RunChecksOptions {
  targetDate?: string;
  notify?: NotifyFn;
  skipNotify?: boolean;
}

export interface RunChecksResult {
  run: CheckRun;
  notified: { dedupKey: string; status: "sent" | "failed" | "skipped"; reason?: string } | null;
  durationMs: number;
}

/** Asia/Shanghai 的今天 YYYY-MM-DD */
function todayShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
}

const DEFAULT_MIN_CONTENT = 1000;

export async function runChecks(options: RunChecksOptions = {}): Promise<RunChecksResult> {
  const started = Date.now();
  const today = todayShanghai();
  const targetDate = options.targetDate ?? today;

  let run: CheckRun;
  try {
    const pool = getReadPool();
    const { rows } = await pool.query(
      `SELECT * FROM daily_reports WHERE report_date = $1::date`,
      [targetDate]
    );
    const issues = runQualityChecks({
      reports: rows,
      expectedDates: [targetDate],
      today,
      minContentLength: DEFAULT_MIN_CONTENT,
    });
    // 覆盖性检查：最近 3 天是否整体断更（仅当今天检查通过时附加）
    const stale = await pool.query(
      `SELECT count(*)::int AS n FROM daily_reports WHERE report_date > ($1::date - 3) AND report_date < $1::date`,
      [targetDate]
    );
    if (stale.rows[0].n === 0 && rows.length === 0) {
      issues.push({
        code: "STALE_DATA",
        severity: "error",
        message: `截至 ${targetDate} 最近 3 天无任何新报告`,
        meta: { date: targetDate },
      });
    }
    const status = issues.some((i) => i.severity === "error")
      ? "error"
      : issues.length
        ? "warn"
        : "ok";
    run = {
      checkType: "daily_quality",
      targetDate,
      status,
      summary: summarize(targetDate, issues),
      issues,
    };
  } catch (e) {
    // DB 不可用等异常：转为 error 级结果，不抛出
    const issue: QualityIssue = {
      code: "INVALID_FIELDS",
      severity: "error",
      message: `检查执行失败：${e instanceof Error ? e.message.slice(0, 120) : "未知错误"}`,
    };
    run = {
      checkType: "daily_quality",
      targetDate,
      status: "error",
      summary: `检查执行失败（${targetDate}）`,
      issues: [issue],
    };
  }

  const saved = await saveCheckRun(run).catch(() => null);

  let notified: RunChecksResult["notified"] = null;
  if (!options.skipNotify && run.status !== "ok") {
    const dedupKey = makeDedupKey(run);
    try {
      const already = await isNotified(dedupKey);
      if (already) {
        notified = { dedupKey, status: "skipped", reason: "同结论已通知过（去重）" };
      } else {
        const fn = options.notify ?? notifyWebhook;
        const result = await fn(run);
        notified = { dedupKey, ...result };
        if (saved) await saveNotificationLog(saved.id, dedupKey, result).catch(() => {});
      }
    } catch (e) {
      notified = {
        dedupKey,
        status: "failed",
        reason: e instanceof Error ? e.message.slice(0, 120) : "通知异常",
      };
    }
  }

  return { run, notified, durationMs: Date.now() - started };
}

function summarize(date: string, issues: QualityIssue[]): string {
  if (!issues.length) return `${date} 日报检查通过`;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.length - errors;
  return `${date} 日报检查发现 ${errors} 项异常、${warns} 项警告`;
}
