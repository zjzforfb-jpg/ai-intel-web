// 导出 production_input.json —— 纯函数，无 IO
//
// 依据：docs/phase3-stageB-interface.md §5「GET /api/content-projects/[id]/export」
// 只负责「把数据库行组装成契约规定的 JSON」，不写文件、不发请求、不改库。
//
// 诚实红线：
// - 来源日报/选题不存在时字段留 null 或空数组，绝不编造标题；
// - 不写入任何「已自动对接」的标记，target_pipeline 仅描述用户侧文件流水线的约定。

import type {
  ContentProjectRow,
  ContentType,
  ReferenceMaterial,
} from "./content-projects-shared";

export const EXPORT_SCHEMA_VERSION = "1.0";
export const EXPORT_GENERATOR = "ai-intel-web/phase3";

export interface ExportSourceIdea {
  id: number;
  title: string;
  angle: string | null;
  /** 数据库里是 SMALLINT，可能为 null（自动抽取失败时） */
  value_score: number | null;
}

export interface ExportSourceReport {
  report_date: string;
  /** 软引用：日报行可能已不存在，此时为 null，不做补写 */
  title: string | null;
}

export interface ProductionInput {
  schema_version: string;
  generator: string;
  project_id: number;
  title: string;
  content_type: ContentType;
  target_audience: string | null;
  duration_seconds: number | null;
  video_form: string | null;
  hook: string | null;
  content_angle: string | null;
  key_points: string[];
  reference_materials: ReferenceMaterial[];
  source_reports: Array<{ report_date: string; title: string | null; url: string }>;
  source_ideas: Array<{
    id: number;
    title: string;
    angle: string | null;
    value_score: number | null;
  }>;
  production_requirements: {
    aspect_ratio: string;
    language: string;
    must_cite_sources: boolean;
    no_fabrication: boolean;
    open_questions: string[];
  };
  target_pipeline: {
    system: string;
    entry_dir: string;
    state_file: string;
    read_back: string[];
  };
}

export interface BuildExportInput {
  project: ContentProjectRow;
  sourceIdea: ExportSourceIdea | null;
  sourceReport: ExportSourceReport | null;
}

/** 与用户 AI_DIRECTOR_PROJECT 文件流水线的约定（只做说明，不执行） */
export const TARGET_PIPELINE = {
  system: "AI_DIRECTOR_PROJECT",
  entry_dir: "00_source",
  state_file: "project_state.json",
  read_back: ["05_storyboards/storyboard.md", "project_state.json"],
} as const;

/** 建议的落盘位置（相对项目根目录），仅作为文案提示，后端不写盘 */
export const SUGGESTED_EXPORT_PATH = "00_source/production_input.json";

export function buildProductionInput({
  project,
  sourceIdea,
  sourceReport,
}: BuildExportInput): ProductionInput {
  const sourceReports =
    project.source_report_date !== null
      ? [
          {
            report_date: project.source_report_date,
            title: sourceReport?.title ?? null,
            url: `/report/${project.source_report_date}`,
          },
        ]
      : [];

  const sourceIdeas =
    sourceIdea !== null
      ? [
          {
            id: sourceIdea.id,
            title: sourceIdea.title,
            angle: sourceIdea.angle,
            value_score: sourceIdea.value_score,
          },
        ]
      : [];

  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    generator: EXPORT_GENERATOR,
    project_id: project.id,
    title: project.title,
    content_type: project.content_type,
    target_audience: project.target_audience,
    duration_seconds: project.duration_seconds,
    video_form: project.video_form,
    hook: project.hook,
    content_angle: project.content_angle,
    key_points: project.key_points,
    reference_materials: project.reference_materials,
    source_reports: sourceReports,
    source_ideas: sourceIdeas,
    production_requirements: {
      aspect_ratio: "16:9",
      language: "zh-CN",
      must_cite_sources: true,
      no_fabrication: true,
      open_questions: project.open_questions,
    },
    target_pipeline: {
      system: TARGET_PIPELINE.system,
      entry_dir: TARGET_PIPELINE.entry_dir,
      state_file: TARGET_PIPELINE.state_file,
      read_back: [...TARGET_PIPELINE.read_back],
    },
  };
}

/** 导出前的完整性检查：返回「需要在片子里注意」的提示，不阻断导出 */
export function exportWarnings(p: ContentProjectRow): string[] {
  const warnings: string[] = [];
  if (!p.content_angle && !p.hook) warnings.push("尚未填写切入角度与开场钩子，脚本阶段可能缺少方向");
  if (p.key_points.length === 0) warnings.push("核心观点为空，建议先补充要点再交给生产流程");
  if (p.reference_materials.length === 0) warnings.push("没有参考素材，成片可能缺少可核查的原始出处");
  if (p.open_questions.length > 0) warnings.push(`仍有 ${p.open_questions.length} 条待核实信息，片中不得当作事实`);
  return warnings;
}
