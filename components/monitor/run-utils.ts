// 监控界面展示辅助 —— Owner: Agent C
// store.ts 的 CheckRunRow 契约为 camelCase（checkType/targetDate），
// 但 `SELECT *` 实际返回 snake_case（check_type/target_date），
// 这里做防御性归一化，两种形态都能正确展示。
import type { CheckRunRow, CheckStatus, QualityIssue } from "@/lib/monitor/types";

export interface RunView {
  id: number;
  checkType: string;
  targetDate: string | null;
  status: CheckStatus;
  summary: string;
  issues: QualityIssue[];
  checkedAt: string;
  createdAt: string;
}

/** JSONB 可能已被 pg 解析为数组，也可能仍是 JSON 字符串，统一成数组 */
function parseIssues(v: QualityIssue[] | string | null | undefined): QualityIssue[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as QualityIssue[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** TIMESTAMPTZ 在运行时可能是 Date 对象（pg 默认解析），统一为 ISO 字符串 */
function toIso(v: string | Date | null | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  try {
    return (v as Date).toISOString();
  } catch {
    return String(v);
  }
}

/**
 * DATE 列统一为 YYYY-MM-DD。
 * pg 把 DATE 解析为「进程本地时区当天零点」的 Date 对象，
 * 直接序列化会变成前一日的 UTC ISO（如 2020-01-01 → 2019-12-31T16:00Z），
 * 因此必须用本地时间分量还原日历日期。
 */
function toDateStr(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string") {
    // 纯日期字符串直接返回；ISO 时间串按本地分量还原
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  }
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function toRunView(row: CheckRunRow): RunView {
  const r = row as CheckRunRow & {
    check_type?: string;
    target_date?: string | null;
  };
  return {
    id: r.id,
    checkType: (r.checkType ?? r.check_type ?? "") || "daily_quality",
    targetDate: toDateStr(r.targetDate ?? r.target_date),
    status: r.status,
    summary: r.summary ?? "",
    issues: parseIssues(r.issues),
    checkedAt: toIso(r.checked_at),
    createdAt: toIso(r.created_at),
  };
}

export function isCheckStatus(v: string): v is CheckStatus {
  return v === "ok" || v === "warn" || v === "error";
}

/** API 输出：按共享契约 CheckRunRow 形状序列化（字段与日期已归一化） */
export function toApiRow(row: CheckRunRow): CheckRunRow {
  const v = toRunView(row);
  return {
    id: v.id,
    checkType: v.checkType,
    targetDate: v.targetDate,
    status: v.status,
    summary: v.summary,
    issues: v.issues,
    checked_at: v.checkedAt,
    created_at: v.createdAt,
  };
}
