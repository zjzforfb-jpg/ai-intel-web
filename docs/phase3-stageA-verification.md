# 阶段 3 · 阶段 A：真实状态核实报告

> 核实时间：2026-11-07 00:50 ~ 01:05（Asia/Shanghai）
> 核实方式：只读检查（git / filesystem / PostgreSQL / Docker），未做任何写入
> 结论摘要：**实体追踪与内容项目所需的基础设施均不存在，需新建；用户的视频生产系统是文件式流水线，不是可调用 API。**

---

## 一、Git 与工作区

| 项 | 实际值 |
|----|--------|
| 当前分支 | `main` |
| HEAD | `e3d5e1a` feat(阶段2): n8n 去重链路施工 + 端到端验证 + 交付报告 |
| 工作区 | **干净**（`git status --short` 无输出） |
| 已有 Worktree | 13 个（`ai-intel-web-api`、`-docker`、`-mon-a`~`-e`、`-opps`、`-p2a`、`-p2b`、`-topics`、`-trends`） |
| `p3a` / `p3b` | **不存在**，可安全创建 |

阶段 2 遗留的 Worktree（`-p2a` `-p2b`）仍在，按本轮要求「不删除旧 Worktree」保留。

---

## 二、数据库真实结构

数据库 `ai_intelligence`，PostgreSQL 16，容器 `n8n-radar-postgres`（127.0.0.1:5433）。

### 2.1 现有表（7 张）

`daily_reports`、`monitor_notifications`、`monitor_runs`、`opportunities`、`report_failures`、`topic_ideas`、`topics`

### 2.2 本轮关心的三张表

**`daily_reports`**（2 行）
```
id BIGSERIAL PK | report_date DATE NOT NULL | title TEXT NOT NULL
report_markdown TEXT | report_html TEXT | generated_at TIMESTAMPTZ
total_articles INT | headline_count INT | status TEXT
validation JSONB | created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

**`topic_ideas`**（26 行，其中有效 15）—— 唯一约束 `(report_date, title)`
```
id BIGSERIAL PK | report_date DATE NOT NULL | title TEXT NOT NULL
angle TEXT | source_material TEXT | reference_visuals TEXT
value_score SMALLINT CHECK 1..10 | status TEXT NOT NULL DEFAULT '待制作'
  CHECK status IN ('待制作','已选用','已制作','已放弃')
