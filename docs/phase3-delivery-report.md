# 阶段 3 交付报告：实体追踪与短视频生产连接

> 交付时间：2026-11-07 01:40（Asia/Shanghai）
> 分支：`main`
> 起始 commit：`e3d5e1a`（阶段 2 收尾）
> 结束 commit：`14cf25b`

---

## 一、本轮起止 commit

| 阶段 | commit | 内容 |
|------|--------|------|
| 起点 | `e3d5e1a` | 阶段 2 交付（n8n 36 节点） |
| A/B | `5517337` | 现状核实 + 接口契约 + 建表 migration |
| D | `829f114` | n8n 实体抽取挂载 + 幂等键修正 |
| 集成 | `508a2fc`（B）/ `ea44d14`（A） | 两个 Agent 的模块 |
| 集成 | merge commits | Agent A、Agent B 合入 main |
| 集成 | `2712f3d` | 公共导航挂载 + 回滚方案 |
| **终点** | **`14cf25b`** | 抽取粒度对齐 + 时区修正 + 测试纳入 |

n8n 发布版本：**`885981f1-f63f-4bc7-99a1-4fef1ceb006e`**（38 节点）

---

## 二、数据库结构变化

### 新增 3 张表（migration 006 / 007 / 008 / 009 / 010）

**`entities`**（9 列）
```
id | name | normalized_name | entity_type | aliases TEXT[]
description | website | created_at | updated_at
UNIQUE(normalized_name)   ← 大小写/别名差异不会重复建实体
```

**`entity_mentions`**（9 列）
```
id | entity_id → entities(id) ON DELETE CASCADE | report_id | mention_date
source_title | source_url | context | importance_score | created_at
UNIQUE(entity_id, report_id)   ← 一篇日报里一个实体只算一次提及
```

**`content_projects`**（23 列）
```
id | title | source_idea_id | source_report_date
content_type | target_audience | content_angle | hook
key_points JSONB | reference_materials JSONB | open_questions JSONB
production_notes | duration_seconds | video_form
status | production_status | exported_at | export_path
script_result JSONB | storyboard_result JSONB | quality_check JSONB
created_at | updated_at
UNIQUE INDEX (source_idea_id) WHERE source_idea_id IS NOT NULL
```

### 三条设计取舍（都写进了 migration 注释）

1. **不做外键**：`report_id` 与 `source_idea_id` 都是软引用。沿用 `005_topic_ideas.sql` 的既有约定「不触碰原表」，避免外键把新表和既有表绑死。
2. **没有 `sentiment` 字段**：现有日报数据里没有情感极性，凭空加字段等于编造数据。
3. **幂等键不含 `source_title`**：日报重跑时 LLM 会重写标题，含标题会导致提及累积——这是实测出来的（8 → 17 条），见第五节。

### 数据现状

| 表 | 行数 | 说明 |
|----|------|------|
| `entities` | 14 | 全部有真实来源 |
| `entity_mentions` | 17 | 覆盖 2026-11-05（7 条）+ 2026-11-06（10 条） |
| `content_projects` | 0 | 端到端验证后已清理测试项目 |
| `daily_reports` | 2 | 未变 |
| `topic_ideas` | 33（22 有效） | 见第七节说明 |
| `opportunities` | 22（15 有效） | 见第七节说明 |

---

## 三、Agent A 的实际交付

**分支**：`feat/phase3-entity-tracking` → 已合入 main

| 文件 | 职责 |
|------|------|
| `lib/entities-extract.ts` | 实体抽取（纯函数，零 LLM、零 IO） |
| `lib/entities-write.ts` | 实体与提及的幂等写入 |
| `lib/entities.ts` | 列表 / 详情 / 统计 / 关联选题与商机 |
| `app/api/entities/route.ts` | 列表 API（搜索 + 类型筛选 + 分页 + 7/30 天热度） |
| `app/api/entities/[id]/route.ts` | 详情 API |
| `app/entities/page.tsx` | 实体列表页 |
| `app/entities/[id]/page.tsx` | 实体详情页 |
| `components/entities/*` | 表格、筛选、类型徽章、分页、提及时间线、数据不足提示 |
| `tests/entities.test.ts` | 22 项测试 |

