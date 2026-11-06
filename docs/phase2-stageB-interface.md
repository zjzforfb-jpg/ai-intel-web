# 阶段 B · 共享接口设计（Agent A / Agent B 边界契约）

> 本文件是主控与两个 Agent 的**唯一契约**。Agent 不得擅自更改本文档定义的函数签名与返回结构；
> 如认为设计有误，先向主控提交变更申请，不得自行改动。

---

## 1. 文件归属（互斥，禁止越界）

| 文件 | 归属 | 说明 |
|---|---|---|
| `lib/markdown-parser.ts` | **Agent A 独占** | 日报结构化解析 |
| `tests/markdown-parser.test.ts` | **Agent A 独占** | 新增 |
| `lib/normalize.ts` | **Agent B 独占** | 轻量归一化 |
| `lib/dedup.ts` | **Agent B 独占** | 语义去重判定 |
| `tests/normalize.test.ts` | **Agent B 独占** | 新增 |
| `tests/dedup.test.ts` | **Agent B 独占** | 新增 |
| `lib/opportunity-draft.ts` | **Agent B 独占** | 修复去重与覆盖问题 |
| `lib/ideas.ts` | **Agent B 独占** | 跨日报查重 |
| `lib/opportunity-draft.ts` 内的 `normalizeDraftTitle` | **Agent B** | 改为委托 `lib/normalize.ts` |

**主控独占**（两个 Agent 不得触碰）：
`lib/db.ts`、`lib/db-write.ts`、`lib/ideas-shared.ts`、`lib/opportunities-shared.ts`、
`lib/opportunities.ts`、`app/**`、`components/**`、`package.json`、
`migrations/**`、`tests/rules.test.ts`、`tests/store.test.ts`、`tests/notify.test.ts`、
`tests/integration/monitor.test.ts`、`tests/ideas.test.ts`、`tests/opportunity-draft.test.ts`、
`docs/**`（Agent 若需文档，在自己的提交里新建 `docs/phase2-agent-X.md`）。

> **注意**：`tests/ideas.test.ts` 与 `tests/opportunity-draft.test.ts` 属主控。
> Agent B 修改 `lib/ideas.ts` / `lib/opportunity-draft.ts` 后**不得修改这两个测试文件**；
> 若旧测试因此失败，须在**自己的新测试文件**里体现新行为，并**在提交说明中明确列出哪些旧断言已失效**，
> 由主控统一更新旧测试。

---

## 2. Agent A：解析器契约

### 2.1 目标格式（必须同时支持，不得破坏 DeepSeek 旧格式）

| 场景 | 格式 A（DeepSeek，保留） | 格式 B（MiniMax，新增兼容） |
|---|---|---|
| 头条字段 | `- **核心事实**：内容` | `- **核心事实：** 内容`（冒号在加粗内） |
| 核心判断 | `1. **标题**：说明` 编号列表 | 散文段落（无编号无加粗） |
| 趋势条目 | `1. **标题**` + `- 判断依据：…` + `- 观点：…` | `### 1. 标题`（无子字段） |
| 机会条目 | `1. **标题**` + `- 机会来源：…` + `- 实现方向：…` + `- 潜在价值：…` | `### 1. 标题`（无子字段） |
| 标点 | 全角 `：` | 中英混用（`:` / `：`） |

### 2.2 必须支持的字段别名

| 规范字段 | 接受的键名 |
|---|---|
| `source` | `来源及发布时间`、`来源`、`来源和时间` |
| `coreFact` | `核心事实`、`事实` |
| `deepAnalysis` | `深度解读`、`深度分析`、`解读` |
| `impact` | `对行业的影响`、`行业影响`、`影响` |
| `link` | `原文链接`、`链接`、`原文链接地址` |
| `basis`（趋势） | `判断依据`、`依据` |
| `viewpoint`（趋势） | `观点`、`观点解读` |
| `source`（机会） | `机会来源`、`来源` |
| `direction`（机会） | `实现方向`、`方向` |
| `value`（机会） | `潜在价值`、`价值` |

### 2.3 `parseReport` 返回值 —— 保持现有结构，向后兼容

