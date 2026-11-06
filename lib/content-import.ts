// 回读用户生产系统的产物 —— 纯函数，无 IO
//
// 用户侧的真实产物是文件（05_storyboards/storyboard.md、project_state.json），
// 本平台不自动读取磁盘：由用户/脚本把这些内容整理成 JSON 后 POST 回本接口。
// 因此这里只做「状态推导 + 载荷归一化」，不猜测文件内容。
//
// 依据：docs/phase3-stageB-interface.md §5「POST /api/content-projects/[id]/import」

import type { ImportValues, ProductionStatus } from "./content-projects-shared";

/**
 * 推导回读后的生产状态。
 * - 显式传入 productionStatus 时以它为准（枚举已在 validateImport 中校验）；
 * - 只传 storyboardResult → 已出分镜；
 * - 只传 scriptResult → 已导入脚本；
 * - 只传 qualityCheck 或什么都没推进 → 保持当前状态。
 */
export function resolveImportStatus(
  value: ImportValues,
  current: ProductionStatus
): ProductionStatus {
  if (value.productionStatus) return value.productionStatus;
  if (value.storyboardResult !== undefined) return "已出分镜";
  if (value.scriptResult !== undefined) return "已导入脚本";
  return current;
}

/** 已回读的内容项（UI 用来显示「已收到哪些产物」） */
export function importedKinds(value: {
  script_result: unknown | null;
  storyboard_result: unknown | null;
  quality_check: unknown | null;
}): string[] {
  const kinds: string[] = [];
  if (value.script_result !== null && value.script_result !== undefined) kinds.push("脚本");
  if (value.storyboard_result !== null && value.storyboard_result !== undefined) kinds.push("分镜");
  if (value.quality_check !== null && value.quality_check !== undefined) kinds.push("质检");
  return kinds;
}
