# n8n 集成：日报之后自动追加「候选商机分析」分支

> 目标：在每日日报工作流（**ZtIAVVtWmcPLXywX**）成功落库后，自动用 LLM 从当日日报正文中提取 0-3 条候选商机，防重复写入 `opportunities` 表，状态固定「待研究」。
>
> 实施人：主 Agent（本文件为实施方案说明）。红线：不改既有日报主流程的任何节点，只做**追加**；失败不阻断主流程。

## 1. 总体结构

```
[既有：日报写入 PostgreSQL 节点（daily_reports 落库）]
        │ (成功输出)
        ▼
[Code: 取日报正文] → [LLM: 候选商机分析] → [Code: 清洗 JSON] → [PostgreSQL: 防重复写入 opportunities]
```

- 分支起点：从日报写入节点（即写 `daily_reports` 的 PostgreSQL 节点）的成功输出引一条新连线到「取日报正文」Code 节点。**不要**动该节点原有的下游连线。
- 分支内任一节点失败都不应影响主流程：给「候选商机分析」LLM 节点、「清洗 JSON」Code 节点、「防重复写入」PostgreSQL 节点统一设置 **Settings → onError: `continueRegularOutput`**（n8n 界面显示为 `Continue (using regular output)`）。这样失败时输出空项，后续节点自然空转结束。
- 「防重复写入」节点执行**单条 INSERT**；LLM 输出多条时由 n8n 按 item 自动循环（Code 清洗节点把 JSON 数组拆成多个 item 即可）。

## 2. 节点一：Code —— 取日报正文

拿到当日日报正文与日期，传给下游。假设日报写入节点输出包含 `report_date` 与 `report_markdown`（字段名以实际工作流为准，主 Agent 实施时核对）：

```javascript
return [{
  json: {
    report_date: $json.report_date,          // YYYY-MM-DD
    report_markdown: $json.report_markdown,  // 当日日报正文
  },
}];
```

若正文过长（超过约 8000 字），可在此截断：LLM 分析商机只关心事实与动态，截断策略取**前 8000 字**（日报头条通常在前面）即可。

## 3. 节点二：LLM —— 候选商机分析

任一可用 Chat Model 节点（与工作流中现有 LLM 节点用同一凭据即可）。System/User prompt 如下（**整段替换为 User Message 亦可**）：

```
你是商业机会分析师。下面是一份 AI 领域日报的正文。请从中提取值得记录的「商业机会」候选。

要求：
1. 只提取有事实支撑、且对个人创作者/小团队有可操作性的机会，宁缺毋滥；没有值得记录的商机时输出空数组 []。
2. 最多输出 3 条。
3. 每条包含四个字段：
   - title：商机标题，一句话，简洁明确（如「用 Sora 为中小商家批量制作产品广告片」）
   - description：1-3 句话说明这个机会是什么、怎么做
   - category：分类，从「内容创业 / 工具服务 / 自动化外包 / 知识付费 / 其他」中选择，也可以自拟不超过 10 字的分类
   - rationale：判断依据，必须引用日报正文中的具体事实（原文中的公司动作、产品发布、数据、政策变化等），不允许凭空推断
4. 只输出 JSON 数组，不要任何解释、不要 markdown 代码围栏（```）。

日报正文：
{{ $json.report_markdown }}
```

要点：
- 输出 JSON 数组（0-3 个元素），字段 `title / description / category / rationale`，与 `lib/opportunity-draft.ts` 的 `OpportunityCandidate` 一致。
- `rationale` 必须引用日报中的具体事实——这是「宁缺毋滥」的硬约束，prompt 中已强调。

## 4. 节点三：Code —— 清洗 JSON

**LLM 输出可能带 markdown 围栏（```json ... ```）或前后解释文字**，此节点负责剥离并解析，再把数组拆成多个 item：

```javascript
const raw = $json.text ?? $json.output ?? $json.content ?? "";
// 剥离 markdown 围栏与首尾杂文
let s = String(raw).trim();
const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
if (fence) s = fence[1].trim();
const start = s.indexOf("[");
const end = s.lastIndexOf("]");
if (start === -1 || end === -1 || end <= start) return []; // 解析不出数组：本日无候选，空转结束
s = s.slice(start, end + 1);