created_at / updated_at TIMESTAMPTZ
```

**`opportunities`**（16 行，其中有效 9）
```
id BIGSERIAL PK | title TEXT NOT NULL | description TEXT | category TEXT
source_report_date DATE | status TEXT NOT NULL DEFAULT '待研究'
notes TEXT | action_plan TEXT | created_at / updated_at
```

### 2.3 关键发现：关联方式是「日期软引用」

`topic_ideas.report_date` 与 `opportunities.source_report_date` **都只用日期指向日报，没有 `report_id` 外键**。

migration `005_topic_ideas.sql` 里写明了原因：

> `report_date DATE NOT NULL, -- 来源日报日期，软引用 daily_reports.report_date，不加外键以避免触碰原表`

**这直接决定了本轮的接口设计**：
- 新表如果要关联日报，可以显式存 `report_id BIGINT`（通过 `report_date` 反查填充），但不加 FK 约束，保持既有「不触碰原表」的约定。
- 内容项目引用选题时必须用 `topic_ideas.id`（真实主键），不能用日期。

### 2.4 角色与授权

| 角色 | 超级用户 | 用途 |
|------|---------|------|
| `n8n_radar` | **是** | 建表 / DDL 唯一可用账号 |
| `ai_intel_reader` | 否 | 只读（拒绝访问 `report_failures`） |
| `ai_intel_writer` | 否 | 增删改 |
| `ai_intel_monitor` | 否 | 监控写入 |

新表必须按 `005` 的写法显式 `GRANT`，否则 App 侧会因权限报错。

### 2.5 Migration 现状

`migrations/` 下 5 个文件，编号到 `005`。惯例（从 005 归纳）：

- 纯新增（additive-only），`CREATE TABLE IF NOT EXISTS`，幂等可重跑
- 不修改既有表、角色、权限
- 文件头写清执行者、前置条件、红线
- 显式 `GRANT` 给 writer / reader（含新建的 sequence）

**本轮新 migration 编号从 `006` 开始。**

---

## 三、需新建的数据库对象（确认不存在）

```
entities             → 不存在（to_regclass = null）
entity_mentions      → 不存在
content_projects     → 不存在
```

代码侧同样确认：`app/`、`lib/`、`components/` 下搜索 `content_project` / `contentProject` / `storyboard` / `scriptExport` **零命中**。

---

## 四、现有应用结构

### 4.1 路由（10 个页面 + 4 个 API）

页面：`/`、`/history`、`/trends`、`/topics`、`/topics/[id]`、`/topics/new`、`/ideas`、`/opportunities`、`/opportunities/[id]`、`/report/[date]`、`/monitor`、`/about`

API：`/api/ideas`、`/api/ideas/[id]`、`/api/opportunities`、`/api/opportunities/[id]`、`/api/monitor/overview`、`/api/monitor/runs`

### 4.2 公共导航（主控独占修改）

`components/Sidebar.tsx` 与 `components/MobileNav.tsx` **各有一份完全相同的 8 项 NAV 数组**，改导航必须同时改这两处。

```ts
{ href: "/",            label: "今日情报" }
{ href: "/history",     label: "历史报告" }
{ href: "/trends",      label: "趋势观察" }
{ href: "/topics",      label: "专题追踪" }
{ href: "/ideas",       label: "短视频选题" }
{ href: "/opportunities", label: "商业机会" }
{ href: "/monitor",     label: "系统监控" }
{ href: "/about",       label: "关于平台" }
```

### 4.3 可复用的既有资产

| 资产 | 位置 | 本轮用途 |
|------|------|---------|
| 实体词典 34 条（canonical + variants + related） | `lib/normalize.ts` → `ENTITY_VARIANTS` | **实体识别直接复用**，避免重新造轮子 |
| 领域词典 190 条 | `lib/normalize.ts` → `DOMAIN_TERMS` | 实体类型的辅助判断 |
| 归一化与切分 | `lib/normalize.ts` → `normalizeText` / `normalizeTitle` / `tokenize` | 实体名归一化（`normalized_name`） |
| Markdown 解析器 | `lib/markdown-parser.ts` | 从日报里取头条标题与原文链接作为 mention 来源 |
| 只读连接池 | `lib/db.ts` → `getReadPool()` | 实体与内容项目的读查询 |
| 写入连接池 | `lib/db-write.ts` | 写操作，注意用 `DB_WRITE_USER` |
| 表格/筛选/空状态等 UI | `components/` | 实体列表与内容中心沿用同一套视觉语言 |

### 4.4 package.json

`test` 脚本是**显式文件清单**，不是通配：

```
--test tests/rules.test.ts tests/store.test.ts ... tests/dedup.test.ts
```

新测试文件必须由主控在集成阶段追加进这个清单（两个 Agent 都不得改 `package.json`）。

---

## 五、n8n 现状

| 项 | 值 |
|----|-----|
| 容器 | `n8n-radar` Up，`/healthz` = `{"status":"ok"}` |
| 工作流 | CR-01 每日 AI 情报采集，**36 节点** |
| 发布版本 | `c6d4ccf3-bb02-4c65-b97e-06d2ffa8c469`（三处版本指针一致） |
| 定时 | `3 30 8 * * *` Asia/Shanghai，enabled=1 |

### 实体抽取的挂载点已确认

节点 `取日报正文` 输出：

```js
return [{ json: { report_date: src.report_date, report_markdown: src.report_markdown || "" } }];
```

这正是实体抽取需要的全部输入（日期 + 正文），且位于日报已成功落库之后 —— 适合作为**并行分支**挂上去，不影响选题/商机两条既有链路。

---

## 六、用户视频生产系统的真实位置与形态【重点】

### 6.1 搜索结果：`SYS_DRAFT` / `draft_script` / `settle_timeline` / `mechanism_dims` 全部未找到

用 ripgrep 在本机项目根目录全树搜索上述四个标识符，**零命中**。
在用户主目录（排除 Library / node_modules / .git）与两个开发工具目录同样零命中。

### 6.2 但找到了真实存在、结构完整的视频生产流水线

**`AI_DIRECTOR_PROJECT` 文件式流水线**，存在于三个项目下：

```
<项目根>/自有项目/<项目A>/AI_DIRECTOR_PROJECT
<项目根>/自有项目/<项目A>_副本/AI_DIRECTOR_PROJECT
<项目根>/自有项目/<项目B> DEMO/AI_DIRECTOR_PROJECT
```

> 注：原始路径含具体项目名与用户姓名，发布到公开仓库前已脱敏为占位符。
> 三处实例的**目录结构与文件约定完全一致**，这是本节结论的依据。

目录约定（9 个阶段目录 + 1 个状态文件）：

```
00_source/        剧本原稿（script_final.docx）
01_bible/         P0 项目立项 / P0A 故事圣经 / 情绪曲线
02_baseline/      P1 创意基线
03_assets/        资产锁定清单 ASSET_LOCK_MANIFEST_v1.md
04_director/      分镜拆解 breakdown.md、分支图 branch_graph.md
05_storyboards/   分镜脚本 storyboard.md、关键帧审阅 P5_keyframe_review.md
06_video/         生成计划 generation_plan.md、节奏规则、打包脚本 *.py
07_sound/         声音
08_continuity/    连贯性
09_review/        终审
project_state.json  ← 状态机
history/
```

`project_state.json` 是真正的**状态机契约**：

```json
{
  "project": "末日特情处_第1集",
  "version": "5.1",
  "current_stage": "P6_150s_compact_v3_ready_for_generation",
  "script_status": "final",
  "confirmed": { "P0A": true, "P1": true, "characters": true, "props": true,
                 "scenes": true, "spatial": true, "breakdown": true,
                 "storyboards": true, "video": false, "sound": false,
                 "final_review": false },
  "confirmed_versions": { "P0A": "1.1", "P1": "2.0", "asset_manifest": "1.0", ... },
  "visual_system": { "status": "已锁定", "style": "...", "aspect_ratio": "16:9", "master_source": "..." },
  "locked_assets": { "manifest": "03_assets/ASSET_LOCK_MANIFEST_v1.md", "characters": {...} }
}
```

### 6.3 另一条相关资产：`storyboard-with-references` 技能

`/Volumes/<其他项目>/.trae/skills/storyboard-with-references/` —— 一套**方法论 + 提示词规范**，不是代码：

```
SKILL.md                    即梦 Seedance 过审规范、六段式提示词结构、400 字限制
agents/                     6 个 Agent 分工（lens / space_camera / action_physics / performance / continuity / assembly）
references/                 角色 / 场景 / 道具 参考图模板
storyboard_constraints/     合规、摄影、身体力学、微表情四本圣经
```

目录内没有任何 `.py` / `.js` / `.sh` —— **不可执行**。

### 6.4 结论：只能做文件交接，不能做 API 调用

| 判断项 | 结论 | 依据 |
|--------|------|------|
| 是否有可调用 API | **否** | 全盘无服务端代码、无 HTTP 端点、无 OpenAPI |
| 是否有 CLI | **否** | 无统一入口脚本 |
| 是否有 Python 模块可 import | **否** | `06_video/*.py` 是单项目打包脚本，不是通用库 |
| 是否文件式交接 | **是** | `00_source` 输入、`05_storyboards` 输出、`project_state.json` 状态 |
| 跨项目路径能否直接写 | **需用户确认** | 三个 `AI_DIRECTOR_PROJECT` 分属不同项目，写入目标必须由用户指定 |

**因此本轮 Agent B 的验收标准按用户要求调整为：文件导出 + 导入说明，不伪造自动化。**

---

## 七、不能确认的内容（如实列出）

1. `SYS_DRAFT` / `draft_script` / `settle_timeline` / `mechanism_dims` 这套命名的系统**在本机未找到**。可能存在于其他机器、云端或已废弃。**未编造任何连接地址。**
2. `AI_DIRECTOR_PROJECT` 的 `06_video/*.py` 依赖什么运行环境（是否需 ComfyUI、即梦 API Key）**未核实**，本轮不调用。
3. 三套 `AI_DIRECTOR_PROJECT` 哪一个是用户希望接收「AI 情报类」短视频项目的**目标目录**，需用户指定。
4. Boss/老板端是否有发布数据回流接口，**不存在**，本轮不涉及。

---

## 八、本轮实施建议

### 8.1 实体追踪：用受控词典 + 规则抽取，不引入 LLM

**理由**：`ENTITY_VARIANTS` 已有 34 个 canonical 实体（含别名与关联关系），真实日报实测分别命中 16 / 15 个。

**实测数据**：
```
2026-11-05: 命中 16 个 → anthropic, codex, openai, gpt, google, nvidia, facebook,
                          copilot, amazon, aws, deepseek, cursor, github, hugging face, mcp, 编程agent
2026-11-06: 命中 15 个 → claude code, anthropic, codex, openai, gpt, google, gemini,
                          nvidia, cosmos 3, facebook, deepseek, github, hugging face, 编程agent, pii
```

这满足「不调用 LLM、不编造实体、有来源证据」的全部约束，且**完全确定性、可测试、可幂等**。
后续要扩实体只需往词典加条目，无需改代码。

**抽取粒度**：以「头条条目」为单位产出 mention，`source_title` 取头条标题，`source_url` 取该头条的原文链接，`context` 取实体所在的那一行原文（截断 200 字）。

### 8.2 内容项目：文件导出为主，不碰用户已有生产系统

导出 `production_input.json`（字段见接口文档），并在 `05_storyboards` 回读 `storyboard.md` 时只读不写。

### 8.3 n8n：只加 2 个节点，挂在「取日报正文」的并行分支

`实体抽取`（Code，纯规则）→ `实体写入`（Postgres，UPSERT 幂等）。
设置 `onError: continueRegularOutput`，实体失败不影响日报主流程与选题/商机链路。

### 8.4 明确不做

不新建 LLM 节点、不改现有 36 节点中任何既有节点的逻辑、不动选题/商机去重链路。

---

## 九、与上一轮记录的差异

| 上一轮记录 | 实际核实 | 说明 |
|-----------|---------|------|
| migration 到 005 | 确认到 005 | 一致 |
| n8n 36 节点 | 确认 36 节点 | 一致 |
| `npm test` 161/161 | 未重跑（本轮开始前状态） | 阶段 E 会重跑 |
| 内容中心「仍全空」 | 确认 5 个子目录全空 | `01_选题库`~`05_数据复盘` 均无文件 |
| 视频生产系统「待确认位置」 | **已定位为 `AI_DIRECTOR_PROJECT` 文件流水线** | 本轮新增结论 |
