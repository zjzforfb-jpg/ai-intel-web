# 阶段 3 · 阶段 B：接口契约

> 本文件是两个并行 Agent 的唯一依据。**契约未写明的内容不得自行发明**。
> 如需变更契约，先报告主控，由主控统一修改本文件后重新分发。

---

## 一、文件所有权（硬边界）

改动越界等于破坏并行开发，提交会被主控拒绝。

### 主控独占（两个 Agent 一律不得改）

```
package.json
migrations/**
components/Sidebar.tsx
components/MobileNav.tsx
components/TopBar.tsx
lib/db.ts
lib/db-write.ts
lib/normalize.ts
lib/dedup.ts
lib/markdown-parser.ts
app/layout.tsx
docs/**
scripts/**
```

### Agent A 独占（实体追踪）

```
lib/entities.ts                 实体数据访问层（读）
lib/entities-write.ts           实体写入层（写，upsert 幂等）
lib/entities-extract.ts         实体抽取（纯函数，无 IO）
app/api/entities/route.ts       列表 API
app/api/entities/[id]/route.ts  详情 API
app/entities/page.tsx           实体列表页
app/entities/[id]/page.tsx      实体详情页
components/entities/**          实体模块私有组件
tests/entities.test.ts          测试（主控集成时加进 package.json）
```

### Agent B 独占（内容生产）

```
lib/content-projects.ts             内容项目读
lib/content-projects-write.ts       内容项目写
lib/content-plan.ts                 策划生成（纯函数，无 IO）
lib/content-export.ts               导出 production_input.json（纯函数）
lib/content-import.ts               回读脚本/分镜结果（纯函数）
app/api/content-projects/route.ts
app/api/content-projects/[id]/route.ts
app/api/content-projects/[id]/export/route.ts
app/content/page.tsx
app/content/[id]/page.tsx
components/content/**
tests/content-projects.test.ts
```

---

## 二、数据库结构（由主控建表，Agent 只读表结构、不得改 DDL）

### 2.1 `entities`

```sql
CREATE TABLE entities (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,                 -- 展示名（canonical，如 "OpenAI"）
  normalized_name TEXT NOT NULL,                 -- 归一化名（小写去空格标点，用于查重）
  entity_type     TEXT NOT NULL,                 -- 见下方枚举
  aliases         TEXT[] NOT NULL DEFAULT '{}',  -- 别名数组，小写
  description     TEXT,                          -- 人工可编辑；自动流程永不覆盖
  website         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (normalized_name)                       -- 同一归一化名只能有一个实体
);
```

`entity_type` 枚举（`CHECK` 约束）：

```
'company' | 'person' | 'ai_product' | 'technology' | 'open_source' | 'organization' | 'unknown'
```

> `unknown` 用于「识别到但类型待确认」，对应任务书「不能确定类型时标记待确认」。

### 2.2 `entity_mentions`

```sql
CREATE TABLE entity_mentions (
  id               BIGSERIAL PRIMARY KEY,
  entity_id        BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  report_id        BIGINT,                       -- 软引用 daily_reports.id，不加 FK
  mention_date     DATE NOT NULL,                -- 冗余自日报，便于按日期聚合
  source_title     TEXT,                         -- 头条标题
  source_url       TEXT,                         -- 头条原文链接
  context          TEXT,                         -- 实体所在原文片段（≤200 字）
  importance_score SMALLINT NOT NULL DEFAULT 5 CHECK (importance_score BETWEEN 1 AND 10),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, report_id)                  -- 幂等键：一篇日报里一个实体只有一条提及
);
```

> 幂等键**不含** `source_title`。日报重跑会重写标题，含标题会导致提及累积（已实测）。
> 建表见 `migrations/006_entities.sql` + `migrations/008_entity_mentions_dedup_key.sql`。

**没有 `sentiment` 字段**：现有日报数据不含情感极性，凭空造一个字段等于编造数据（阶段 A 已核实）。