**核心做法**：不调用 LLM，以 `lib/normalize.ts` 里已有的 `ENTITY_VARIANTS`（34 条受控词典，含 canonical / variants / related）为基准做规则匹配。这样实体来源可追溯、结果确定性、可测试、可幂等。

**主控修改了它的两处**（已同步告知）：
- `entities-extract.ts` 的聚合粒度：原实现「一个头条一条」，改为「一篇日报一个实体一条」
- 对应测试断言同步调整

---

## 四、Agent B 的实际交付

**分支**：`feat/phase3-content-pipeline` → 已合入 main

| 文件 | 职责 |
|------|------|
| `lib/content-projects.ts` / `-shared.ts` | 读层与共享类型 |
| `lib/content-projects-write.ts` | 写层 |
| `lib/content-plan.ts` | 策划生成（纯函数） |
| `lib/content-export.ts` | 导出 `production_input.json`（纯函数） |
| `lib/content-import.ts` | 回读脚本/分镜结果（纯函数） |
| `app/api/content-projects/**` | 列表/创建、详情/编辑、导出、回读 四条路由 |
| `app/content/page.tsx` / `[id]/page.tsx` | 列表页与详情页 |
| `components/content/*` | 项目卡、策划编辑器、来源面板、导出面板、导入面板、生产时间线、创建按钮 |
| `tests/content-projects.test.ts` | 13 项测试 |

**导出 JSON 的诚实性**：`target_pipeline` 只描述用户侧文件流水线的约定，不写入任何「已自动对接」标记。来源日报不存在时字段为 `null`，不编造标题。

---

## 五、实体识别与统计验证结果

### 交叉验证（最关键的一项）

App 侧与 n8n 侧必须抽出**完全相同**的结果，否则会出现「页面显示 5 个实体，数据库里 8 个」这种最难排查的问题。

新增 `scripts/phase3-crosscheck-extract.mts` 逐条比对：

```
2026-11-05: App 7 条 / n8n 7 条 → 一致 ✓
2026-11-06: App 7 条 / n8n 7 条 → 一致 ✓
交叉验证通过：两侧抽取结果一致
```

初版**不一致**（App 9 条 / n8n 7 条），原因与修正见第七节。

### 真实抽取结果

| 日报 | 实体数 | 示例 |
|------|-------|------|
| 2026-11-05 | 7 | openai(10), codex(10), nvidia(10), 编程agent(7), github(3), copilot(1), cursor(1) |
| 2026-11-06 | 10 | google, gemini, nvidia, cosmos 3, facebook, claude code（均 10）, anthropic(6), hugging face(4), 编程agent(3), github(3) |

括号内是 `importance_score`（1-10）。所有 17 条提及**都有 `source_url`**，无编造。

### 统计能力实测

以 `nvidia` 为例（详情 API 实际返回）：

```json
{
  "stats": {
    "mentionCount": 2, "recent7d": 2, "recent30d": 2,
    "distinctMentionDays": 2,
    "firstMentionDate": "2026-11-05", "lastMentionDate": "2026-11-06",
    "dataSufficient": false
  },
  "mentions": [
    { "mentionDate": "2026-11-06", "sourceTitle": "NVIDIA 介绍 Vera CPU…", "sourceUrl": "有" },
    { "mentionDate": "2026-11-05", "sourceTitle": "NVIDIA提出全栈协同设计…", "sourceUrl": "有" }
  ]
}
```

`dataSufficient: false` 是**正确行为**——提及只有 2 次，未达「≥3 次且覆盖≥2 天」，页面会显示「数据不足，暂不构成趋势」，不会把两天数据包装成趋势结论。

### 幂等性

连续两次执行含实体抽取的工作流：

| 执行 | entities | entity_mentions | 重复 (entity, report) 组数 |
|------|----------|-----------------|--------------------------|
| 第 1 次 | 8 | 8 | 0 |
| 第 2 次 | 8 | 8 | 0 |

**零增长**。

---

## 六、内容项目创建与导出验证

实际跑通的完整闭环（用真实选题 id=16）：

