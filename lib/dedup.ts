// 语义去重 —— 判断「这条新内容是不是已经在库里了」
//
// 设计约束（重要，主控在阶段 D 需要把本文件逐函数移植到 n8n 的 Code 节点）：
// - 本文件只 import ./normalize，不得 import 任何 Node 内置模块或第三方库；
// - 全部计算基于字符串与集合运算，不引入 embedding / 向量库 / 外部 API；
// - 移植到 n8n 时需要一并带上 normalize.ts 的全部常量（实体变体表 / 领域词典 / 主题分类 / 停用词）。
//
// 判定流程（契约 docs/phase2-stageB-interface.md 第 3.3 / 3.4 节）：
//   1. 归一化标题完全相同 → 重复
//   2. 提取双方 entities / keywords / topics
//   3. 命中共同重要实体（含弱关联实体）
//      → 主题相似度 ≥ topicThreshold 或 关键词重合度 ≥ keywordThreshold × entityRelaxFactor → 重复
//   4. 无共同重要实体
//      → 主题相似度 ≥ topicThreshold 且 关键词重合度 ≥ keywordThreshold → 重复
//   5. 否则 → 不重复
//
// 第 3 步的宽松条件让「同实体同主题」容易判重，第 4 步的严格双条件保证
// 「同领域不同机会」不被误判。

import {
  normalizeText,
  normalizeTitle,
  extractEntities,
  extractKeywords,
  extractTopics,
  relatedEntities,
  keywordWeight,
} from "./normalize";

/* ==================== 接口 ==================== */

/** 去重判定的输入项 */
export interface DedupCandidate {
  title: string;
  /** 可选的补充描述，用于提升判定准确度 */
  description?: string | null;
}

export interface DedupMatch {
  /** 命中的历史记录 id（DB 主键）；内存比较时为 -1 */
  id: number;
  /** 命中的历史标题 */
  title: string;
  /** 判定为重复的依据（写入 skip 原因，可读） */
  reason: string;
  /** 相似度得分 0~1 */
  score: number;
  /** 判定依据的明细 */
  matched: {
    keywords: string[];
    entities: string[];
    topics: string[];
  };
}

export interface DedupOptions {
  /** 关键词重合度阈值（0~1），默认见 DEFAULT_DEDUP_OPTIONS */
  keywordThreshold?: number;
  /** 主题相似度阈值（0~1） */
  topicThreshold?: number;
  /** 实体匹配时降低关键词要求的乘数 */
  entityRelaxFactor?: number;
  /** 是否要求至少命中一个重要实体 */
  requireEntity?: boolean;
}

export interface DedupResult {
  /** 是否判定为重复 */
  duplicate: boolean;
  /** 命中的历史记录（duplicate 为 true 时非空） */
  match: DedupMatch | null;
  /** 相似度得分 0~1 */
  score: number;
  /** 人类可读的判定说明（无论是否重复都给出，便于审计） */
  explanation: string;
}

/* ==================== 默认阈值（契约 3.4） ==================== */

export const DEFAULT_DEDUP_OPTIONS: Required<DedupOptions> = {
  keywordThreshold: 0.55,
  topicThreshold: 0.6,
  entityRelaxFactor: 0.7,
  requireEntity: false,
};

/* ==================== 内部工具 ==================== */

/** 一侧的文本特征 */
interface Features {
  /** 归一化标题（用于第 1 步精确比较） */
  title: string;
  /** 重要实体 */
  entities: string[];
  /** 关键词（含实体词与领域词） */
  keywords: string[];
  /** 主题标签 */
  topics: string[];
}

/** 提取一侧特征：实体/主题只取自标题，关键词可用 description 补充 */
function featuresOf(candidate: DedupCandidate): Features {
  const title = typeof candidate?.title === "string" ? candidate.title : "";
  const description =
    typeof candidate?.description === "string" ? candidate.description : "";

  const normalizedTitle = normalizeText(title);
  const entities = extractEntities(title);
  const topics = extractTopics(title);

  // 关键词：标题关键词 + 描述补充关键词（描述只补关键词，不参与实体/主题判定，
  // 避免长描述里的顺带提及把判定带偏）
  const titleKeywords = extractKeywords(title);
  const descKeywords = description.trim() ? extractKeywords(description) : [];
  const keywords = Array.from(new Set([...titleKeywords, ...descKeywords]));

  return {
    title: normalizeTitle(title),
    entities,
    keywords,
    topics,
  };
}