索引：
```sql
CREATE INDEX idx_entity_mentions_entity_date ON entity_mentions (entity_id, mention_date DESC);
CREATE INDEX idx_entity_mentions_date        ON entity_mentions (mention_date DESC);
CREATE INDEX idx_entities_type               ON entities (entity_type);
```

「删除实体时考虑关联提及」→ `ON DELETE CASCADE`，删实体连带删提及。

### 2.3 `content_projects`

```sql
CREATE TABLE content_projects (
  id                 BIGSERIAL PRIMARY KEY,
  title              TEXT NOT NULL,
  source_idea_id     BIGINT,                     -- 软引用 topic_ideas.id
  source_report_date DATE,                       -- 软引用 daily_reports.report_date
  content_type       TEXT NOT NULL,              -- 见枚举
  target_audience    TEXT,
  status             TEXT NOT NULL DEFAULT '草稿',
  content_angle      TEXT,                       -- 切入角度
  hook               TEXT,                       -- 开头钩子
  key_points         JSONB NOT NULL DEFAULT '[]',-- 核心观点，字符串数组
  reference_materials JSONB NOT NULL DEFAULT '[]',-- [{title,url,note}]
  production_notes   TEXT,
  duration_seconds   INTEGER,                    -- 建议时长
  video_form         TEXT,                       -- 视频形式
  open_questions     JSONB NOT NULL DEFAULT '[]',-- 待核实信息
  -- 生产回传
  production_status  TEXT NOT NULL DEFAULT '未导出',
  exported_at        TIMESTAMPTZ,
  export_path        TEXT,
  script_result      JSONB,                      -- 脚本结果
  storyboard_result  JSONB,                      -- 分镜结果
  quality_check      JSONB,                      -- 质检结果
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`content_type` 枚举：
```
'ai_news' | 'ai_product' | 'ai_tutorial' | 'tech_trend' | 'biz_opportunity' | 'story_case'
```

`status` 枚举（项目阶段）：
```
'草稿' | '策划中' | '待生产' | '已导出' | '已回传' | '已完成' | '已放弃'
```

`production_status` 枚举（与用户生产系统的对接状态）：
```
'未导出' | '已导出待生产' | '已导入脚本' | '已出分镜' | '已完成'
```

索引：
```sql
CREATE INDEX idx_content_projects_status     ON content_projects (status);
CREATE INDEX idx_content_projects_source_idea ON content_projects (source_idea_id);
CREATE UNIQUE INDEX uq_content_projects_idea ON content_projects (source_idea_id)
  WHERE source_idea_id IS NOT NULL;   -- 一条选题只允许建一个内容项目