```ts
export interface ParsedReport {
  coreJudgments: CoreJudgment[];
  headlines: HeadlineItem[];
  trends: TrendItem[];
  opportunities: OpportunityItem[];
  sections: Array<{ level: number; title: string; raw: string }>;
}
```

**允许新增**（全部可选，不破坏现有调用方）：

```ts
export interface ParseDiagnostic {
  /** 该章节内未能解析成条目的原始片段 */
  unparsed: Array<{ section: string; fragment: string; reason: string }>;
  /** 哪些章节被识别到但 0 条目 */
  emptySections: string[];
}

export interface ParsedReport {
  // ...现有字段不变...
  /** 解析诊断信息（可选） */
  diagnostics?: ParseDiagnostic;
}
```

### 2.4 新增导出函数（Agent A 必须提供）

```ts
/**
 * 解析单条头条的字段行（供 n8n 侧结构校验复用逻辑参考）
 * @param lines 字段行数组
 * @returns 字段映射；未识别的键放入 extra
 */
export interface HeadlineFields {
  source?: string;
  coreFact?: string;
  deepAnalysis?: string;
  impact?: string;
  link?: string;
  /** 未知字段（保留原文，不丢弃） */
  extra: Record<string, string>;
}

export function parseHeadlineFields(lines: string[]): HeadlineFields;
```

### 2.5 硬性要求

1. **不得静默丢失**：任何无法解析的原文必须进入 `diagnostics.unparsed`，
   且 `diagnostics` 必须在 `parseReport` 返回值中存在（当有未解析内容时）。
2. **空状态可辨识**：`parseReport` 对完全无法识别的章节，`sections` 仍要保留原始 `raw`，
   使页面能展示「原始内容」而不是空白。
3. **不得破坏 DeepSeek 旧格式**：`tests/` 中已有的解析相关断言（若存在）必须仍通过。
4. **链接必须被正确提取**：头条必须能解析出 `link`（用户明确反馈过「无法点击跳转」）。

### 2.6 Agent A 交付物

- `lib/markdown-parser.ts`（改造）
- `tests/markdown-parser.test.ts`（新增，至少 12 个用例）
- 测试必须覆盖：
  - DeepSeek 旧格式全字段（冒号在外）
  - MiniMax 格式（冒号在加粗内）
  - 核心判断散文段落
  - 趋势/机会 `### 1. 标题` 格式
  - 中英标点混用
  - 空行 / 缩进 / 列表层级
  - 无法识别时 `diagnostics.unparsed` 非空
  - 头条 link 必被提取

---

## 3. Agent B：归一化与去重契约

### 3.1 `lib/normalize.ts` —— 接口

```ts
/** 归一化后的文本特征 */
export interface NormalizedText {
  /** 完全归一化后的小写文本（用于精确比较） */
  text: string;
  /** 提取的关键词集合（已去重、去停用词） */
  keywords: string[];
  /** 提取的重要实体（公司/产品/技术名等） */
  entities: string[];
  /** 提取的主题标签（用于主题相似度） */
  topics: string[];
}

/**
 * 轻量归一化：大小写、空格标点、中英混合、无意义前缀、营销修饰词
 * 不依赖 embedding / 向量库 / 外部 API
 */
export function normalizeText(input: string): NormalizedText;

/**
 * 仅做标题级归一化，返回可直接用于唯一性比较的字符串
 * 规则：去营销前缀、去标点空白、统一全半角、统一大小写、实体名变体合并
 */
export function normalizeTitle(title: string): string;

/**
 * 提取重要实体（公司名、产品名、技术名等）
 */
export function extractEntities(text: string): string[];

/**
 * 提取关键词（中文按 2-4 字切分 + 英文按词切分，去停用词）
 */
export function extractKeywords(text: string): string[];

/**
 * 提取主题标签（用于「同主题」判定）
 */
export function extractTopics(text: string): string[];
```

**归一化规则清单（Agent B 必须实现，可扩展但不得删减）**：

