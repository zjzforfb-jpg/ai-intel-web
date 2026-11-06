# 阶段 D · n8n 改造方案（主控执行）

> 本文档是主控在阶段 D 的施工图。两个 Agent 的产物如何落地到 n8n，写在这里。
> 全部改动直接编辑 n8n SQLite（`workflow_entity`），改完必须**发布为 published**，否则定时任务仍跑旧版。

---

## 0. 施工前必须解决的 P0

### 0.1 现状（已核实）

| 指针 | 值 | 内容 |
|---|---|---|
| `activeVersionId` | `fc15f9c4` | **16 节点旧版** —— 定时任务实际执行的就是它 |
| `versionId`（draft） | `ca9fa476` | 28 节点，含选题/商机分支 + 失败兜底 |
| `workflow_published_version` | → `fc15f9c4` | 确认 published 指向旧版 |

### 0.2 施工顺序（不可颠倒）

1. 在 draft（28 节点）上做阶段 D 的全部改造
2. 自检：节点数、连接、SQL、参数
3. **发布为 published**（`workflow_entity.activeVersionId` ← 新版本 id，
   `workflow_published_version.publishedVersionId` ← 新版本 id）
4. 手动执行一次端到端验证
5. 次日 08:30 观察 `scheduled_job.lastFiredAt`

> ⚠️ 步骤 3 是关键。n8n 2.46.6 的 draft/published 机制下，
> 只改 `workflow_entity` 不会影响定时执行。

---

## 1. 施工项清单

### 施工项 1：发布新版本（P0，最高优先级）

**目的**：让定时任务实际执行含选题/商机分支 + 失败兜底的版本。

**做法**（SQLite 直改，参照之前的安全流程）：

```bash
# 1) 停容器
docker --context orbstack stop n8n-radar

# 2) 拷三件套 + checkpoint
docker --context orbstack cp n8n-radar:/home/node/.n8n/database.sqlite /tmp/n8n-edit/
# （同样拷 -wal / -shm，然后 PRAGMA wal_checkpoint(TRUNCATE)）

# 3) 在 workflow_history 插入新版本（复制 draft 的 nodes/connections）
#    versionId = 新 uuid，createdAt = datetime('now')
#    同时 UPDATE workflow_entity SET versionId=<新uuid>, activeVersionId=<新uuid>
#    以及 INSERT INTO workflow_published_version(workflowId, publishedVersionId)

# 4) 回拷 + chown 1000:1000 + 删旧 WAL/SHM
docker --context orbstack cp /tmp/n8n-edit/database.sqlite n8n-radar:/home/node/.n8n/database.sqlite
docker --context orbstack exec n8n-radar chown 1000:1000 /home/node/.n8n/database.sqlite

# 5) 启动 + 验证
docker --context orbstack start n8n-radar
curl --noproxy '*' -s http://127.0.0.1:5678/healthz
```

> ⚠️ **更安全的替代方案**：直接在 n8n UI 里点「发布」（Publish）。
> 避免手工改 SQLite 引入损坏风险。
> **优先尝试 UI 发布**；只有在 UI 不可用时才走 SQLite 路径。

### 施工项 2：模型确认（已决策）

用户已确认：**最终用 DeepSeek**。

- 当前 draft 的 3 个模型节点已是 `lmChatDeepSeek` + `deepseek-flash` ✅ **无需改动**
- 解析器侧兼容 MiniMax 格式（Agent A 交付），作为将来换模型的保险
- **不动** `DeepSeek account` 凭据

### 施工项 3：日报 prompt 稳定化（防格式漂移）

**现状**：`Basic LLM Chain` 的 prompt 只规定了章节标题，**没有规定条目的字段格式**。
这正是 MiniMax 换格式后全盘失配的根因 —— 格式靠运气。

**做法**：在 prompt 的 `【输出格式】` 段落末尾追加一段「条目格式约定」，明确：

```
【条目格式约定】
1. 核心判断用编号列表，每条格式：`1. **一句话结论**：说明`
2. 头条用 `### N. 标题` 分条，每条下方用无序列表写字段，
   字段格式严格为 `- **字段名**：内容`（冒号在加粗之外，不要写成 `- **字段名：** 内容`）
3. 趋势与机会用编号列表，每条格式：
   `1. **标题**`
   `   - 判断依据：…`
   `   - 观点：…`        ← 趋势用
   `   - 机会来源：…`    ← 机会用
   `   - 实现方向：…`
   `   - 潜在价值：…`
