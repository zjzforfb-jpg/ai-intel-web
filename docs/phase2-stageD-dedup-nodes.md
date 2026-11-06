# 阶段 D · n8n 去重链路施工代码模板

> ⚠️ 本文档中的 `normalizeText` / `normalizeTitle` / `extractEntities` / `extractKeywords` /
> `extractTopics` / `isDuplicate` 六个函数是**占位实现**（简化版）。
> Agent B 交付 `lib/normalize.ts` + `lib/dedup.ts` 后，需**用 Agent B 的真实实现整体替换**，
> 保证 TS 侧与 n8n 侧行为一致。
>
> 阶段 D 施工时的替换原则：**逐函数对照移植，不做"等价改写"** ——
> 任何行为差异都会导致两边去重结果不一致，比不做去重更糟。

---

## 1. 商机去重链路

### 1.1 新增节点「商机查库」

**类型**：`n8n-nodes-base.postgres`
**operation**：`executeQuery`
**query**：

```sql
SELECT id::int AS id,
       title,
       description,
       category,
       source_report_date::text AS source_report_date,
       status,
       notes,
       action_plan
FROM public.opportunities
ORDER BY id DESC;
```

**queryReplacement**：`={{ [ $json.report_date ] }}`（占位，实际不需要参数）

### 1.2 新增节点「商机去重」

**类型**：`n8n-nodes-base.code`
**jsCode**：

```javascript
// 商机语义去重（与 TS 侧 lib/dedup.ts 保持一致）
// ⚠️ 以下六个函数需从 Agent B 的 lib/normalize.ts + lib/dedup.ts 原样移植

const DEDUP_OPTIONS = {
  keywordThreshold: 0.55,
  topicThreshold: 0.6,
  entityRelaxFactor: 0.7,
  requireEntity: false,
};

/* ===== 以下为占位实现，阶段 D 必须替换为 Agent B 的真实版本 ===== */
function normalizeText(input) { /* ... */ }
function normalizeTitle(title) { /* ... */ }
function extractEntities(text) { /* ... */ }
function extractKeywords(text) { /* ... */ }
function extractTopics(text) { /* ... */ }
function isDuplicate(candidate, history, options) { /* ... */ }
/* ===== 占位实现结束 ===== */

// AI 草稿 notes 识别（与 TS 侧 isDraftNotes 一致）
function isDraftNotes(notes) {
  if (!notes) return false;
  return notes.startsWith("判断依据：") || /^来源日报 \d{4}-\d{2}-\d{2}$/.test(notes.trim());
}

const rows = $input.all().map((i) => i.json);
const history = rows.map((r) => ({
  id: r.id,
  title: r.title,
  description: r.description,
}));

const candidates = $("商机清洗").all().map((i) => i.json);

const out = [];
const skipped = [];

for (const c of candidates) {
  const res = isDuplicate(
    { title: c.title, description: c.description },
    history,
    DEDUP_OPTIONS
  );

  if (!res.duplicate) {
    out.push({ json: { ...c, _action: "insert" } });
    continue;
  }

  // 判定为重复：与最完整的历史记录比对
  const matched = history.find((h) => h.id === res.match?.id);
  const currentDescLen = (c.description || "").length;
  const matchedDescLen = (matched?.description || "").length;

  // 历史记录是 AI 草稿（notes 是自动生成格式）才允许更新，人工改过的不动
  const historyIsDraft = matched ? isDraftNotes(matched.notes) : false;

  if (matched && currentDescLen > matchedDescLen && historyIsDraft) {
    // 新候选更完整 → 更新历史记录（合并，不丢弃）
    out.push({
      json: {
        ...c,
        _action: "update",
        _target_id: matched.id,
        _merged_notes:
          matched.notes + "\n【合并自自动草稿】" + (c.rationale || c.description || ""),
      },
    });
  } else {
    skipped.push({
      title: c.title,
      reason: "语义重复：" + res.explanation,
    });
  }
}

return out.length > 0 ? out : [{ json: { _skipped: JSON.stringify(skipped) } }];
```

