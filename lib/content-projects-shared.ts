// 内容生产 —— 客户端/服务端共享的常量、类型与校验
//
// 本文件禁止 import 任何带 pg / 服务端依赖的模块（会被打进客户端包）。
// 风格与 lib/ideas-shared.ts 保持一致。
//
// 接口依据：docs/phase3-stageB-interface.md §2.3 / §5

/* ==================== 枚举（与数据库 CHECK 约束逐字一致） ==================== */

export const CONTENT_TYPES = [
  "ai_news",
  "ai_product",
  "ai_tutorial",
  "tech_trend",
  "biz_opportunity",
  "story_case",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export function isContentType(v: unknown): v is ContentType {
  return typeof v === "string" && (CONTENT_TYPES as readonly string[]).includes(v);
}

/** 中文展示名（导出 JSON 仍用英文枚举值，不改数据） */
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  ai_news: "AI 快讯",
  ai_product: "产品测评",
  ai_tutorial: "教程方法",
  tech_trend: "技术趋势",
  biz_opportunity: "商业机会",
  story_case: "案例复盘",
};

export const PROJECT_STATUSES = [
  "草稿",
  "策划中",
  "待生产",
  "已导出",
  "已回传",
  "已完成",
  "已放弃",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export function isProjectStatus(v: unknown): v is ProjectStatus {
  return typeof v === "string" && (PROJECT_STATUSES as readonly string[]).includes(v);
}

/** 与用户生产系统的对接状态，顺序即时间线顺序 */
export const PRODUCTION_STATUSES = [
  "未导出",
  "已导出待生产",
  "已导入脚本",
  "已出分镜",
  "已完成",
] as const;

export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export function isProductionStatus(v: unknown): v is ProductionStatus {
  return typeof v === "string" && (PRODUCTION_STATUSES as readonly string[]).includes(v);
}

/* ==================== 徽章配色（沿用既有深色科技风） ==================== */

export const PROJECT_STATUS_BADGE_CLASS: Record<ProjectStatus, string> = {
  草稿: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  策划中: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  待生产: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  已导出: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  已回传: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  已完成: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  已放弃: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

export const PRODUCTION_STATUS_BADGE_CLASS: Record<ProductionStatus, string> = {
  未导出: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  已导出待生产: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  已导入脚本: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  已出分镜: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  已完成: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

export const CONTENT_TYPE_BADGE_CLASS: Record<ContentType, string> = {
  ai_news: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  ai_product: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  ai_tutorial: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  tech_trend: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  biz_opportunity: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  story_case: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
};

/* ==================== 行类型 ==================== */

/** 参考素材条目（reference_materials JSONB 的元素形状） */
export interface ReferenceMaterial {
  title: string | null;
  url: string | null;
  note: string | null;
}

/** 内容项目完整行（只读查询已把 date/timestamptz 转 text、bigint 转 int） */
export interface ContentProjectRow {
  id: number;
  title: string;
  source_idea_id: number | null;
  source_report_date: string | null;
  content_type: ContentType;
  target_audience: string | null;
  status: ProjectStatus;
  content_angle: string | null;
  hook: string | null;
  key_points: string[];
  reference_materials: ReferenceMaterial[];
  production_notes: string | null;
  duration_seconds: number | null;
  video_form: string | null;
  open_questions: string[];
  production_status: ProductionStatus;
  exported_at: string | null;
  export_path: string | null;
  script_result: unknown | null;
  storyboard_result: unknown | null;
  quality_check: unknown | null;
  created_at: string;
  updated_at: string;
}

/** 列表行：不拉三份可能很大的 JSONB 结果 */
export type ContentProjectListItem = Omit<
  ContentProjectRow,
  "script_result" | "storyboard_result" | "quality_check"
>;

/* ==================== 校验 ==================== */

const MAX_TITLE = 200;
const MAX_TEXT = 20000;
const MAX_LIST_ITEMS = 30;
const MAX_LIST_ITEM_LEN = 500;
const MIN_DURATION = 5;
const MAX_DURATION = 3600;

export type FieldErrors = Record<string, string>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanStringArray(
  raw: unknown,
  field: string,
  errors: FieldErrors
): string[] | undefined {
  if (!Array.isArray(raw)) {
    errors[field] = "必须是字符串数组";
    return undefined;
  }
  if (raw.length > MAX_LIST_ITEMS) {
    errors[field] = `最多 ${MAX_LIST_ITEMS} 条`;
    return undefined;
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      errors[field] = "数组元素必须是文本";
      return undefined;
    }
    const t = item.trim();
    if (!t) continue;
    if (t.length > MAX_LIST_ITEM_LEN) {
      errors[field] = `单条不能超过 ${MAX_LIST_ITEM_LEN} 字`;
      return undefined;
    }
    out.push(t);
  }
  return out;
}

function cleanMaterials(
  raw: unknown,
  errors: FieldErrors
): ReferenceMaterial[] | undefined {
  if (!Array.isArray(raw)) {
    errors.reference_materials = "必须是数组";
    return undefined;
  }
  if (raw.length > MAX_LIST_ITEMS) {
    errors.reference_materials = `最多 ${MAX_LIST_ITEMS} 条`;
    return undefined;
  }
  const out: ReferenceMaterial[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      errors.reference_materials = "每条必须是 {title,url,note} 对象";
      return undefined;
    }
    const pick = (k: string): string | null => {
      const v = item[k];
      if (v === undefined || v === null) return null;
      return typeof v === "string" ? v.trim() || null : null;
    };
    const entry: ReferenceMaterial = {
      title: pick("title"),
      url: pick("url"),
      note: pick("note"),
    };
    // 三项全空视为无效条目，直接丢弃（不写空对象进库）
    if (entry.title || entry.url || entry.note) out.push(entry);
  }
  return out;
}

/** PATCH 允许修改的字段（契约 §5 的白名单） */
export interface ProjectPatchValues {
  title?: string;
  content_type?: ContentType;
  target_audience?: string | null;
  content_angle?: string | null;
  hook?: string | null;
  key_points?: string[];
  reference_materials?: ReferenceMaterial[];
  production_notes?: string | null;
  duration_seconds?: number | null;
  video_form?: string | null;
  open_questions?: string[];
  status?: ProjectStatus;
}

const PATCH_FIELDS: readonly (keyof ProjectPatchValues)[] = [
  "title",
  "content_type",
  "target_audience",
  "content_angle",
  "hook",
  "key_points",
  "reference_materials",
  "production_notes",
  "duration_seconds",
  "video_form",
  "open_questions",
  "status",
];

/** 来源字段：只读，出现即报错（不静默忽略，避免调用方误以为改成功） */
const IMMUTABLE_FIELDS = ["source_idea_id", "source_report_date", "id", "created_at"] as const;

export type ProjectPatchValidation =
  | { ok: true; patch: ProjectPatchValues }
  | { ok: false; errors: FieldErrors };

export function validateProjectPatch(body: unknown): ProjectPatchValidation {
  const errors: FieldErrors = {};

  if (!isRecord(body)) {
    return { ok: false, errors: { form: "请求体必须是 JSON 对象" } };
  }

  for (const f of IMMUTABLE_FIELDS) {
    if (body[f] !== undefined) {
      errors[f] =
        f === "source_idea_id" || f === "source_report_date"
          ? "来源不可篡改：来源选题与来源日报日期由创建时确定，不能修改"
          : "该字段不允许修改";
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const provided = PATCH_FIELDS.filter((f) => body[f] !== undefined);
  if (provided.length === 0) {
    return { ok: false, errors: { form: "没有需要更新的字段" } };
  }

  const patch: ProjectPatchValues = {};

  for (const field of provided) {
    const raw = body[field];

    switch (field) {
      case "title": {
        if (typeof raw !== "string" || !raw.trim()) errors.title = "标题必填";
        else if (raw.trim().length > MAX_TITLE) errors.title = `标题不能超过 ${MAX_TITLE} 字`;
        else patch.title = raw.trim();
        break;
      }
      case "content_type": {
        if (!isContentType(raw)) errors.content_type = "内容类型不在枚举内";
        else patch.content_type = raw;
        break;
      }
      case "status": {
        if (!isProjectStatus(raw)) errors.status = "项目状态不在枚举内";
        else patch.status = raw;
        break;
      }
      case "duration_seconds": {
        if (raw === null) patch.duration_seconds = null;
        else if (typeof raw !== "number" || !Number.isInteger(raw))
          errors.duration_seconds = "时长必须是整数秒";
        else if (raw < MIN_DURATION || raw > MAX_DURATION)
          errors.duration_seconds = `时长必须在 ${MIN_DURATION}-${MAX_DURATION} 秒之间`;
        else patch.duration_seconds = raw;
        break;
      }
      case "key_points":
      case "open_questions": {
        const arr = cleanStringArray(raw, field, errors);
        if (arr) patch[field] = arr;
        break;
      }
      case "reference_materials": {
        const arr = cleanMaterials(raw, errors);
        if (arr) patch.reference_materials = arr;
        break;
      }
      case "target_audience":
      case "content_angle":
      case "hook":
      case "production_notes":
      case "video_form": {
        if (raw === null) patch[field] = null;
        else if (typeof raw !== "string") errors[field] = "必须是文本";
        else if (raw.trim().length > MAX_TEXT) errors[field] = `内容不能超过 ${MAX_TEXT} 字`;
        else patch[field] = raw.trim() || null;
        break;
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, patch };
}

/* ---------------- 创建 ---------------- */

export interface CreateProjectValues {
  topicIdeaId: number;
  contentType: ContentType;
  targetAudience: string | null;
}

export type CreateProjectValidation =
  | { ok: true; value: CreateProjectValues }
  | { ok: false; errors: FieldErrors };

export function validateCreateProject(body: unknown): CreateProjectValidation {
  if (!isRecord(body)) {
    return { ok: false, errors: { form: "请求体必须是 JSON 对象" } };
  }

  const errors: FieldErrors = {};

  const rawId = body.topicIdeaId;
  let topicIdeaId = 0;
  if (typeof rawId !== "number" || !Number.isInteger(rawId) || rawId <= 0) {
    errors.topicIdeaId = "选题 ID 必填，且必须是正整数";
  } else {
    topicIdeaId = rawId;
  }

  let contentType: ContentType = "ai_news";
  if (body.contentType !== undefined) {
    if (!isContentType(body.contentType)) errors.contentType = "内容类型不在枚举内";
    else contentType = body.contentType;
  }

  let targetAudience: string | null = null;
  if (body.targetAudience !== undefined && body.targetAudience !== null) {
    if (typeof body.targetAudience !== "string") errors.targetAudience = "目标受众必须是文本";
    else if (body.targetAudience.trim().length > 500) errors.targetAudience = "目标受众不能超过 500 字";
    else targetAudience = body.targetAudience.trim() || null;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { topicIdeaId, contentType, targetAudience } };
}

/* ---------------- 回读 ---------------- */

/** 允许回读写入的 JSONB 结果：必须是对象或数组，拒绝裸字符串/数字 */
function isJsonPayload(v: unknown): boolean {
  return typeof v === "object" && v !== null;
}

export interface ImportValues {
  scriptResult?: unknown;
  storyboardResult?: unknown;
  qualityCheck?: unknown;
  productionStatus?: ProductionStatus;
}

export type ImportValidation =
  | { ok: true; value: ImportValues }
  | { ok: false; errors: FieldErrors };

export function validateImport(body: unknown): ImportValidation {
  if (!isRecord(body)) {
    return { ok: false, errors: { form: "请求体必须是 JSON 对象" } };
  }

  const errors: FieldErrors = {};
  const value: ImportValues = {};

  for (const field of ["scriptResult", "storyboardResult", "qualityCheck"] as const) {
    const raw = body[field];
    if (raw === undefined) continue;
    if (!isJsonPayload(raw)) {
      errors[field] = "必须是 JSON 对象或数组（字符串请先解析为 JSON）";
      continue;
    }
    value[field] = raw;
  }

  if (body.productionStatus !== undefined) {
    if (!isProductionStatus(body.productionStatus)) {
      errors.productionStatus = "生产状态不在枚举内";
    } else {
      value.productionStatus = body.productionStatus;
    }
  }

  if (Object.keys(value).length === 0 && Object.keys(errors).length === 0) {
    errors.form = "没有需要回读的内容";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

/** 回读后项目阶段状态：已完成 → 已完成，否则 → 已回传 */
export function projectStatusForImport(productionStatus: ProductionStatus): ProjectStatus {
  return productionStatus === "已完成" ? "已完成" : "已回传";
}
