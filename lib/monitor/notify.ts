// 异常通知 —— Owner: Agent D（主 Agent 提供 v0 最小实现，Agent D 补全）
// 通用 Webhook（POST JSON），超时 + 有限重试 + 退避；任何失败不抛出主流程
import type { CheckRun, NotifyFn, NotifyResult } from "./types";
import { createHash } from "node:crypto";

/** 有限重试 + 指数退避包装 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseDelayMs?: number; timeoutMs?: number }
): Promise<T> {
  const retries = opts?.retries ?? 2;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const timeoutMs = opts?.timeoutMs ?? 10000;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}

/** 由 CheckRun 生成稳定去重键 */
export function makeDedupKey(run: CheckRun): string {
  const codes = [...new Set(run.issues.map((i) => i.code))].sort().join(",");
  const h = createHash("sha256")
    .update(`${run.checkType}|${run.targetDate ?? "global"}|${run.status}|${codes}`)
    .digest("hex")
    .slice(0, 16);
  return `${run.checkType}:${run.targetDate ?? "global"}:${h}`;
}

/** 默认 Webhook 通知；未配置 MONITOR_WEBHOOK_URL 时 skipped */
export const notifyWebhook: NotifyFn = async (run: CheckRun): Promise<NotifyResult> => {
  const url = process.env.MONITOR_WEBHOOK_URL?.trim();
  if (!url) return { status: "skipped", reason: "MONITOR_WEBHOOK_URL 未配置" };

  const payload = {
    text: `[AI情报监控] ${run.status.toUpperCase()} ${run.targetDate ?? ""}\n${run.summary}`,
    status: run.status,
    targetDate: run.targetDate,
    issues: run.issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message })),
  };

  try {
    await withRetry(
      async () => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
      },
      { retries: 2, baseDelayMs: 1000, timeoutMs: 8000 }
    );
    return { status: "sent" };
  } catch (e) {
    return { status: "failed", reason: e instanceof Error ? e.message.slice(0, 120) : "未知错误" };
  }
};