```

> 唯一索引带 `WHERE`：允许多个 `source_idea_id IS NULL` 的手工项目存在。

### 2.4 实体与内容项目如何关联

**两层，都不加硬外键**（遵循项目「不触碰既有表」的既有约定）：

1. **直接层**：`content_projects.source_idea_id → topic_ideas.id`，页面可联查选题原文。
2. **间接层**：`topic_ideas.report_date → daily_reports.report_date → entity_mentions.report_id`。
   实体详情页的「关联选题」用这条链路：
   ```sql
   SELECT DISTINCT t.* FROM topic_ideas t
   JOIN entity_mentions m ON m.mention_date = t.report_date
   WHERE m.entity_id = $1
   ```
   「关联商机」同理，把 `topic_ideas` 换成 `opportunities`、用 `source_report_date`。

---

## 三、实体抽取契约（Agent A 实现，主控在 n8n 侧复用同一份纯函数逻辑）

### 3.1 输入

```ts
interface ExtractInput {
  reportDate: string;        // "YYYY-MM-DD"
  reportMarkdown: string;
}
```

### 3.2 输出

```ts
interface ExtractedMention {
  canonical: string;         // "OpenAI"
  normalizedName: string;    // "openai"
  entityType: EntityType;
  aliases: string[];         // 命中的别名（小写）
  reportDate: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  context: string;           // ≤200 字，实体所在原文
  importanceScore: number;   // 1..10
}
```

### 3.3 规则（必须逐条实现，可测试）

1. **数据源**：只从 `reportMarkdown` 抽取，**不调用任何 LLM**，不引入外部数据。
2. **实体来源**：以受控词典 `ENTITY_VARIANTS`（`lib/normalize.ts`，34 条）为基准，匹配 `canonical` 与全部 `variants`（大小写不敏感）。
3. **来源证据**：每个 mention 必须能定位到**具体头条**。定位不到头条的匹配丢弃，不生成 mention。
   **粒度（已按实测修正）**：一篇日报里**一个实体只产出一条 mention**，即使它出现在多个头条中。
   来源头条优先选「实体出现在标题里」的那条（信号最强），否则取第一条包含它的。
   `source_title` / `source_url` / `context` 保留用于展示，但**不参与唯一性判断**。
   > 修正原因：日报重跑时 LLM 会重写标题，若把 `source_title` 纳入唯一键，
   > 同一实体在同一篇日报的提及会不断累积（实测 8 → 17 条），违反幂等要求。
   > `importance_score` 按实体整体计算，不按头条分别算。
4. **`context`**：取实体所在那一行原文，去除 markdown 标记后截断 200 字。
5. **`source_url`**：从该头条的「原文链接」字段取；取不到则 `null`，**不得编造**。
6. **`importance_score`**（启发式，可测试）：
   - 出现在「二、今日必读头条」标题中：+4
   - 出现在「一、今日核心判断」中：+3
   - 出现次数 ≥3：+2，≥6：再 +1
   - 基础分 1，上限 10
7. **类型映射**：由主控在 migration 后提供的 `ENTITY_TYPE_MAP`（见 §3.4）决定；词典里没有的落 `'unknown'`。
8. **纯函数**：`lib/entities-extract.ts` 不得 import `pg`、不得读文件、不得发网络请求。同样输入必须同样输出。

### 3.4 实体类型映射表（主控提供，Agent A 直接引用）

| canonical | type |
|-----------|------|
| openai, anthropic, google, nvidia, facebook, microsoft, amazon, apple, deepseek, github, hugging face | `company` |
| gpt, gemini, cosmos 3, claude code, codex, copilot, cursor, sora, midjourney, perplexity, openrouter, qwen, llama, rivet | `ai_product` |
| mcp, langchain, kubernetes, postgres, redis, docker, pii, 编程agent | `technology` |
| aws | `organization` |

> 词典里若有未列出的 canonical，一律 `unknown`，不猜测。

### 3.5 幂等要求

同一 `(entity_id, report_id, source_title)` 只允许一行。
写入必须用：

```sql
INSERT INTO entity_mentions (...) VALUES (...)
ON CONFLICT (entity_id, report_id, source_title) DO UPDATE SET
  context = EXCLUDED.context,
  importance_score = GREATEST(entity_mentions.importance_score, EXCLUDED.importance_score)
```

实体本身：

```sql
INSERT INTO entities (name, normalized_name, entity_type, aliases)
VALUES (...)
ON CONFLICT (normalized_name) DO UPDATE SET
  updated_at = NOW()
  -- 绝不覆盖 description / website（人工字段）
