// 商业机会管理 —— 客户端/服务端共享的常量、类型与校验
// 本文件禁止 import 任何带 pg / 服务端依赖的模块（会被打进客户端包）；
// 类型从 lib/db-write.ts 仅做 type-only 引入，编译期即被擦除。
import type { OpportunityRow, OpportunityStatus } from "./db-write";

export type { OpportunityRow, OpportunityStatus };

/** 四种合法状态（与数据库 CHECK 约束一致，顺序即推荐流转顺序） */
export const OPPORTUNITY_STATUSES: readonly OpportunityStatus[] = [
  "待研究",
  "验证中",
  "已实施",
  "已放弃",
];

export function isOpportunityStatus(v: unknown): v is OpportunityStatus {
  return typeof v === "string" && (OPPORTUNITY_STATUSES as readonly string[]).includes(v);
}

// 状态配色：走主题令牌（--color-status-*），暗黑 / 暖风各一套值。
// 语义与选题状态同构：待研究=蓝 / 验证中=橙 / 已实施=绿 / 已放弃=灰。
export const STATUS_COLOR_VAR_NAME: Record<OpportunityStatus, string> = {
  待研究: "--color-status-todo",
  验证中: "--color-status-picked",
  已实施: "--color-status-made",
  已放弃: "--color-status-dropped",
};

/** 列表分页大小 */
export const OPPORTUNITY_PAGE_SIZE = 12;

/* ==================== 校验 ==================== */

export type OpportunityField =
  | "title"
  | "description"
  | "category"
  | "source_report_date"
  | "status"
  | "notes"
  | "action_plan";

export type OpportunityFieldErrors = Partial<Record<OpportunityField, string>> & {
  form?: string;
};

/** 归一化后的写入值（空字符串一律转 null，便于直接入库） */
export interface OpportunityWriteValues {
  title: string;
  description: string | null;
  category: string | null;
  source_report_date: string | null;
  status: OpportunityStatus;
  notes: string | null;
  action_plan: string | null;
}

export type OpportunityValidation =
  | {
      ok: true;
      /** 完整值（create 直接使用） */
      value: OpportunityWriteValues;
      /** 本次实际提供的字段（update 只写这些列） */
      patch: Partial<OpportunityWriteValues>;
    }
  | { ok: false; errors: OpportunityFieldErrors };

const MAX_TITLE = 200;
const MAX_CATEGORY = 100;
const MAX_TEXT = 20000;

const KNOWN_FIELDS: readonly OpportunityField[] = [
  "title",
  "description",
  "category",
  "source_report_date",
  "status",
  "notes",
  "action_plan",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 严格 YYYY-MM-DD 且为真实日历日期 */
function isValidDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === v;
}

/**
 * 校验并归一化机会写入载荷（POST / PATCH 共用）
 * - create：title 必填，status 缺省为「待研究」
 * - update：至少提供一个已知字段
 * - 未知字段直接忽略；文本长度与日期格式均在此统一把关
 */
export function validateOpportunity(
  body: unknown,
  mode: "create" | "update"
): OpportunityValidation {
  const errors: OpportunityFieldErrors = {};

  if (!isRecord(body)) {
    return { ok: false, errors: { form: "请求体必须是 JSON 对象" } };
  }

  const provided = KNOWN_FIELDS.filter((f) => body[f] !== undefined);
  if (mode === "update" && provided.length === 0) {
    return { ok: false, errors: { form: "没有需要更新的字段" } };
  }
  if (mode === "create" && body.title === undefined) {
    errors.title = "标题必填";
  }

  const value: OpportunityWriteValues = {
    title: "",
    description: null,
    category: null,
    source_report_date: null,
    status: "待研究",
    notes: null,
    action_plan: null,
  };
  const patch: Partial<OpportunityWriteValues> = {};

  for (const field of provided) {
    const raw = body[field];

    switch (field) {
      case "title": {
        if (typeof raw !== "string" || !raw.trim()) {
          errors.title = "标题必填";
        } else if (raw.trim().length > MAX_TITLE) {
          errors.title = `标题不能超过 ${MAX_TITLE} 字`;
        } else {
          value.title = raw.trim();
          patch.title = value.title;
        }
        break;
      }
      case "status": {
        if (!isOpportunityStatus(raw)) {
          errors.status = "状态必须是 待研究 / 验证中 / 已实施 / 已放弃 之一";
        } else {
          value.status = raw;
          patch.status = raw;
        }
        break;
      }
      case "category": {
        if (typeof raw !== "string") {
          errors.category = "分类必须是文本";
        } else if (raw.trim().length > MAX_CATEGORY) {
          errors.category = `分类不能超过 ${MAX_CATEGORY} 字`;
        } else {
          value.category = raw.trim() || null;
          patch.category = value.category;
        }
        break;
      }
      case "source_report_date": {
        if (typeof raw !== "string" || !raw.trim()) {
          value.source_report_date = null;
          patch.source_report_date = null;
        } else if (!isValidDate(raw.trim())) {
          errors.source_report_date = "日期格式须为 YYYY-MM-DD";
        } else {
          value.source_report_date = raw.trim();
          patch.source_report_date = value.source_report_date;
        }
        break;
      }
      case "description":
      case "notes":
      case "action_plan": {
        if (typeof raw !== "string") {
          errors[field] = "必须是文本";
        } else if (raw.trim().length > MAX_TEXT) {
          errors[field] = `内容不能超过 ${MAX_TEXT} 字`;
        } else {
          value[field] = raw.trim() || null;
          patch[field] = value[field];
        }
        break;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value, patch };
}

/* ==================== URL 查询串 ==================== */

/** 构造 /opportunities 查询串（空值不入 URL；page 仅 >1 时出现） */
export function buildOpportunityQuery(state: {
  status?: string;
  category?: string;
  page?: number;
}): string {
  const sp = new URLSearchParams();
  if (state.status) sp.set("status", state.status);
  if (state.category) sp.set("category", state.category);
  if (state.page && state.page > 1) sp.set("page", String(state.page));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}