4. 字段名固定用：来源及发布时间 / 核心事实 / 深度解读 / 对行业的影响 / 原文链接
5. 中英文标点不要混用，冒号统一用中文全角「：」
```

**不做**：不新增格式校验节点（避免过度工程）。
现有 `格式化数据` 节点的 `validation` 已覆盖「有没有章节/头条数/长度」四个维度，够用。

### 施工项 4：结构校验增强（低成本、高收益）

**现状**：`格式化数据` 节点的校验只看「字符串里含不含'核心判断'/'行业趋势'/'机会'」这类粗判据，
无法发现「章节在但内容为空」。

**做法**：把 Agent A 的 `parseHeadlineFields` **字段别名表**移植到 `格式化数据` 节点，
增加两项校验：

```js
// 字段别名（与 TS 侧 lib/markdown-parser.ts 保持一致）
const FIELD_ALIASES = {
  source: ["来源及发布时间", "来源", "来源和时间"],
  coreFact: ["核心事实", "事实"],
  deepAnalysis: ["深度解读", "深度分析", "解读"],
  impact: ["对行业的影响", "行业影响", "影响"],
  link: ["原文链接", "链接"],
};

// 统计头条里有多少条真正解析出了 source + coreFact + link
const parsedHeadlines = countHeadlinesWithFields(markdown, FIELD_ALIASES);
validation.headlines_with_fields = parsedHeadlines;
validation.headlines_field_coverage = headlineCount > 0 ? parsedHeadlines / headlineCount : 0;
```

判定逻辑保持与 TS 侧一致：
- 冒号在加粗外：`- **核心事实**：内容`
- 冒号在加粗内：`- **核心事实：** 内容`

> 这一项让「格式漂移」在 n8n 侧就能被 `validation` 捕获，
> 配合已有的 `report_failures` 兜底表（`构建失败记录` 节点）形成闭环。

### 施工项 5：选题/商机写入去重（与 TS 规则一致）

这是阶段 2 的**核心**。任务书要求：「TS 侧与 n8n 侧规则必须一致」。

#### 5.1 方案选型（已评估）

| 方案 | 结论 |
|---|---|
| A：n8n 调 Web API | ❌ 不可行。Next.js 只绑 `127.0.0.1`；容器内 `host.docker.internal` **无法解析**（实测 `getent` 不存在且 `/etc/hosts` 无该条目）；放开监听违反「禁止改成公网监听」红线 |
| **B：Code 节点执行与 TS 一致的轻量归一化** | ✅ **采用**。n8n 容器可直接解析并访问 `n8n-radar-postgres`（192.168.164.2）；已有 postgres 节点可用；纯 JS 逻辑在 n8n 沙箱已验证可执行 |
| C：其他 | ❌ 不考虑 |

#### 5.2 实施步骤

**Step 1**：从 Agent B 的 `lib/normalize.ts` + `lib/dedup.ts` 移植逻辑到 n8n Code 节点。

⚠️ 契约要求这两个文件**不得 import Node API 或第三方库**，正是为了这一步能等价移植。

移植后的 n8n 侧函数名（保持与 TS 侧同名，便于对照）：

```js
function normalizeText(input) { ... }      // 返回 { text, keywords, entities, topics }
function normalizeTitle(title) { ... }
function extractEntities(text) { ... }
function extractKeywords(text) { ... }
function extractTopics(text) { ... }
function isDuplicate(candidate, history, options) { ... }  // 返回 { duplicate, match, score, explanation }
```

**Step 2**：改造「商机写入」链路。

现状：
```
商机分析 LLM → 商机清洗 → 商机写入(postgres, WHERE NOT EXISTS trim(title)=trim($1))
```

改为：
```
商机分析 LLM → 商机清洗 → 商机查库(postgres SELECT id,title,description,notes,status)
                            ↓
                      商机去重(Code)  ← 移植的 isDuplicate
                            ↓
                      商机写入(postgres)  ← 按判定分两类 SQL
```

「商机写入」的 SQL 改为两条（用表达式分支，或拆成两个 postgres 节点）：

```sql
-- A: 需要更新的（重复但新描述更完整，且历史是 AI 草稿）
UPDATE public.opportunities
SET description = $2,
    notes = $3,
    updated_at = NOW()
WHERE id = $1::int;