/**
 * 关键词相似度：双向覆盖率的较大值（overlap coefficient）。
 *
 * 为什么不用 Jaccard：Jaccard = 交集/并集，两侧关键词总数差异大时会被稀释。
 * 例如「为内部研发团队搭建轻量工单自动化工具」与「给研发小组做轻量的工单自动流转工具」
 * 交集 5 个词、并集 14 个词，Jaccard 只有 35%（判不出重复），
 * 但其中一侧的关键词几乎全被另一侧覆盖（覆盖率 70%+），语义上明显是同一件事。
 * 取两向覆盖率的较大值，可以让「长描述 vs 短标题」这类场景也能正确判重，
 * 同时不会像纯 Jaccard 那样过度严格。
 *
 * 权重：实体/领域词 1.0，通用词 0.5（实体与领域词更有区分度）。
 */
function keywordSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);

  // 交集权重
  let inter = 0;
  for (const k of setA) {
    if (setB.has(k)) inter += keywordWeight(k);
  }
  if (inter === 0) return 0;

  // 两侧各自的权重总和
  let sumA = 0;
  for (const k of setA) sumA += keywordWeight(k);
  let sumB = 0;
  for (const k of setB) sumB += keywordWeight(k);
  if (sumA === 0 || sumB === 0) return 0;

  return Math.max(inter / sumA, inter / sumB);
}

/**
 * 主题相似度：双向覆盖率（与关键词同思路，保持两侧判定口径一致）。
 * 主题标签数量少（2~5 个），覆盖率比 Jaccard 更能反映「是否在讲同一件事」。
 */
function topicSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  if (inter === 0) return 0;
  return Math.max(inter / setA.size, inter / setB.size);
}

interface EntityHit {
  /** 是否命中（强命中或弱关联命中） */
  hit: boolean;
  /** 强命中：规范名完全一致 */
  strong: string[];
  /** 弱命中：通过 related 关联上的规范名对 */
  weak: Array<{ from: string; to: string }>;
}

/**
 * 实体命中判定：
 * - 强命中：双方实体集合直接相交；
 * - 弱命中：A 的实体的 related 列表里含 B 的实体（或反之），
 *   例如 codex ↔ 编程agent、nvidia ↔ cosmos 3。
 */
function entityHit(a: string[], b: string[]): EntityHit {
  const strong: string[] = [];
  const setB = new Set(b);
  for (const e of a) {
    if (setB.has(e) && !strong.includes(e)) strong.push(e);
  }

  const weak: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();
  for (const e of a) {
    for (const r of relatedEntities(e)) {
      if (!setB.has(r)) continue;
      const key = `${e}->${r}`;
      if (seen.has(key)) continue;
      seen.add(key);
      weak.push({ from: e, to: r });
    }
  }

  return { hit: strong.length > 0 || weak.length > 0, strong, weak };
}

/** 交集（保持 a 的顺序） */
function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  const out: string[] = [];
  for (const x of a) {
    if (setB.has(x) && !out.includes(x)) out.push(x);
  }
  return out;
}

/** 合并两侧特征，用于生成可读的判定说明 */
function describeEntityHit(hit: EntityHit): string {
  const parts: string[] = [];
  if (hit.strong.length > 0) parts.push(`共同实体 ${hit.strong.join("/")}`);
  if (hit.weak.length > 0) {
    parts.push(
      `关联实体 ${hit.weak.map((w) => `${w.from}≈${w.to}`).join("/")}`
    );
  }
  return parts.join("，");
}

/* ==================== 主判定 ==================== */

/**
 * 判定候选是否与给定历史集合中的某项语义重复
 * @param candidate 待判定的新条目
 * @param history 历史条目集合
 * @param options 阈值配置
 */
