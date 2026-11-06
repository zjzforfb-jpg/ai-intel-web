# 阶段 1：日报选题自动提取 —— n8n 集成文档

> 实施人：主 Agent（本文档由选题提取模块 Agent A 编写，主 Agent 据此在 n8n 中实施）
> 涉及工作流：**Daily Report**（ID：`ZtIAVVtWmcPLXywX`）
> 前置：`migrations/005_topic_ideas.sql` 已执行，`topic_ideas` 表与三账号权限已就绪

## 1. 功能概述

在现有日报流程成功落库（daily_reports INSERT）之后，追加一个「选题提取」分支：

1. 把当日日报正文喂给 LLM，提取 3-5 条短视频选题；
2. 用 PostgreSQL 节点把选题 UPSERT 进 `topic_ideas` 表；
3. **该分支失败不得阻断日报主流程**（continueOnFail / 错误分支直接跳过，不落 report_failures）。

## 2. 节点与连接关系

```
（现有）日报落库 PostgreSQL 节点
        │  [成功输出 main]
        ▼
┌─────────────────────────────┐
│ 选题提取 · Basic LLM Chain   │   ← 新节点 A（LLM）
└─────────────────────────────┘
        │  main
        ▼
┌─────────────────────────────┐
│ 选题写入 · PostgreSQL        │   ← 新节点 B（写 topic_ideas）
└─────────────────────────────┘
```

- 在「日报落库」节点（成功写入 daily_reports 的那个 PostgreSQL 节点）**之后**并联两条输出：
  - 原有主线保持不变（通知等）；
  - 新增一条 main 连接 → LLM 节点 → PostgreSQL 写入节点。
- **失败不阻断主流程**：给「选题提取 · Basic LLM Chain」和「选题写入 · PostgreSQL」两个节点都开启
  **Settings → On Error → Continue (using error output)**（或至少 Continue Regular Output）。
  这样任一环节报错只跳过选题分支，日报主线照常走完。**不要**为该分支写 report_failures。

## 3. 节点 A：选题提取（Basic LLM Chain）

- 节点类型：Basic LLM Chain（Chain LLM）
- 输入：当日日报正文。引用方式与工作流内其他节点一致，例如
  `{{ $json.report_markdown }}`（日报落库节点 RETURNING 的正文列）。

### Prompt（System / 用户消息均可，整段填入）

```
你是资深短视频策划。下面是今天的 AI 领域日报正文。请从中提炼 3-5 条最有潜力做成短视频的选题。

要求：
1. 选题必须来自日报中真实出现的内容，禁止编造；
2. title：短视频标题钩子，15-30 字，口语化、有钩子感（悬念/反差/利益点），不要写成正文中性标题；
3. angle：切入角度，一句话说明从什么视角讲（如反常识、省钱攻略、实测对比、行业内幕）；
4. source_material：素材来源，注明日报中对应的哪条/哪些文章及其链接，多条用「；」分隔；
5. reference_visuals：参考画面，1-2 句建议的开场画面/镜头描述；
6. value_score：选题价值评分，1-10 整数（10 = 强烈建议优先做）；
7. 只输出一个 JSON 数组，3-5 个元素，每个元素形如：
   {"title":"...","angle":"...","source_material":"...","reference_visuals":"...","value_score":8}
8. 输出必须是纯 JSON，不要 markdown 代码围栏（不要 ```json），不要任何解释文字。

日报正文：
{{ $json.report_markdown }}
```

### 输出格式处理（如 LLM 节点支持结构化输出）

- 若使用支持 JSON Schema 的模型/节点，直接按上面的对象结构定义数组 schema；
- 若是纯文本输出，建议在 LLM 节点后加一个 **Code 节点**做容错解析：
  去掉可能的 ```json 围栏 → `JSON.parse` → 失败则返回空数组（配合 continueOnFail 跳过后续写入）。

```javascript
// Code 节点示例（Mode: Run Once for All Items）
const raw = $json.text ?? $json.output ?? "";
const cleaned = String(raw).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
let ideas = [];
try {
  const parsed = JSON.parse(cleaned);
  if (Array.isArray(parsed)) ideas = parsed;
} catch (e) {
  // 解析失败：返回空数组，后续写入节点自然跳过
}
return ideas
  .filter((i) => i && typeof i.title === "string" && i.title.trim())
  .slice(0, 5)
  .map((i) => ({ json: { idea: i } }));
```

## 4. 节点 B：选题写入（PostgreSQL）

- 节点类型：PostgreSQL
- **凭据：必须使用 writer 账号**（`ai_intel_writer`，密码来自 `.env.local` 的 `DB_WRITE_PASSWORD`，
  在 n8n 凭据管理中新建/复用 writer 凭据；不要用 reader —— reader 无写权限）。
- Operation：Execute Query，**Run Once for Each Item**（LLM/Code 节点输出逐条选题）。

### SQL（UPSERT，幂等）

```sql
INSERT INTO topic_ideas
  (report_date, title, angle, source_material, reference_visuals, value_score, status)
VALUES
  (
    '{{ $('日报落库节点名').item.json.report_date }}',   -- 当日日报日期，YYYY-MM-DD
    '{{ $json.idea.title }}',
    {{ JSON.stringify($json.idea.angle || null) }},
    {{ JSON.stringify($json.idea.source_material || null) }},
    {{ JSON.stringify($json.idea.reference_visuals || null) }},
    {{ $json.idea.value_score ?? 'NULL' }},
    '待制作'
  )
ON CONFLICT (report_date, title) DO UPDATE SET
  angle             = EXCLUDED.angle,
  source_material   = EXCLUDED.source_material,
  reference_visuals = EXCLUDED.reference_visuals,
  value_score       = EXCLUDED.value_score,
  updated_at        = NOW();
```

要点：

- **唯一约束**：`UNIQUE (report_date, title)` —— 同一天重跑工作流、或 LLM 输出重复标题时，
  UPSERT 只会更新内容而不会插重，`status` 保持人工设置的状态不被覆盖（DO UPDATE 里**不含 status**）。
- `report_date` 必须取日报落库节点 RETURNING 的 `report_date`（替换 `日报落库节点名` 为实际节点名）。
- `value_score` 若 LLM 漏给或非数字，落 NULL（表上 CHECK 约束只拦 1-10 之外的明确数字）。
  如担心 LLM 输出越界，可在 Code 节点里做 `Math.min(10, Math.max(1, Math.round(n)))` 钳制。
- `angle/source_material/reference_visuals` 用 `JSON.stringify` 注入，保证文本中的引号、换行被安全转义。

## 5. 验收清单

1. 手动执行 Daily Report 工作流（或等次日 08:30 自动跑），确认：
   - 日报主流程行为与之前完全一致（不受新分支影响）；
   - `topic_ideas` 出现当日 3-5 行，`status = '待制作'`；
2. 断开 LLM 模型凭据再跑一次，确认主流程仍成功（选题分支静默跳过）；
3. 同日重跑一次，确认选题行数不变、内容被更新（UPSERT 生效）；
4. Web 端 `http://127.0.0.1:3000/ideas` 能看到按日期分组的选题，状态筛选可用。

## 6. 红线提醒

- 本分支只对 `topic_ideas` 做写操作；**不得**改 daily_reports 及其他任何表；
- 不修改工作流中既有的其他节点（只新增节点与连接）；
- writer 凭据只在 n8n 凭据管理中配置，不写入工作流 JSON 或代码仓库。