-- B: 需要插入的（不重复）
INSERT INTO public.opportunities (title, description, category, source_report_date, status, notes)
VALUES ($1, $2, $3, $4::date, '待研究', $5);
```

**绝不覆盖人工字段**（TS 侧契约 3.5 的 n8n 对应实现）：
- `notes`：仅当历史 `notes` 是 AI 草稿格式（`判断依据：` 开头或 `来源日报 YYYY-MM-DD`）才更新
- `action_plan`：UPDATE 语句里**根本不出现**这一列
- `status`：UPDATE 语句里**根本不出现**这一列

**Step 3**：改造「选题写入」链路。

现状：
```
选题提取 LLM → 选题清洗 → 选题写入(postgres, ON CONFLICT (report_date,title) DO UPDATE)
```

改为：
```
选题提取 LLM → 选题清洗 → 选题查库(postgres SELECT id,title,angle,source_material,reference_visuals,value_score,status)
                            ↓
                      选题去重(Code)
                            ↓
                      选题写入(postgres)
```

注意：选题去重是**跨日报全表**，与商机的「全表」一致，但唯一约束仍是 `(report_date, title)`。

「同主题不同角度」的保留规则：
- 若 `isDuplicate` 判定重复**且** angle 与历史项显著不同 → **保留两条**，
  但在 `angle` 末尾追加 `｜同主题变体（历史 #id）` 标注
- 若判定重复**且** angle 相同或为空 → 合并（取字段更全的，更新主记录；把差异内容并入 angle / source_material / reference_visuals）

### 施工项 6：重复执行幂等性验证（阶段 E 的一部分）

**要求**：同一份日报连续执行 3 次，`opportunities` 与 `topic_ideas` 的行数**不得增长**。

验证方法：
```bash
# 记录初始行数
docker --context orbstack exec -i n8n-radar-postgres psql -U n8n_radar -d ai_intelligence -t -A \
  -c "SELECT count(*) FROM opportunities; SELECT count(*) FROM topic_ideas;"

# 连续执行 3 次
docker --context orbstack exec n8n-radar n8n execute --id=ZtIAVVtWmcPLXywX  # ×3

# 再次核对行数
```

⚠️ `n8n execute` 会与主进程抢 SQLite 锁，执行前先 `docker --context orbstack stop n8n-radar`，
执行完再 `start`。

---

## 2. 施工顺序总表

| 序 | 施工项 | 风险 | 可回滚 |
|---|---|---|---|
| 1 | 发布新版本（activeVersionId → 新版） | **高**（改错了定时任务就跑错版本） | 改回旧 id |
| 2 | 模型确认（无需改动） | 无 | — |
| 3 | 日报 prompt 稳定化 | 低（纯文本） | 恢复旧 prompt |
| 4 | 结构校验增强 | 低 | 恢复旧 jsCode |
| 5 | 选题/商机写入去重 | **中**（改 SQL 与链路） | 恢复旧节点 |
| 6 | 幂等性验证 | 无（只读+执行） | — |

**建议顺序**：先做 3、4（低风险、立即见效）→ 再做 5（中风险，需充分测试）→ 最后做 1（发布，风险最高，一旦发布立即生效）→ 验证。

---

## 3. 施工时的安全约束

1. **改 n8n SQLite 前必须**：停容器 → 拷三件套 → `PRAGMA wal_checkpoint(TRUNCATE)` → 编辑 → 回拷 → `chown 1000:1000` → 删旧 WAL/SHM
2. **每步之后验证**：`sqlite3 database.sqlite "PRAGMA integrity_check;"` 应为 `ok`
3. **备份**：`/tmp/n8n-edit/` 保留原库副本，至少到阶段 E 全绿
4. **不碰凭据**：`DeepSeek account`、`Postgres account`、`MiniMax account` 全部不动
5. **不删 worktree**：10 个历史 worktree 按任务书保留

---

## 4. 阶段 D 完成后的验收（并入阶段 E）

- [ ] `activeVersionId` 指向含选题/商机分支的新版本
- [ ] `workflow_published_version` 与之一致
- [ ] 手动执行 1 次：日报 + 选题 + 商机全部落库
- [ ] 连续执行 3 次：商机/选题行数不增长（幂等）
- [ ] 故意用 MiniMax 格式日报测试：解析器仍能出条目与子字段（若切回 MiniMax 则必测）
- [ ] `validation` 能捕获格式漂移（`headlines_field_coverage < 1` 时写入 `report_failures`）