export function isDuplicate(
  candidate: DedupCandidate,
  history: DedupCandidate[],
  options?: DedupOptions
): DedupResult {
  const opts: Required<DedupOptions> = { ...DEFAULT_DEDUP_OPTIONS, ...(options ?? {}) };
  const c = featuresOf(candidate);
  const hist = Array.isArray(history) ? history : [];

  // 第 1 步：归一化标题完全一致
  for (const h of hist) {
    const hTitle = normalizeTitle(typeof h?.title === "string" ? h.title : "");
    if (c.title.length > 0 && c.title === hTitle) {
      return {
        duplicate: true,
        match: {
          id: -1,
          title: h.title,
          reason: "标题归一化后完全一致",
          score: 1,
          matched: { keywords: [], entities: [], topics: [] },
        },
        score: 1,
        explanation: `与历史条目「${h.title}」重复：标题归一化后完全一致。`,
      };
    }
  }

  let best: DedupResult = {
    duplicate: false,
    match: null,
    score: 0,
    explanation: `与 ${hist.length} 条历史条目均不重复。`,
  };
  /** 最接近的一条历史项的说明（不判重时也要给出可审计的原因） */
  let closestExplanation = "";
  let closestScore = -1;

  for (const h of hist) {
    const hf = featuresOf(h);

    const kwSim = keywordSimilarity(c.keywords, hf.keywords);
    const tpSim = topicSimilarity(c.topics, hf.topics);
    const eh = entityHit(c.entities, hf.entities);
    const commonKeywords = intersect(c.keywords, hf.keywords);
    const commonTopics = intersect(c.topics, hf.topics);
    const score = Math.max(kwSim, tpSim);

    const relaxedThreshold = opts.keywordThreshold * opts.entityRelaxFactor;

    let duplicate = false;
    let reason = "";
    let explanation = "";

    if (opts.requireEntity && !eh.hit) {
      duplicate = false;
      explanation = `与「${h.title}」：无共同重要实体（要求实体命中），不判重。关键词重合 ${pct(kwSim)}，主题相似 ${pct(tpSim)}。`;
    } else if (eh.hit) {
      // 第 3 步：命中共同重要实体 → 宽松条件
      if (tpSim >= opts.topicThreshold) {
        duplicate = true;
        reason = `主题相似度 ${pct(tpSim)} ≥ ${pct(opts.topicThreshold)}，且${describeEntityHit(eh)}`;
      } else if (kwSim >= relaxedThreshold) {
        duplicate = true;
        reason = `关键词重合度 ${pct(kwSim)} ≥ ${pct(relaxedThreshold)}（实体命中放宽系数 ${opts.entityRelaxFactor}），且${describeEntityHit(eh)}`;
      } else {
        explanation = `与「${h.title}」：命中${describeEntityHit(eh)}，但主题相似 ${pct(tpSim)} < ${pct(opts.topicThreshold)} 且关键词重合 ${pct(kwSim)} < ${pct(relaxedThreshold)}，不判重。`;
      }
    } else {
      // 第 4 步：无共同重要实体 → 严格双条件
      if (tpSim >= opts.topicThreshold && kwSim >= opts.keywordThreshold) {
        duplicate = true;
        reason = `主题相似度 ${pct(tpSim)} ≥ ${pct(opts.topicThreshold)} 且关键词重合度 ${pct(kwSim)} ≥ ${pct(opts.keywordThreshold)}`;
      } else {
        explanation = `与「${h.title}」：无共同重要实体，主题相似 ${pct(tpSim)}、关键词重合 ${pct(kwSim)}，未同时达到 ${pct(opts.topicThreshold)} / ${pct(opts.keywordThreshold)}，不判重。`;
      }
    }

    if (duplicate) {
      const matched = {
        keywords: commonKeywords,
        entities: eh.strong,
        topics: commonTopics,
      };
      const result: DedupResult = {
        duplicate: true,
        match: {
          id: -1,
          title: h.title,
          reason,
          score,
          matched,
        },
        score,
        explanation: `与历史条目「${h.title}」重复：${reason}。`,
      };
      // 命中多条时取得分最高的一条作为 match
      if (!best.duplicate || score >= best.score) {
        best = result;
      }
      continue;
    }

    // 未判重：记录最接近的一条，供最终 explanation 使用（保证说明具体可审计）
    if (score > closestScore) {
      closestScore = score;
      closestExplanation = explanation;
    }
  }

  // 未判重时，用最接近的一条历史项的说明作为结论（没有历史则用默认文案）
  if (!best.duplicate && closestExplanation) {
    best = {
      duplicate: false,
      match: null,
      score: Math.max(0, closestScore),
      explanation: closestExplanation,
    };
  }

  return best;
}

/**
 * 批量筛选出重复项
 *
 * 注意：筛选过程中，命中的历史集合会动态增长（已判定为 unique 的候选会加入历史），
 * 这样同一批内部的重复也能被识别出来。
 */
export function filterDuplicates(
  candidates: DedupCandidate[],
  history: DedupCandidate[],
  options?: DedupOptions
): { unique: DedupCandidate[]; duplicates: Array<{ candidate: DedupCandidate; result: DedupResult }> } {
  const unique: DedupCandidate[] = [];
  const duplicates: Array<{ candidate: DedupCandidate; result: DedupResult }> = [];

  const base = Array.isArray(history) ? [...history] : [];
  const list = Array.isArray(candidates) ? candidates : [];

  for (const candidate of list) {
    const result = isDuplicate(candidate, base, options);
    if (result.duplicate) {
      duplicates.push({ candidate, result });
      continue;
    }
    unique.push(candidate);
    base.push(candidate);
  }

  return { unique, duplicates };
}

/** 百分比展示（便于写进 skip 原因） */
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