| 类别 | 处理 |
|---|---|
| 大小写 | 英文全部转小写 |
| 全半角 | 全角标点 → 半角；数字全角 → 半角 |
| 中英标点混用 | `：`/`:`/`＝`/`=` 统一；`，`/`,`/`，` 统一 |
| 空格 | 中文字符间空格全部去除；英文单词间单空格化 |
| 无意义前缀 | `如何`/`怎样`/`怎么`/`为什么`/`是否`/`可以`/`能否`/`一个`/`关于`/`针对`/`基于`/`通过`/`用`/`做`/`的`/`了`/`吗`/`呢` 等 |
| 营销修饰词 | `重磅`/`最新`/`独家`/`深度`/`终极`/`全新`/`最强`/`必看`/`实测`/`亲测`/`免费`/`限时`/`推荐`/`抢先`/`揭秘`/`突发` 等 |
| 实体名变体 | `Facebook`/`Meta`/`fb`；`OpenAI`/`openai`/`Open AI`；`谷歌`/`Google`；`英伟达`/`NVIDIA`/`Nvidia`；`Claude Code`/`claude-code`/`ClaudeCode` 等 |
| 标点与符号 | `—`/`–`/`-`/`~`/`·` 等统一 |

### 3.2 `lib/dedup.ts` —— 接口

```ts
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
  /** 关键词重合度阈值（0~1），默认见 3.4 */
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
): DedupResult;

/**
 * 批量筛选出重复项
 */
export function filterDuplicates(
  candidates: DedupCandidate[],
  history: DedupCandidate[],
  options?: DedupOptions
): { unique: DedupCandidate[]; duplicates: Array<{ candidate: DedupCandidate; result: DedupResult }> };
```

### 3.3 判定逻辑（Agent B 必须遵循）

**必须判定为重复：**

- 同主题不同措辞：「为编码Agent提供网络出口审计与PII脱敏网关」vs「为AI编程Agent提供网络出口审计与PII脱敏网关」
- 「基于Rivet做轻量长任务Agent托管与部署服务」vs「基于Rivet搭建长周期Agent的托管编排与状态迁移服务」
- 「用Codex为中小企业业务团队搭建内部小工具」vs「用代码Agent为中小团队定制垂直内部运营工具」
- 「Claude Code竟把邮箱发给网站？企业该慌了」vs「Claude Code会把邮箱发给网站？这份报告仍待确认」
- 「Facebook被指放任AI深伪广告？160亿美元争议来了」vs「AI换脸诈骗广告赚160亿？Facebook被指明知故犯」
- 「英伟达开源世界模型Cosmos 3，机器人训练场要变天？」vs「NVIDIA发世界模型？Cosmos 3让AI在仿真里学干活」

**必须判定为不重复（反例）：**

- 同公司不同产品：「用Codex为中小企业业务团队搭建内部小工具」vs「用Rivet搭建长周期Agent托管服务」
- 同领域不同机会：「长上下文内存成本优化工具」vs「Agent网络出口审计网关」
- 同公司不同产品：「Gemini低成本长片段 API 评测工作流」vs「Cosmos 3 仿真训练平台」
- 同一实体的不同侧面：「Claude Code 邮箱泄露隐私风险」vs「Claude Code 编程效率对比评测」

### 3.4 默认阈值

```ts
export const DEFAULT_DEDUP_OPTIONS: Required<DedupOptions> = {
  keywordThreshold: 0.55,
  topicThreshold: 0.6,
  entityRelaxFactor: 0.7,
  requireEntity: false,
};
```

判定流程：

1. 归一化标题 → 完全相同 → **duplicate**（reason: 标题归一化后完全一致）
2. 提取双方 entities / keywords / topics
3. **实体命中**（有共同重要实体，如 `Claude Code`、`Cosmos 3`、`Rivet`、`Facebook`）
   → 主题相似度 ≥ `topicThreshold` **或** 关键词重合度 ≥ `keywordThreshold × entityRelaxFactor` → **duplicate**
4. **无共同重要实体** → 主题相似度 ≥ `topicThreshold` **且** 关键词重合度 ≥ `keywordThreshold` → **duplicate**
5. 否则 → **not duplicate**