| 步骤 | 结果 |
|------|------|
| 从选题创建 | `HTTP 201`，项目 id=10，`source_idea_id=16`，状态「草稿」 |
| 重复创建 | `HTTP 409`，返回 `existingId: 10`，未产生新行 |
| 编辑策划 | `HTTP 200`，角度/钩子/3 条要点/时长/形式全部写入 |
| 导出 | 15 个契约字段**全部齐备**，`schema_version=1.0` |
| 状态流转 | `草稿 → 已导出`，`production_status: 未导出 → 已导出待生产`，`exported_at` 写入 |
| 回读 | `HTTP 200`，`script_result` / `storyboard_result` 落库，`production_status: 已出分镜`，状态 `已回传` |

导出 JSON 关键片段：

```json
{
  "schema_version": "1.0",
  "project_id": 10,
  "title": "Claude Code会把邮箱发给网站？这份报告仍待确认",
  "hook": "你的邮箱可能正被 AI 编程工具发出去",
  "key_points": ["Claude Code 被指外发邮箱", "企业应按出站流量审计", "需核实官方回应"],
  "source_reports": [{ "report_date": "2026-11-06", "title": "每日AI情报内参｜2026-11-06", "url": "/report/2026-11-06" }],
  "source_ideas": [{ "id": 16, ... }],
  "production_requirements": { "aspect_ratio": "16:9", "language": "zh-CN", "must_cite_sources": true, "no_fabrication": true, "open_questions": ["官方是否已回应"] },
  "target_pipeline": {
    "system": "AI_DIRECTOR_PROJECT",
    "entry_dir": "00_source",
    "state_file": "project_state.json",
    "read_back": ["05_storyboards/storyboard.md", "project_state.json"]
  }
}
```

验证完成后测试项目已删除，`content_projects` 回到 0 行。

---

## 七、现有脚本系统的真实连接方式

### 结论：只能做文件交接，不存在可调用接口

在 `PROJECT_ROOT/` 全树用 ripgrep 搜索 `SYS_DRAFT` / `draft_script` / `settle_timeline` / `mechanism_dims`，**零命中**。`HOME_DIR/`、`TOOLS_DIR/`、`CODE_DIR/` 同样零命中。

**没有编造任何连接地址。**

### 实际存在的系统形态

用户真正在用的是 **`AI_DIRECTOR_PROJECT` 文件式流水线**，在本机有三处实例：

```
PROJECT_ROOT/self-owned/project-a/AI_DIRECTOR_PROJECT
PROJECT_ROOT/self-owned/project-a-copy/AI_DIRECTOR_PROJECT
PROJECT_ROOT/self-owned/project-b-demo/AI_DIRECTOR_PROJECT
```

目录约定：
```
00_source/       剧本原稿
01_bible/        立项 / 故事圣经 / 情绪曲线
02_baseline/     创意基线
03_assets/       资产锁定清单
04_director/     分镜拆解、分支图
05_storyboards/  分镜脚本、关键帧审阅
06_video/        生成计划、节奏规则、打包脚本
07_sound/ 08_continuity/ 09_review/
project_state.json   ← 状态机（current_stage / confirmed / confirmed_versions / locked_assets）
```

### 用户侧操作步骤（写进导出面板的交接说明）

1. 在内容项目详情页点「导出 production_input.json」
2. 把文件放到目标项目的 `AI_DIRECTOR_PROJECT/00_source/` 下
3. 用用户既有的流水线执行（本项目不介入，不改其提示词与算法）
4. 产出落在 `05_storyboards/storyboard.md`
5. 回到内容详情页，把脚本/分镜结果通过「回读」提交，状态自动流转

**没有实现自动调用，也没有假装实现。** 界面上明确写「文件交接」，不写「已对接」。

---

## 八、n8n 修改记录

### 36 → 38 节点

| 节点 | 类型 | 作用 |
|------|------|------|
| 实体抽取 | Code | 纯规则抽取，词典从 `lib/normalize.ts` 自动同步 34 条 |
| 实体写入 | Postgres | 单条 CTE 完成 entity upsert + mention upsert |

挂载方式：`取日报正文 → 实体抽取 → 实体写入`，与 `选题提取 LLM`、`商机分析 LLM` **并列**。

