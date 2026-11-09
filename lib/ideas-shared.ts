// 选题提取 —— 客户端/服务端共享的常量、类型与校验
// 本文件禁止 import 任何带 pg / 服务端依赖的模块（会被打进客户端包）。
// 风格与 lib/opportunities-shared.ts 保持一致。

/** 四种合法状态（与数据库 CHECK 约束一致，顺序即推荐流转顺序） */
export const IDEA_STATUSES = ["待制作", "已选用", "已制作", "已放弃"] as const;

export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export function isIdeaStatus(v: unknown): v is IdeaStatus {
  return typeof v === "string" && (IDEA_STATUSES as readonly string[]).includes(v);
}

// 状态配色：走主题令牌（--color-status-*），暗黑 / 暖风两套主题各给一套值。
// 早前这里写死 tailwind 的 blue/orange/emerald/gray —— 暖风主题下会和米纸底打架。
export const IDEA_STATUS_COLOR_VAR: Record<IdeaStatus, string> = {
  待制作: "var(--color-status-todo)",
  已选用: "var(--color-status-picked)",
  已制作: "var(--color-status-made)",
  已放弃: "var(--color-status-dropped)",
};

/** 状态 → CSS 变量名（供 style={{ "--status-color": ... }} 使用） */
export const IDEA_STATUS_COLOR_VAR_NAME: Record<IdeaStatus, string> = {
  待制作: "--color-status-todo",
  已选用: "--color-status-picked",
  已制作: "--color-status-made",
  已放弃: "--color-status-dropped",
};

/** 选题行（与 topic_ideas 表结构对应，日期/时间在查询侧已转 text） */
export interface IdeaRow {
  id: number;
  report_date: string;
  title: string;
  angle: string | null;
  source_material: string | null;
  reference_visuals: string | null;
  value_score: number | null;
  status: IdeaStatus;
  created_at: string;
  updated_at: string;
}

/* ==================== 校验 ==================== */

export type IdeaField =
  | "report_date"
  | "title"
  | "angle"
  | "source_material"
  | "reference_visuals"
  | "value_score"
  | "status";

export type IdeaFieldErrors = Partial<Record<IdeaField, string>> & {
  form?: string;
};

/** 归一化后的写入值（空字符串一律转 null，便于直接入库） */
export interface IdeaWriteValues {
  report_date: string;
  title: string;
  angle: string | null;
  source_material: string | null;
  reference_visuals: string | null;
  value_score: number | null;
  status: IdeaStatus;
}

export type IdeaValidation =
  | {
      ok: true;
      /** 完整值（create 直接使用） */
      value: IdeaWriteValues;
      /** 本次实际提供的字段（update 只写这些列） */
      patch: Partial<IdeaWriteValues>;
    }
  | { ok: false; errors: IdeaFieldErrors };

const MAX_TITLE = 200;
const MAX_TEXT = 20000;
const MAX_SCORE = 10;
const MIN_SCORE = 1;

const KNOWN_FIELDS: readonly IdeaField[] = [
  "report_date",
  "title",
  "angle",
  "source_material",
  "reference_visuals",
  "value_score",
  "status",
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
 * 校验并归一化选题写入载荷（POST / PATCH 共用）
 * - create：report_date、title 必填，status 缺省为「待制作」
 * - update：至少提供一个已知字段
 * - 未知字段直接忽略；评分必须是 1-10 整数，长度与日期格式统一在此把关
 */
export function validateIdea(body: unknown, mode: "create" | "update"): IdeaValidation {
  const errors: IdeaFieldErrors = {};

  if (!isRecord(body)) {
    return { ok: false, errors: { form: "请求体必须是 JSON 对象" } };
  }

  const provided = KNOWN_FIELDS.filter((f) => body[f] !== undefined);
  if (mode === "update" && provided.length === 0) {
    return { ok: false, errors: { form: "没有需要更新的字段" } };
  }
  if (mode === "create" && body.report_date === undefined) {
    errors.report_date = "来源日报日期必填";
  }
  if (mode === "create" && body.title === undefined) {
    errors.title = "标题必填";
  }

  const value: IdeaWriteValues = {
    report_date: "",
    title: "",
    angle: null,
    source_material: null,
    reference_visuals: null,
    value_score: null,
    status: "待制作",
  };
  const patch: Partial<IdeaWriteValues> = {};

  for (const field of provided) {
    const raw = body[field];

    switch (field) {
      case "report_date": {
        if (typeof raw !== "string" || !raw.trim()) {
          errors.report_date = "来源日报日期必填";
        } else if (!isValidDate(raw.trim())) {
          errors.report_date = "日期格式须为 YYYY-MM-DD";
        } else {
          value.report_date = raw.trim();
          patch.report_date = value.report_date;
        }
        break;
      }
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
        if (!isIdeaStatus(raw)) {
          errors.status = "状态必须是 待制作 / 已选用 / 已制作 / 已放弃 之一";
        } else {
          value.status = raw;
          patch.status = raw;
        }
        break;
      }
      case "value_score": {
        if (raw === null) {
          value.value_score = null;
          patch.value_score = null;
        } else if (typeof raw !== "number" || !Number.isInteger(raw)) {
          errors.value_score = "评分必须是 1-10 的整数";
        } else if (raw < MIN_SCORE || raw > MAX_SCORE) {
          errors.value_score = `评分必须在 ${MIN_SCORE}-${MAX_SCORE} 之间`;
        } else {
          value.value_score = raw;
          patch.value_score = raw;
        }
        break;
      }
      case "angle":
      case "source_material":
      case "reference_visuals": {
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