> 第 3 步的 `entityRelaxFactor` 是关键：它让「同实体同主题」更容易被判重，
> 同时第 4 步的严格双条件保证「同领域不同机会」不被误判。

### 3.5 `lib/opportunity-draft.ts` 修复要求（Agent B）

1. **去重改用 `isDuplicate`**：全表历史记录作为 history，语义去重。
2. **保留更完整的记录**：当新候选与历史项判定重复时，
   若新候选的 description 更长/更完整，**更新历史项的 description**（合并而非丢弃），
   不得直接丢弃新数据。
3. **绝不覆盖人工字段**：
   - `notes`：人工编辑过的（`isDraftNotes(notes) === false` 且 notes 非空）→ **不覆盖**。
   - `action_plan`：任何情况下不覆盖。
   - `status`：任何情况下不覆盖（人工可能已推进到「验证中」等）。
4. **记录跳过原因**：`DraftSkipReason.reason` 必须写明判定依据（命中实体/关键词/主题，或归一化标题相同）。
5. **保持现有导出签名兼容**：`draftOpportunities(reportDate, candidates)` 不变；
   `formatDraftNotes` / `isDraftNotes` / `DRAFT_NOTES_PREFIX` 签名与行为不变（页面依赖）。
   `normalizeDraftTitle` 保留导出名，但实现改为委托 `normalizeTitle`（保持向后兼容）。

### 3.6 `lib/ideas.ts` 修复要求（Agent B）

1. **跨日报查重**：新增/更新选题时，对**全表**（不限日期）做语义去重。
2. **同主题不同角度可保留**：若两条选题同主题但 `angle`（切入角度）显著不同，
   允许同时保留，但**必须在结果中标注差异**（返回去重说明，不静默丢弃）。
3. `createIdea` / `updateIdea` 的现有签名与返回类型保持兼容；
   冲突错误类 `IdeaConflictError` 保留（API 层依赖 409 映射）。
4. 新增导出（供 API / 测试使用）：

```ts
/** 跨日报语义查重：返回与给定选题重复的历史选题 */
export async function findDuplicateIdeas(
  title: string,
  angle?: string | null,
  excludeId?: number
): Promise<IdeaRow[]>;

/** 语义去重后创建；重复时按 angle 差异决定跳过或保留 */
export async function createIdeaDeduplicated(
  value: IdeaWriteValues
): Promise<{ created: IdeaRow | null; duplicates: IdeaRow[]; reason?: string }>;
```

### 3.7 Agent B 交付物

- `lib/normalize.ts`（新增）
- `lib/dedup.ts`（新增）
- `lib/opportunity-draft.ts`（改造）
- `lib/ideas.ts`（改造）
- `tests/normalize.test.ts`（新增）
- `tests/dedup.test.ts`（新增）
- **测试必须包含**审计发现的 4 组真实重复商机 + 5 组真实重复选题，
  以及第 3.3 节列出的全部反例。

---

## 4. 异常处理规范（两个 Agent 共同遵守）

| 场景 | 约定 |
|---|---|
| 输入为 `null` / `undefined` | 返回空结果，**不抛错** |
| 输入为空字符串 | 返回空结果，**不抛错** |
| 输入含非法字符 | 归一化时剔除，**不抛错** |
| 历史集合为 `null` / 非数组 | 视为空数组，**不抛错** |
| 单条候选校验失败 | **跳过该条**并记录原因，不影响同批其他条目 |
| 阈值参数非法（越界/NaN） | 回退到默认值，**不抛错** |
| DB 读取失败 | 抛出原始错误，由上层处理（不吞异常） |

**原则**：解析/归一化/去重是纯函数层，永不因单条脏数据中断整批。

---

## 5. n8n 侧一致性要求（阶段 D，主控执行）

TS 侧与 n8n 侧的去重规则**必须一致**。方案选型结论：

| 方案 | 结论 |
|---|---|
| A：n8n 调 Web API | ❌ **不可行**。Next.js 只绑 `127.0.0.1`，容器内无 `host.docker.internal` 解析；放开监听违反项目红线（禁止改成公网监听） |
| B：Code 节点执行与 TS 一致的轻量归一化 | ✅ **采用**。n8n 容器可直接解析并访问 `n8n-radar-postgres`（192.168.164.2），已有 postgres 节点可用 |
| C：其他 | ❌ 不考虑 |

