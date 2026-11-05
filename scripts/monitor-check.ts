// 每日日报质量检查 CLI（cron 入口）—— Owner: Agent D
// 用法：
//   npm run monitor:check [-- --date=YYYY-MM-DD] [--skip-notify] [--dry-run]
//   --date=YYYY-MM-DD  被检查的报告日期（默认今天，Asia/Shanghai 口径，与 runner 一致）
//   --skip-notify      只检查不发通知
//   --dry-run          只打印将检查什么，不写库、不发通知
//
// 退出码（便于 cron 报警）：
//   0 = ok 或 warn（warn 级发现会走 Webhook 通知渠道上报，不打扰 cron）
//   2 = error 级检查结论（有严重异常，含 runner 把 DB 故障转成的 error 结论）
//   3 = 执行失败（参数非法 / 整体超时 MONITOR_CHECK_TIMEOUT_MS / 未捕获异常）
//
// 幂等与恢复（安全设计）：
// - 重跑检查是安全的：monitor_runs 追加记录、monitor_notifications 按 dedup_key 去重，
//   同一异常结论只通知一次（见 lib/monitor/notify.ts 的 makeDedupKey）。
// - 不自动重跑 n8n 流程（即使其 UPSERT 幂等也不自动触发）；
//   恢复动作 = 手动重跑本检查 + 通知去重。
//
// 安全：日志不打印密钥/报告正文；错误经脱敏（无 URL token、无堆栈全文）。
import { runChecks } from "@/lib/monitor/runner";
import { sanitizeErrorMessage } from "@/lib/monitor/notify";

interface CliArgs {
  date?: string;
  skipNotify: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { skipNotify: false, dryRun: false };
  for (const a of argv) {
    if (a === "--skip-notify") args.skipNotify = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--date=")) args.date = a.slice("--date=".length);
    else throw new Error(`未知参数：${a}`);
  }
  if (args.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || Number.isNaN(Date.parse(args.date))) {
      throw new Error(`--date 格式非法（应为 YYYY-MM-DD）：${args.date}`);
    }
  }
  return args;
}

/** Asia/Shanghai 的今天 YYYY-MM-DD（与 runner 的口径一致） */
function todayShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
    new Date()
  );
}

/** 整体超时：MONITOR_CHECK_TIMEOUT_MS（默认 120s） */
function overallTimeoutMs(): number {
  const raw = Number(process.env.MONITOR_CHECK_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`整体超时 ${ms}ms（MONITOR_CHECK_TIMEOUT_MS）`)),
      ms
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function log(line: string): void {
  console.log(`[monitor-check] ${new Date().toISOString()} ${line}`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const timeoutMs = overallTimeoutMs();
  const targetDate = args.date ?? todayShanghai();
  const webhookConfigured = Boolean(process.env.MONITOR_WEBHOOK_URL?.trim());

  if (args.dryRun) {
    log(
      `dry-run 将检查：checkType=daily_quality date=${targetDate} ` +
        `通知=${args.skipNotify ? "跳过(--skip-notify)" : webhookConfigured ? "启用(webhook 已配置)" : "启用(webhook 未配置→将 skipped)"} ` +
        `整体超时=${timeoutMs}ms（不写库、不发通知）`
    );
    return 0;
  }

  const result = await withTimeout(
    runChecks({ targetDate, skipNotify: args.skipNotify }),
    timeoutMs
  );

  const errors = result.run.issues.filter((i) => i.severity === "error").length;
  const warns = result.run.issues.length - errors;
  const notifyLabel = result.notified
    ? result.notified.status +
      (result.notified.reason ? `(${result.notified.reason})` : "")
    : args.skipNotify
      ? "skipped(--skip-notify)"
      : "none(结论 ok)";
  log(
    `date=${targetDate} status=${result.run.status} 异常=${errors} 警告=${warns} ` +
      `通知=${notifyLabel} 耗时=${result.durationMs}ms`
  );
  return result.run.status === "error" ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`[monitor-check] 执行失败：${sanitizeErrorMessage(e)}`);
    process.exit(3);
  });
