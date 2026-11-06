// 检查执行器 —— Owner: Agent B
// 组装上下文 → rules → 记录 → 通知；任何单步失败内部转 error 级 CheckRun，绝不向调用方抛出
import type { CheckRun, NotifyFn, QualityIssue } from "./types";
import { runQualityChecks, checkStaleData } from "./rules";
import { saveCheckRun, listCheckRuns, markRunNotified, saveNotificationLog, isNotified, countRecoveryNotifications } from "./store";
import { notifyWebhook, makeDedupKey } from "./notify";
import { getReadPool } from "@/lib/db";
import { listReportFailures } from "./db";

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
/** STALE_DATA 覆盖性窗口（天），窗口为 (targetDate-staleDays, targetDate]，含 targetDate 当天 */
const DEFAULT_STALE_DAYS = 3;

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
  // 覆盖性检查：STALE_DATA 唯一实现在 rules.checkStaleData（纯函数），窗口 (target-staleDays, target]
  // 含 target 当天。此处取窗口内实际存在报告的日期喂给规则，不再维护独立的 SQL 判定。
  const window = await pool.query(
    `SELECT DISTINCT report_date::text AS d FROM daily_reports
     WHERE report_date > ($1::date - $2::int) AND report_date <= $1::date`,
    [targetDate, DEFAULT_STALE_DAYS]
  );
  const stale = checkStaleData(
    targetDate,
    window.rows.map((r) => r.d as string),
    DEFAULT_STALE_DAYS
  );
  if (stale) issues.push(stale);

  // n8n 失败兜底表：目标日期存在 report_failures 记录 → FAILURE_RECORD（与 MISSING_REPORT 可叠加，
  // 互不抑制）。表尚未创建/未授权时 listReportFailures 返回 null，优雅跳过不影响其余规则。
  const failures = await listReportFailures(targetDate);
  if (failures && failures.length > 0) {
    const stages = [...new Set(failures.map((f) => f.stage))].join("、");
    const firstReason = failures[0].reason.replace(/\s+/g, " ").trim().slice(0, 60);
    issues.push({
      code: "FAILURE_RECORD",
      severity: "warn",
      message: `${targetDate} 有 ${failures.length} 条采集失败记录（阶段：${stages}），首条原因：${firstReason}`.slice(0, 200),
      meta: { date: targetDate, count: failures.length },
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
    // 超时用独立 CHECK_TIMEOUT 码：不与真字段异常（INVALID_FIELDS）共用 dedup_key 空间，
    // 避免超时通知被同结论去重跳过
    const issue: QualityIssue = timedOut
      ? {
          code: "CHECK_TIMEOUT",
          severity: "error",
          message: e instanceof Error ? e.message : "检查执行超时",
        }
      : {
          code: "INVALID_FIELDS",
          severity: "error",
          message: `检查执行失败：${e instanceof Error ? e.message.slice(0, 120) : "未知错误"}`,
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

  // 恢复通知：本轮 ok 且同目标上一次为 warn/error（真实跃迁）→ 真正发送恢复消息
  // （复用异常通知的 webhook 发送路径，含重试/退避/超时），按发送结果落
  // monitor_notifications（status=sent/failed/skipped），不再只记「已发送」而不发。
  // dedup 键含恢复序号：recovery:<checkType>:<targetDate>#<N>（N = 该 checkType+date 的
  // 第 N 次恢复，按 store 历史恢复记录推算），保证同日多次「异常→恢复」跃迁每次都能通知。
  // --skip-notify 时不发送也不记录（恢复本身是一次通知事件）。
  if (saved && run.status === "ok" && run.targetDate && !options.skipNotify) {
    try {
      const prev = await listCheckRuns({
        checkType: run.checkType,
        fromDate: run.targetDate,
        toDate: run.targetDate,
        limit: 2,
      });
      const previous = prev.items.find((r) => r.id !== saved.id);
      if (previous && previous.status !== "ok") {
        const seq = (await countRecoveryNotifications(run.checkType, run.targetDate)) + 1;
        const dedupKey = `recovery:${run.checkType}:${run.targetDate}#${seq}`;
        // 恢复消息：之前的问题摘要 + 「已恢复」+ 检查类型与日期（经 buildPayload 走 text 字段）
        const recoveryRun: CheckRun = {
          checkType: run.checkType,
          targetDate: run.targetDate,
          status: "ok",
          summary: `已恢复：${run.checkType} ${run.targetDate} 本轮检查通过（上次 ${previous.status}：${previous.summary.slice(0, 100)}）`,
          issues: [],
        };
        const fn = options.notify ?? notifyWebhook;
        const result = await fn(recoveryRun);
        await markRunNotified(saved.id, result.status, {
          dedupKey,
          channel: "recovery",
          reason: result.reason ?? `恢复：上次检查 ${previous.status}，本轮转为 ok（第 ${seq} 次恢复）`,
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
