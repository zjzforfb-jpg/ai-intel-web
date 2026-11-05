// 检查执行器 —— Owner: Agent B
// 组装上下文 → rules → 记录 → 通知；任何单步失败内部转 error 级 CheckRun，绝不向调用方抛出
import type { CheckRun, NotifyFn, QualityIssue } from "./types";
import { runQualityChecks } from "./rules";
import { saveCheckRun, listCheckRuns, markRunNotified, saveNotificationLog, isNotified } from "./store";
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
const DEFAULT_CHECK_TIMEOUT_MS = 60000;

class CheckTimeoutError extends Error {}

/** 检查阶段超时上限：MONITOR_CHECK_TIMEOUT_MS（毫秒），非法/缺省取 60s */
function checkTimeoutMs(): number {
  const raw = Number(process.env.MONITOR_CHECK_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHECK_TIMEOUT_MS;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CheckTimeoutError(`检查执行超时（>${ms}ms）`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 取数 + 规则 + 覆盖性检查；异常向上抛，由 runChecks 统一转 error 级结果 */
async function buildRun(targetDate: string, today: string): Promise<CheckRun> {
  const pool = getReadPool();
  // 列显式转 text/别名，喂给 rules 的行形状与 ReportRow 契约一致（pg 默认把 DATE 解析成 Date 对象）
  const { rows } = await pool.query(
    `SELECT id, report_date::text AS report_date, title, report_markdown, report_html,
            generated_at::text AS generated_at, total_articles, headline_count, status,
            validation, created_at::text AS created_at
     FROM daily_reports WHERE report_date = $1::date`,
    [targetDate]
  );
  const issues = runQualityChecks({
    reports: rows,
    expectedDates: [targetDate],
    today,
    minContentLength: DEFAULT_MIN_CONTENT,
  });
  // 覆盖性检查：截至 targetDate 最近 3 天是否整体断更。
  // STALE_DATA 归属去重：若 rules.ts 已产出该码（规则迁移后），此处按 issue 码去重不重复报
  const stale = await pool.query(
    `SELECT count(*)::int AS n FROM daily_reports WHERE report_date > ($1::date - 3) AND report_date < $1::date`,
    [targetDate]
  );
  if (
    stale.rows[0].n === 0 &&
    rows.length === 0 &&
    !issues.some((i) => i.code === "STALE_DATA")
  ) {
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
  return {
    checkType: "daily_quality",
    targetDate,
    status,
    summary: summarize(targetDate, issues),
    issues,
  };
}

export async function runChecks(options: RunChecksOptions = {}): Promise<RunChecksResult> {
  const started = Date.now();
  const today = todayShanghai();
  const targetDate = options.targetDate ?? today;

  // 超时保护：MONITOR_CHECK_TIMEOUT_MS 内未完成 → 转 error 级结果（不抛出）
  let run: CheckRun;
  try {
    run = await withTimeout(buildRun(targetDate, today), checkTimeoutMs());
  } catch (e) {
    const timedOut = e instanceof CheckTimeoutError;
    const issue: QualityIssue = {
      // types.ts 暂无 CHECK_TIMEOUT 专用码（需主 Agent 追加），暂复用 INVALID_FIELDS 表达「执行失败」
      code: "INVALID_FIELDS",
      severity: "error",
      message: timedOut
        ? e instanceof Error
          ? e.message
          : "检查执行超时"
        : `检查执行失败：${e instanceof Error ? e.message.slice(0, 120) : "未知错误"}`,
    };
    run = {
      checkType: "daily_quality",
      targetDate,
      status: "error",
      summary: `${timedOut ? "检查执行超时" : "检查执行失败"}（${targetDate}）`,
      issues: [issue],
    };
  }

  // 幂等设计：monitor_runs 忠实记录每一次执行（重复/失败也记），不做去重合并；
  // 幂等只针对「通知」——makeDedupKey 稳定键 + isNotified 查重 + saveNotificationLog upsert
  // （sent 不被降级、failed 可被 sent 补记）共同保证同一结论不重复打扰（见下方通知段）。
  // 写库失败不抛出，保留内存结果继续走通知。
  const saved = await saveCheckRun(run).catch(() => null);

  // 恢复状态记录：本轮 ok 且同目标上一次为 warn/error（真实跃迁）→ notifications 留恢复事件（幂等）
  if (saved && run.status === "ok" && run.targetDate) {
    try {
      const prev = await listCheckRuns({
        checkType: run.checkType,
        fromDate: run.targetDate,
        toDate: run.targetDate,
        limit: 2,
      });
      const previous = prev.items.find((r) => r.id !== saved.id);
      if (previous && previous.status !== "ok") {
        await markRunNotified(saved.id, "sent", {
          channel: "recovery",
          reason: `恢复：上次检查 ${previous.status}，本轮转为 ok`,
        });
      }
    } catch {
      // 恢复记录失败不影响主流程
    }
  }

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
      // 通知异常不影响主检查结论，转 failed 记录
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
