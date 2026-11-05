// 异常通知 —— Owner: Agent D
// 通用 Webhook（POST JSON，`text` 字段优先，兼容企业微信/飞书/Slack incoming webhook 常见形态）
// 超时（AbortController）+ 有限重试（默认 2 次）+ 指数退避（1s/2s）；
// 任何失败以 NotifyResult 返回，绝不抛出，绝不影响主检查流程。
//
// 幂等与恢复（安全设计）：
// - 幂等保护：同 dedup_key 只通知一次（monitor_notifications.dedup_key UNIQUE + isNotified 判定）；
//   重跑检查是安全的：monitor_runs 追加记录、通知按去重键跳过。
// - 不自动重跑 n8n 流程（即使其 UPSERT 幂等也不自动触发）；
//   恢复动作 = 手动重跑检查（npm run monitor:check）+ 通知去重。
//
// 安全：错误信息脱敏（不带 URL 里的 token query、不带堆栈全文），不打印/不提交任何密钥。
import type { CheckRun, NotifyFn, NotifyResult } from "./types";
import { createHash } from "node:crypto";

const DEFAULT_WEBHOOK_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_RETRY_TIMEOUT_MS = 10000;

/** 可注入的 sleep，便于测试断言退避间隔（默认真实 setTimeout） */
export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  /** 额外重试次数（默认 2，即最多 3 次尝试） */
  retries?: number;
  /** 退避基数（默认 1000ms，按 2^i 递增：1s/2s/4s…） */
  baseDelayMs?: number;
  /** 单次尝试超时（默认 10000ms，超时视为该次失败进入重试） */
  timeoutMs?: number;
  sleep?: SleepFn;
}

/** 单次尝试超时包装（计时器在结束时清理，不残留句柄） */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`操作超时 ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** 有限重试 + 指数退避包装；sleep 可注入便于测试 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const retries = Math.max(0, opts?.retries ?? DEFAULT_RETRIES);
  const baseDelayMs = Math.max(0, opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const timeoutMs = Math.max(1, opts?.timeoutMs ?? DEFAULT_RETRY_TIMEOUT_MS);
  const sleep = opts?.sleep ?? defaultSleep;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(baseDelayMs * 2 ** i); // 指数退避：1s/2s/4s…
    }
  }
  throw lastErr;
}

/** 由 CheckRun 生成稳定去重键：同结论（checkType/日期/状态/异常码集合）同键，与 issues 顺序无关 */
export function makeDedupKey(run: CheckRun): string {
  const codes = [...new Set(run.issues.map((i) => i.code))].sort().join(",");
  const h = createHash("sha256")
    .update(`${run.checkType}|${run.targetDate ?? "global"}|${run.status}|${codes}`)
    .digest("hex")
    .slice(0, 16);
  return `${run.checkType}:${run.targetDate ?? "global"}:${h}`;
}

/**
 * 脱敏错误摘要：URL query（可能含 token）打码、显式 token/key 赋值串打码、
 * 可选整体替换密钥串、不带堆栈、限长 120。
 */
export function sanitizeErrorMessage(e: unknown, secret?: string): string {
  let msg =
    e instanceof Error ? e.message : typeof e === "string" ? e : "未知错误";
  // URL 的 query 可能携带 token/key，一律打码（保留 host/path 便于排障）
  msg = msg.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s?#]+)\?[^\s#]*/g,
    "$1?***"
  );
  // 显式 key/token/secret/password/authorization 赋值串打码
  msg = msg.replace(
    /\b(token|key|secret|password|authorization)\s*[=:]\s*[^\s&;,]+/gi,
    "$1=***"
  );
  if (secret) msg = msg.split(secret).join("***");
  return msg.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** 通知文本 + 结构化精简 payload（不含报告正文、不含 meta 细节） */
function buildPayload(run: CheckRun) {
  const statusLabel =
    run.status === "error" ? "异常" : run.status === "warn" ? "警告" : "通过";
  const lines = [
    `[AI情报监控] ${statusLabel}${run.targetDate ? ` ${run.targetDate}` : "（全局）"}`,
    run.summary.slice(0, 200),
  ];
  for (const i of run.issues.slice(0, 5)) {
    lines.push(`· [${i.severity}] ${i.code}：${i.message.slice(0, 80)}`);
  }
  if (run.issues.length > 5) lines.push(`· …另 ${run.issues.length - 5} 项`);
  return {
    // text 优先：企业微信/飞书/Slack incoming webhook 的常见文本字段
    text: lines.join("\n"),
    // 结构化 payload（精简：仅结论要素，不带正文/密钥）
    status: run.status,
    targetDate: run.targetDate,
    summary: run.summary.slice(0, 200),
    issues: run.issues.slice(0, 10).map((i) => ({
      code: i.code,
      severity: i.severity,
      message: i.message.slice(0, 200),
    })),
  };
}

/** POST JSON 单次尝试：AbortController 超时中止；非 2xx 抛错（不读响应正文） */
async function postJson(
  url: string,
  payload: unknown,
  timeoutMs: number
): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
  } catch (e) {
    if (ac.signal.aborted) throw new Error(`webhook 请求超时 ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export interface WebhookNotifyOptions {
  /** 默认取 process.env.MONITOR_WEBHOOK_URL */
  url?: string;
  /** 单次请求超时（默认 8000ms） */
  timeoutMs?: number;
  /** 额外重试次数（默认 2） */
  retries?: number;
  /** 退避基数（默认 1000ms） */
  baseDelayMs?: number;
  sleep?: SleepFn;
}

/** 生成带配置的 Webhook 通知函数（测试可注入 url/超时/重试/sleep） */
export function createNotifyWebhook(opts: WebhookNotifyOptions = {}): NotifyFn {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  return async (run: CheckRun): Promise<NotifyResult> => {
    const url = (opts.url ?? process.env.MONITOR_WEBHOOK_URL ?? "").trim();
    if (!url) return { status: "skipped", reason: "MONITOR_WEBHOOK_URL 未配置" };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { status: "failed", reason: "MONITOR_WEBHOOK_URL 非法（无法解析）" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        status: "failed",
        reason: "MONITOR_WEBHOOK_URL 非法（仅支持 http/https）",
      };
    }

    const payload = buildPayload(run);
    try {
      await withRetry(() => postJson(url, payload, timeoutMs), {
        retries: opts.retries ?? DEFAULT_RETRIES,
        baseDelayMs: opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
        timeoutMs: timeoutMs + 500, // 兜底略大于请求超时，让 AbortController 先触发
        sleep: opts.sleep,
      });
      return { status: "sent" };
    } catch (e) {
      // 永不抛出：失败仅记录脱敏原因
      return { status: "failed", reason: sanitizeErrorMessage(e, url) };
    }
  };
}

/** 默认 Webhook 通知；未配置 MONITOR_WEBHOOK_URL 时 skipped */
export const notifyWebhook: NotifyFn = createNotifyWebhook();