因此 `lib/normalize.ts` 的归一化规则必须是**纯字符串处理、无外部依赖**，
以便 Agent B 在交付后，由主控把同样的规则**逐条移植**到 n8n 的「商机清洗」「选题清洗」Code 节点中。

**接口要求补充（约束 Agent B）**：`lib/normalize.ts` 与 `lib/dedup.ts` **不得 import 任何 Node 内置模块或第三方库**，
只用纯 TypeScript 字符串/正则运算。这样主控可以逐函数等价移植到 n8n Code 节点。

---

## 6. 提交与验收要求

### 6.1 分支

| Agent | 分支 | Worktree |
|---|---|---|
| A | `feat/phase2-markdown-parser` | `../ai-intel-web-p2a` |
| B | `feat/phase2-semantic-dedup` | `../ai-intel-web-p2b` |

### 6.2 提交规范

- 每个 Agent 只提交自己负责的文件，**不得** `git add .`
- 提交信息格式：`feat(阶段2-A): <简述>` / `feat(阶段2-B): <简述>`
- 不得推送远端（本地仓库无远端）

### 6.3 验收门槛

| 项 | Agent A | Agent B |
|---|---|---|
| 自身新测试 | 全绿 | 全绿 |
| `npm test` 全量 | **不得使现有用例变红** | **不得使现有用例变红** |
| `npx tsc --noEmit` | 通过 | 通过 |
| 真实样本验证 | 11-05 + 11-06 两份日报均能解析出条目与子字段 | 真实重复数据能判重、反例不误判 |
| 代码规范 | 注释用中文，与现有文件风格一致 | 同左 |

> **Agent B 注意**：`tests/ideas.test.ts` 与 `tests/opportunity-draft.test.ts` 属主控。
> 若新行为使旧断言失效，**不得自行修改**这两个文件，须在提交说明中列出失效断言清单，由主控统一更新。

---

## 7. 阶段 D 中 Agent 产物的使用方式（主控）

| Agent 产物 | 主控在 n8n 侧的动作 |
|---|---|
| `lib/normalize.ts` 归一化规则 | 移植到「商机清洗」「选题清洗」Code 节点，在写库前做语义去重 |
| `lib/dedup.ts` 判定流程 | 移植到同上；n8n 侧需先 `SELECT` 历史标题集合再比对 |
| `lib/markdown-parser.ts` 字段别名表 | 用于「格式化数据」节点的结构校验（校验产物字段名是否在别名表内） |
| `lib/markdown-parser.ts` `diagnostics` | 用于「格式化数据」节点的校验失败原因补充 |

**n8n 侧去重的执行位置**：
- 「商机写入」现有 SQL 是 `WHERE NOT EXISTS (SELECT 1 FROM opportunities WHERE trim(title) = trim($1))` → 改为 Code 节点先查库 + 语义比对 + 输出「要插入 / 要更新」两类指令，postgres 节点按指令分支。
- 「选题写入」现有 SQL 是 `ON CONFLICT (report_date, title) DO UPDATE` → 改为同理，跨日报语义去重需先查全表。

---

## 8. 主控在阶段 D 额外要修的 P0（不在 Agent 范围内）

1. **发布 n8n 新版本**：当前 `activeVersionId` 指向 16 节点旧版，
   定时任务实际跑的是它 → 必须把含选题/商机分支 + 失败兜底的新版本发布为 published。
2. **模型确认**：按用户决策，最终用 **DeepSeek**；解析器兼容 MiniMax 格式作为保险。
3. **prompt 稳定化**：在 `Basic LLM Chain` 的 prompt 中补 few-shot 格式约束（冒号位置、编号列表、子字段），
   减少格式漂移。**不新增校验节点**（避免过度工程），校验由 `格式化数据` 节点现有的 validation 逻辑承担。
4. **发布后立即手动验证一次**，再等次日 08:30 观察 `scheduled_job.lastFiredAt`。