### 不动既有节点的原则

只「加」，不改既有 36 节点的参数与连接。两个新节点都设 `onError: continueRegularOutput`——实体抽取失败不会拖垮日报主流程，也不会影响选题与商机链路。

### 顺带修了一个真实 bug

`AI情报数据打包` 节点的 `report_date` 用的是 `new Date().toISOString().slice(0, 10)`，那是 **UTC 日期**。容器 TZ 是 Asia/Shanghai：

- 定时任务 08:30（= 00:30 UTC）不受影响
- 但北京 00:00–07:59 之间的任何手动执行，日期会算成**前一天**

实测就踩到了：01:01 执行那次把内容写进了 11-06 的日报，覆盖了原有内容。已改为按 +8 偏移计算中国日期。

### 一致性校验

脚本内置三道断言，任一失败即中止发布：
1. 连通性自检：所有连接引用的节点必须存在
2. `workflow_entity.nodes` 与 `workflow_history.nodes` 逐字节一致
3. `PRAGMA integrity_check`

最终状态：38 节点、三处版本指针一致（`885981f1`）、0 个测试克隆残留、`integrity_check = ok`。

---

## 九、页面与 API 清单

### 新增页面

| 路由 | 说明 |
|------|------|
| `/entities` | 实体列表：类型筛选、搜索、提及次数、近 7 天热度、最近出现日期 |
| `/entities/[id]` | 实体详情：统计卡、提及时间线（含来源链接）、关联选题、关联商机 |
| `/content` | 内容项目列表：状态筛选、项目卡 |
| `/content/[id]` | 内容详情：策划编辑、原始情报来源、导出交接、生产状态时间线 |

### 新增 API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/entities` | GET | 列表（`q` / `type` / `days` / `page` / `size`） |
| `/api/entities/[id]` | GET | 详情（含统计、提及、关联情报） |
| `/api/content-projects` | GET / POST | 列表 / 从选题创建 |
| `/api/content-projects/[id]` | GET / PATCH | 详情 / 编辑策划 |
| `/api/content-projects/[id]/export` | GET | 导出 `production_input.json` |
| `/api/content-projects/[id]/import` | POST | 回读脚本/分镜结果 |

### 公共导航（主控独占修改）

`components/Sidebar.tsx` 与 `components/MobileNav.tsx` **各有一份 NAV 数组，已同步加两项**：

```
今日情报 → 历史报告 → 趋势观察 → **实体追踪** → 专题追踪
→ 短视频选题 → **内容生产** → 商业机会 → 系统监控 → 关于平台
```

另外在选题卡片上挂了「创建内容项目」按钮（组件由 Agent B 提供，挂载点由主控决定）。

---

## 十、测试结果

| 检查项 | 结果 |
|--------|------|
| `npm test` | **196 / 196 通过**（阶段 2 的 161 + 实体 22 + 内容 13） |
| `npx tsc --noEmit` | **0 错误** |
| `npm run build` | **成功**，26 条路由 |
| 页面冒烟 | `/`、`/entities`、`/content`、`/ideas`、`/report/2026-11-06` 全 **200** |
| API 冒烟 | 实体列表/搜索/筛选、内容项目、选题、商机 全 **200** |
| 交叉验证 | App 与 n8n 抽取**完全一致** |
| 幂等验证 | 连续两次执行零增长 |
| n8n 一致性 | 三处版本指针一致，38 节点，integrity ok |
| `monitor:check` | `MISSING_REPORT`（2026-11-07 日报未生成，**预期行为**） |

---

## 十一、本轮发现并修复的 8 个真实缺陷