> ⚠️ **关键约束**：`update` 分支的 SQL 里**不能出现** `action_plan` 和 `status` 两列 ——
> 人工可能已推进状态或填写了行动计划，自动流程不得覆盖。

### 1.3 改造「商机写入」节点

**方案**：拆成两个 postgres 节点，用 If 分支区分 `insert` / `update`。

**节点 A「商机插入」**（`n8n-nodes-base.postgres`）：

```sql
INSERT INTO public.opportunities (title, description, category, source_report_date, status, notes)
VALUES ($1, $2, $3, $4::date, '待研究', $5)
```

queryReplacement：
```javascript
={{ [
  $json.title,
  $json.description,
  $json.category,
  $json.report_date,
  $json.rationale ? '判断依据：' + $json.rationale + '（来源日报 ' + $json.report_date + '）' : '来源日报 ' + $json.report_date
] }}
```

**节点 B「商机更新」**（`n8n-nodes-base.postgres`）：

```sql
UPDATE public.opportunities
SET description = $2,
    notes = $3,
    updated_at = NOW()
WHERE id = $1::int
```

queryReplacement：
```javascript
={{ [ $json._target_id, $json.description, $json._merged_notes ] }}
```

> ⚠️ 注意 UPDATE 里**没有** `action_plan`、**没有** `status`、**没有** `title`。

---

## 2. 选题去重链路

### 2.1 新增节点「选题查库」

**类型**：`n8n-nodes-base.postgres`

```sql
SELECT id::int AS id,
       report_date::text AS report_date,
       title,
       angle,
       source_material,
       reference_visuals,
       value_score::int AS value_score,
       status
FROM public.topic_ideas
ORDER BY id DESC;
```

### 2.2 新增节点「选题去重」

**类型**：`n8n-nodes-base.code`

```javascript
// 选题语义去重（跨日报全表）
const DEDUP_OPTIONS = {
  keywordThreshold: 0.55,
  topicThreshold: 0.6,
  entityRelaxFactor: 0.7,
  requireEntity: false,
};

/* ===== 以下为占位实现，阶段 D 必须替换为 Agent B 的真实版本 ===== */
function normalizeText(input) { /* ... */ }
function normalizeTitle(title) { /* ... */ }
function extractEntities(text) { /* ... */ }
function extractKeywords(text) { /* ... */ }
function extractTopics(text) { /* ... */ }
function isDuplicate(candidate, history, options) { /* ... */ }
/* ===== 占位实现结束 ===== */

const rows = $input.all().map((i) => i.json);
const history = rows.map((r) => ({
  id: r.id,
  title: r.title,
  angle: r.angle,
  source_material: r.source_material,
  reference_visuals: r.reference_visuals,
  value_score: r.value_score,
}));

const candidates = $("选题清洗").all().map((i) => i.json);
const out = [];

for (const c of candidates) {
  const idea = c.idea;
  const res = isDuplicate(
    { title: idea.title, description: idea.angle || idea.source_material },
    history,
    DEDUP_OPTIONS
  );

  if (!res.duplicate) {
    out.push({ json: { ...c, _action: "insert" } });
    continue;
  }

  const matched = history.find((h) => h.id === res.match?.id);

  // 同主题但角度显著不同 → 保留两条，但标注差异
  const angleNew = (idea.angle || "").trim();
  const angleOld = (matched?.angle || "").trim();
  const angleDiffers =
    angleNew && angleOld && angleNew !== angleOld &&
    !angleNew.includes(angleOld) && !angleOld.includes(angleNew);

  if (angleDiffers) {
    out.push({
      json: {
        ...c,
        _action: "insert",
        _variant_of: matched?.id,
        idea: {
          ...idea,
          angle: angleNew + `｜同主题变体（历史 #${matched?.id}：${angleOld.slice(0, 30)}）`,
        },
      },
    });
    continue;
  }

  // 同主题同角度 → 合并到主记录，取字段更全的
  const newScore = idea.value_score || 0;
  const oldScore = matched?.value_score || 0;
  const score = Math.max(newScore, oldScore);

  const mergedSource = mergeByDelimiter(
    matched?.source_material, idea.source_material, "；"
  );
  const mergedVisuals = mergeByDelimiter(
    matched?.reference_visuals, idea.reference_visuals, "\n"
  );
  const mergedAngle = mergeByDelimiter(matched?.angle, idea.angle, "｜");

  out.push({
    json: {
      ...c,
      _action: "update",
      _target_id: matched?.id,
      idea: {
        title: matched?.title || idea.title,
        angle: mergedAngle,
        source_material: mergedSource,
        reference_visuals: mergedVisuals,
        value_score: score,
      },
    },
  });
}