RETURNING id
```

---

## 四、实体 API 契约

### `GET /api/entities`

| 参数 | 类型 | 说明 |
|------|------|------|
| `q` | string | 搜索：匹配 `name` / `aliases`（ILIKE） |
| `type` | string | 类型筛选，逗号分隔多选 |
| `days` | number | 热度窗口，默认 7，可选 7 / 30 |
| `page` | number | 默认 1 |
| `size` | number | 默认 20，上限 100 |

响应：

```jsonc
{
  "items": [{
    "id": 1, "name": "OpenAI", "entityType": "company",
    "mentionCount": 12, "recent7d": 4, "recent30d": 9,
    "firstMentionDate": "2026-11-05", "lastMentionDate": "2026-11-06"
  }],
  "total": 34, "page": 1, "size": 20
}
```

### `GET /api/entities/[id]`

```jsonc
{
  "entity": { "id": 1, "name": "OpenAI", "entityType": "company",
              "aliases": ["openai"], "description": null, "website": null },
  "stats": { "mentionCount": 12, "recent7d": 4, "recent30d": 9,
             "firstMentionDate": "...", "lastMentionDate": "...",
             "dataSufficient": true },   // 提及 < 3 次或 < 2 天 → false
  "mentions": [{ "id": 9, "mentionDate": "2026-11-06", "sourceTitle": "...",
                 "sourceUrl": "...", "context": "...", "importanceScore": 8,
                 "reportDate": "2026-11-06" }],
  "relatedIdeas": [{ "id": 21, "title": "...", "reportDate": "..." }],
  "relatedOpportunities": [{ "id": 42, "title": "...", "sourceReportDate": "..." }]
}
```

**`dataSufficient` 规则（硬性）**：
`mentionCount >= 3 && distinctMentionDays >= 2` 才为 `true`。
为 `false` 时页面**必须**显示「数据不足，暂不构成趋势」，不得输出趋势结论。

---

## 五、内容项目 API 契约

### `POST /api/content-projects`（从选题创建）

```jsonc
// 请求
{ "topicIdeaId": 21, "contentType": "ai_news", "targetAudience": "AI 从业者" }
// 响应 201
{ "id": 1, "title": "...", "status": "草稿" }
```

规则：
- 先查 `topic_ideas`，不存在返回 404。
- 已有同 `source_idea_id` 的项目 → 409，返回既有 `id`（不重复创建）。
- 标题默认取 `topic_ideas.title`，可后续编辑。
- **不修改 `topic_ideas` 任何字段**。

### `GET /api/content-projects` / `GET /api/content-projects/[id]`

列表支持 `status` 筛选与分页；详情返回项目全字段 + 来源选题原文 + 来源日报链接。

### `PATCH /api/content-projects/[id]`

只允许改：`title`、`target_audience`、`content_angle`、`hook`、`key_points`、`reference_materials`、`production_notes`、`duration_seconds`、`video_form`、`open_questions`、`status`、`content_type`。
不允许改 `source_idea_id` / `source_report_date`（来源不可篡改）。

### `GET /api/content-projects/[id]/export`

返回 `production_input.json` 并置 `production_status='已导出待生产'`、`exported_at=NOW()`、`status='已导出'`。

```jsonc
{
  "schema_version": "1.0",
  "generator": "ai-intel-web/phase3",
  "project_id": 1,
  "title": "Claude Code 被指泄露邮箱",
  "content_type": "ai_news",
  "target_audience": "AI 从业者",
  "duration_seconds": 60,
  "video_form": "口播 + 图文",
  "hook": "...",
  "content_angle": "...",
  "key_points": ["..."],
  "reference_materials": [{ "title": "...", "url": "...", "note": "..." }],
  "source_reports": [{ "report_date": "2026-11-06", "title": "...", "url": "/report/2026-11-06" }],
  "source_ideas": [{ "id": 21, "title": "...", "angle": "...", "value_score": 8 }],
  "production_requirements": {
    "aspect_ratio": "16:9",
    "language": "zh-CN",
    "must_cite_sources": true,
    "no_fabrication": true,
    "open_questions": ["..."]
  },
  "target_pipeline": {
    "system": "AI_DIRECTOR_PROJECT",
    "entry_dir": "00_source",
    "state_file": "project_state.json",
    "read_back": ["05_storyboards/storyboard.md", "project_state.json"]
  }
}
```

### `POST /api/content-projects/[id]/import`

回读用户生产系统的产物，写入 `script_result` / `storyboard_result` / `production_status`。

```jsonc
{ "scriptResult": {...}, "storyboardResult": {...}, "qualityCheck": {...}, "productionStatus": "已出分镜" }
```

---

## 六、UI 契约

### 实体页

- 列表：表格/卡片，列＝名称、类型、总提及、近 7 天、最近出现日期。点击进详情。
- 筛选：类型多选 + 搜索框 + 7/30 天切换。
- 详情：统计卡 4 个 + 提及时间线 + 关联选题 + 关联商机。
- 数据不足时统计卡位置显示「数据不足，暂不构成趋势」。
- 空状态：无实体时明确提示「尚未抽取到实体」，不显示假数据。

### 内容中心

- 列表：项目卡片（标题、类型、状态、来源选题、更新时间）。
- 从选题创建：在选题列表/详情加「创建内容项目」入口（Agent B 只加按钮组件，挂载由主控做，避免改公共页面）。
- 详情：左侧策划表单（可编辑保存），右侧原始情报来源（选题原文、日报链接、参考素材）。
- 导出区：显示「导出 production_input.json」按钮 + 下载/复制，导出后显示文件保存路径说明与导入步骤。
- 状态区：`production_status` 时间线。

---

## 七、错误处理约定

| 场景 | 行为 |
|------|------|
| 数据库未授权 / 表不存在 | 捕获后返回可读空状态，不白屏（沿用 `DbErrorState`） |
| 实体抽取失败 | 记录日志，返回空数组，**不抛异常中断日报写入** |
| 来源链接缺失 | 字段为 `null`，UI 显示「无来源链接」，不编造 |
| 统计样本不足 | `dataSufficient=false`，UI 显示数据不足 |
| 选题不存在 | API 404，UI 提示「选题不存在或已删除」 |

---

## 八、测试要求（最低覆盖）

### Agent A（`tests/entities.test.ts`）

1. 同一实体多种别名 → 归一到同一个 `normalized_name`，只建一条实体
2. 同一实体跨两篇日报 → 两个 mention，统计正确累加
3. 同一日报重复执行 → mention 数量不变（幂等）
4. 名称相近的不同实体（如 `claude code` vs `codex`）→ 不合并
5. 类型不同 → 类型正确落库
6. 无法识别实体（词典外）→ 不产生 mention
7. 来源缺失 → `source_url` 为 null，不编造
8. 统计日期边界 → 7 天/30 天窗口开闭区间正确（含当天、不含第 8 天）
9. `dataSufficient` 规则：2 次提及 → false；3 次但同一天 → false；3 次跨 2 天 → true
10. 抽取纯函数：同输入两次调用结果深度相等

### Agent B（`tests/content-projects.test.ts`）

1. 从选题创建 → 项目存在且 `source_idea_id` 正确
2. 同选题重复创建 → 返回既有 id，不新增行
3. 编辑策划 → 写入成功，`topic_ideas` 未被改动
4. 导出 → JSON 字段齐全（对照 §5 清单），`schema_version` 为 `1.0`
5. 导出 → 状态流转 `草稿 → 已导出`
6. 回读 → `script_result` / `production_status` 正确写入
7. 来源不可篡改 → PATCH `source_idea_id` 被忽略或 400
8. 选题不存在 → 404

---

## 九、Git 规则

- Agent A：分支 `feat/phase3-entity-tracking`，目录 `../ai-intel-web-p3a`
- Agent B：分支 `feat/phase3-content-pipeline`，目录 `../ai-intel-web-p3b`
- 都从 `main` 的 `e3d5e1a` 创建
- 各自独立提交，提交信息前缀 `feat(阶段3-A):` / `feat(阶段3-B):`
- 不得 `git push`、不得 merge 到 main（由主控集成）