let arr;
try {
  arr = JSON.parse(s);
} catch (e) {
  return []; // JSON 不合法：放弃本批，不阻断流程
}
if (!Array.isArray(arr)) return [];

const date = $("取日报正文").first().json.report_date;
return arr
  .filter((x) => x && typeof x.title === "string" && typeof x.description === "string")
  .map((x) => ({
    json: {
      report_date: date,
      title: x.title,
      description: x.description,
      category: typeof x.category === "string" ? x.category : null,
      rationale: typeof x.rationale === "string" ? x.rationale : null,
    },
  }));
```

说明：`$("取日报正文")` 引用前一个 Code 节点名称，需与实际节点名一致。

## 5. 节点四：PostgreSQL —— 防重复写入

- 连接：与日报主流程相同的 PostgreSQL 凭据（能写 `opportunities` 的账号）。
- Operation: Execute Query，**Always With Data Set to "Execute Once" 必须关闭**（要逐 item 执行）。
- Query（`$1..$5` 依次绑定 `title / description / category / report_date / notes`，在 n8n 中用查询参数面板填 `{{ $json.title }}` 等）：

```sql
INSERT INTO opportunities (title, description, category, source_report_date, status, notes)
SELECT $1, $2, $3, $4::date, '待研究', $5
WHERE NOT EXISTS (SELECT 1 FROM opportunities WHERE trim(title) = trim($1))
```

### 为什么用 `INSERT ... SELECT ... WHERE NOT EXISTS` 而不是 UPSERT（`ON CONFLICT`）

1. `opportunities.title` **没有唯一约束/唯一索引**（002 迁移有意不加，标题非业务键），`ON CONFLICT (title)` 无从生效；加唯一索引属于 DDL，不在本阶段授权范围。
2. `WHERE NOT EXISTS` 与应用侧 `lib/opportunity-draft.ts` 的去重语义**完全一致**：全表按 `trim(title)` 精确匹配、不分日期。两侧共用一套规则，行为可预期。
3. 竞态窗口在此场景可忽略（每日一次、单人使用），且应用侧同批内已先去重。

### notes 的拼接（与 TS 侧 `formatDraftNotes` 一致）

第 5 个参数（notes）在 n8n 中用表达式拼接：

```
{{ $json.rationale ? '判断依据：' + $json.rationale + '（来源日报 ' + $json.report_date + '）' : '来源日报 ' + $json.report_date }}
```

- 有判断依据：`判断依据：{rationale}（来源日报 YYYY-MM-DD）`
- 无判断依据：`来源日报 YYYY-MM-DD`

页面对该格式有识别逻辑（`isDraftNotes`），会显示「AI 草稿」徽章并把该字段标注为「判断依据」。请勿改变格式。

## 6. 去重规则（两侧一致，便于后续维护）

- 范围：**全表、不分日期**。同一个标题无论哪天的日报产出，只保留最早一条。
- 匹配：`trim(title) = trim($1)` 精确匹配，大小写敏感。理由：标题以中文为主，大小写变体极少；保持 SQL 与 TS 两侧语义一致比单边更稳妥。
- 同一批候选内部由 LLM 产出去重兜底（TS 侧 `draftOpportunities` 还有同批内去重；n8n 分支逐 item 写入，依赖 `NOT EXISTS` 即可）。

## 7. 验收清单

- [ ] 主流程（日报落库、通知等）不受影响：分支节点全部 `onError: continueRegularOutput`
- [ ] LLM 输出空数组 `[]` 时：清洗节点返回 0 item，PostgreSQL 节点不执行，流程正常结束
- [ ] 手动重复执行两次工作流：第二次 `opportunities` 不新增行（防重复生效）
- [ ] 写入的行：`status='待研究'`、`source_report_date` 为当日、notes 含「判断依据：」与「来源日报 YYYY-MM-DD」
- [ ] Web 页面 `/opportunities` 列表出现「AI 草稿」徽章，详情页显示「判断依据（AI 草稿）」区块与来源日报链接