// 按分隔符合并两个文本，去重且保留顺序
function mergeByDelimiter(a, b, delim) {
  const parts = [];
  for (const s of [a, b]) {
    if (!s) continue;
    for (const p of String(s).split(delim)) {
      const t = p.trim();
      if (t && !parts.includes(t)) parts.push(t);
    }
  }
  return parts.length ? parts.join(delim) : null;
}

return out.length > 0 ? out : [{ json: { _noop: true } }];
```

### 2.3 改造「选题写入」节点

**节点 A「选题插入」**：

```sql
INSERT INTO public.topic_ideas
  (report_date, title, angle, source_material, reference_visuals, value_score, status)
VALUES ($1::date, $2, $3, $4, $5, $6::smallint, '待制作')
ON CONFLICT (report_date, title) DO UPDATE SET
  angle = EXCLUDED.angle,
  source_material = EXCLUDED.source_material,
  reference_visuals = EXCLUDED.reference_visuals,
  value_score = EXCLUDED.value_score,
  updated_at = NOW()
```

queryReplacement：
```javascript
={{ [
  $json.report_date,
  $json.idea.title,
  $json.idea.angle,
  $json.idea.source_material,
  $json.idea.reference_visuals,
  $json.idea.value_score
] }}
```

> ⚠️ 保留 `ON CONFLICT DO UPDATE` 作为**最后一道防线** ——
> 即便语义去重漏判，DB 唯一约束也能拦住同日同标题。

**节点 B「选题更新」**：

```sql
UPDATE public.topic_ideas
SET angle = $2,
    source_material = $3,
    reference_visuals = $4,
    value_score = $5,
    updated_at = NOW()
WHERE id = $1::int
```

> ⚠️ UPDATE 里**没有** `status` —— 人工可能已把选题标为「已选用」「已制作」。

---

## 3. 改造后的完整链路

```
商机分析 LLM → 商机清洗 → 商机查库 → 商机去重(Code) → If(_action)
                                                     ├─ insert → 商机插入(postgres)
                                                     └─ update → 商机更新(postgres)

选题提取 LLM → 选题清洗 → 选题查库 → 选题去重(Code) → If(_action)
                                                     ├─ insert → 选题插入(postgres)
                                                     └─ update → 选题更新(postgres)
```

所有新增节点都要设 `onError: continueRegularOutput`（与现有阶段 1 节点一致），
保证去重环节失败时**不阻断日报主流程**。

---

## 4. 施工检查清单

- [ ] `商机查库` / `选题查库` 节点 SQL 用 `n8n_radar` 账号可执行
- [ ] 六个归一化/去重函数从 Agent B 的 TS 实现**原样移植**（逐行对照，不做等价改写）
- [ ] `update` 分支 SQL 不含 `action_plan` / `status` 列
- [ ] `notes` 仅在历史记录是 AI 草稿格式时才更新
- [ ] 新增节点全部 `onError: continueRegularOutput`
- [ ] 手动执行 3 次，`opportunities` / `topic_ideas` 行数不增长
- [ ] 检查历史合并后的记录没有被 update 分支覆盖成 `已放弃`（status 保持原值）