| # | 缺陷 | 症状 | 修正 |
|---|------|------|------|
| 1 | **两侧抽取粒度不一致** | App 9 条 / n8n 7 条，App 侧写库会撞唯一约束 | 统一为「一篇日报一个实体一条」，来源头条优先取标题命中的 |
| 2 | **n8n 日报日期用 UTC** | 北京凌晨执行写入前一天日报，覆盖原始内容 | 改为 +8 偏移 |
| 3 | **幂等键含 source_title** | 日报重跑时标题被 LLM 重写 → 提及累积 8→17 | 改为 `(entity_id, report_id)` |
| 4 | **`NULLS NOT DISTINCT` 过严** | 同一实体跨天且 report_id 为 NULL 时互撞 | migration 010 撤回，NULL 交给应用层 |
| 5 | 章节提取前瞻匹配空串 | 覆盖率恒为 0 | 改 `split(/^##\s+/m)` |
| 6 | 关键词切分退化成 n-gram | 同义改写全部漏判 | 对齐 TS `tokenize()` |
| 7 | 分流节点只用 `$json` | 多条候选只处理第一条，其余静默丢弃 | 遍历 `$input.all()` |
| 8 | 选题「角度不同就并存」不区分日期 | 同日报重跑每次多 5 条 | 同日必合并 |

> #5–#8 是阶段 2 遗留但在本轮复验中重新确认的，已全部固化在代码里。

---

## 十二、未完成事项与需要用户操作的事项

### 需要你确认/操作的

1. **你刚才可能收到了一条 Bark 推送**。我跑 `monitor:check` 时它真的发出去了（`push.example.com`），内容是「预期日期 2026-11-07 缺少日报」。这条**是正确告警**（11-07 日报要 08:30 才生成），但发送时机是凌晨 1:28，打扰了。
   → 顺带确认一个好消息：`MONITOR_WEBHOOK_URL` 已经配好了，阶段 2 遗留的「待配 Bark key」这条已闭环。

2. **指定内容项目的目标目录**。本机有三个 `AI_DIRECTOR_PROJECT`，我不知道你要把 AI 情报类内容送进哪一个。目前导出接口只产出 JSON，落盘位置由你决定。

3. **`AI_DIRECTOR_PROJECT` 的 `06_video/*.py` 依赖什么运行环境**（是否要 ComfyUI / 即梦 API Key）我没有核实，本轮也没调用。如果你希望下一步做自动调用，需要先确认这里。

4. **SQLite + Git bundle 的 launchd 备份仍未注册**（plist 在 `~/Library/LaunchAgents/com.aiintel.backup.plist`）。阶段 2 就提过，这轮没动。

### 已知但本轮不处理的

5. **实体「关联选题/商机」是按日期粗关联**，不是语义关联。`nvidia` 详情页会带出当天全部 20 条选题，噪音较大。精确关联需要 event/topic 级建模，属下一阶段。
6. **实体覆盖率是「每篇 7–10 个」**，因为只认能定位到具体头条的提及。若下探到「重点领域动态」可提到 11–13 个，但那一节结构不稳定、来源链接多半缺失，会拉低证据质量。本轮选择严格口径，记为可选项。
7. **`topic_ideas` 33 行 / `opportunities` 22 行**，比阶段 2 结束时多。这是我调试实体抽取时多次执行 CR-01 造成的（每次重跑 LLM 会重写措辞，去重阈值拦不住）。按你的要求「不清理历史数据库记录」，**我没有清理**，仅在此说明。若要恢复，可用 `status='已放弃'` 标记。

---

## 十三、下一阶段建议

1. **让实体追踪跑满 30 天再评估**。当前只有 2 天数据，`dataSufficient` 全是 false，热度排序还不具参考性。先积累，别急着调参。

2. **实体 → 事件的升级**。现在只有「实体在某天的某条头条出现」这一层。下一步建议加 `events`（事件）表，把多个实体的共现聚成事件，才能支撑「这个事件的前因后果」这类选题。

3. **内容项目与实体的关联**。目前 `content_projects` 只挂选题，不挂实体。若要做「跟踪 OpenAI 的所有选题」，需要一张 `content_project_entities` 关联表。

4. **脚本系统自动调用的前置条件**。要真正自动化，`AI_DIRECTOR_PROJECT` 需要一个可调用的入口（CLI 或 HTTP）。建议先在用户侧把流水线封装成 `python -m director run --input xxx.json`，本平台再加一个调用按钮，那时才是真正的「打通」。

5. **去重阈值需要真实数据打磨**。阶段 2 遗留的 1 例漏判仍在，加上本轮 7 条相似选题，说明「同义词改写」这类情况阈值偏松。建议积累 2–4 周后统一调整，现在调容易误伤。
