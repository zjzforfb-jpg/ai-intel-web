# 阶段 A · 真实状态重新核实（2026-11-06）

> 只读核实，未修改任何代码/数据库/n8n 配置。所有结论均来自实际命令输出。
> 基线参照：`docs/audit-2026-11-06.md`（20:30 审计）。

---

## 1. Git 状态

| 项 | 实际值 | 与基线差异 |
|---|---|---|
| HEAD | `545e8d0`（审计报告提交） | 任务书写的 `a37d074` 是上一提交，**以 HEAD 为准** |
| 工作区 | 干净 | 一致 |
| 现有 worktree | 10 个历史分支（feat/rest-api、docker-deploy、monitor-rules/store/ui/notify/tests、opportunities、topics、trends） | 一致，按禁令不清理 |
| `../ai-intel-web-p2a` / `-p2b` | 不存在 | 可安全创建 |

## 2. 数据库状态

数据库名：`ai_intelligence`（**不是** `ai_intel`）。

| 表 | 行数 | 备注 |
|---|---|---|
| `daily_reports` | 2（2026-11-05、2026-11-06） | 与基线一致 |
| `opportunities` | 8 | 3 组语义重复，**去重确实失效** |
| `topic_ideas` | 15 | 5 组语义重复，**跨日/异述未去重** |
| `topics` | 0 | 一致 |

### PG 会话时区（关键）

`SHOW timezone` → **`Asia/Tokyo` (+09)**，应用侧用 `Asia/Shanghai` (+08)，**差 1 小时**。

```
report_date | generated_at                  | 换算北京时间
2026-11-05  | 2026-11-06 01:48:51.375+09   | 2026-11-06 00:48:51  ← manual
2026-11-06  | 2026-11-06 21:08:07.672+09   | 2026-11-06 20:08:07  ← manual
```

→ **审计报告标注的 20:30 审计时间是正确的**，「20:30 审计 vs 21:08 日报」的矛盾已消解。

## 3. 08:30 定时触发 —— 结论修正

| 证据 | 值 |
|---|---|
| `scheduled_job` | kind=cron, `3 30 8 * * *`, tz=`Asia/Shanghai`, enabled=1 |
| `scheduled_job.lastFiredAt` | **空** |
| `execution_entity` 按 mode 统计 | `manual` 39 条 / `cli` 6 条 / **`trigger` 0 条** |
| `nextRunAt` | 2026-11-07 00:30:03 (UTC 存储) |

→ **08:30 定时触发从未发生过**。审计报告中「最近一次 08:30 是当天」的说法缺乏证据支持，属于误述，已在此更正。

## 4. 【P0 新发现】n8n 版本错配 —— 定时任务跑的是旧流程

n8n 2.46.6 引入了 draft/published 双版本。工作流 `ZtIAVVtWmcPLXywX`（CR-01 每日 AI 情报采集）：

| 指针 | 版本 | 节点数 | 模型 | 选题/商机分支 | 失败兜底 |
|---|---|---|---|---|---|
| `activeVersionId`（**定时任务实际执行**） | `fc15f9c4` | **16** | DeepSeek | ❌ 无 | ❌ 无 |
| `versionId`（当前 draft） | `ca9fa476` | **28** | DeepSeek | ✅ 有 | ✅ 有 |
| 最近含 MiniMax 的版本 | `756f5abc` | 31 | 3×MiniMax + 3×DeepSeek | ✅ | ✅ |

`workflow_published_version` 表确认 published = `fc15f9c4`。

### 后果（影响阶段 2 验收）

明早 08:30 定时触发 → 执行 published 的 16 节点版本 → **只落日报，不产选题、不产商机、不写失败记录**。
这会让阶段 2 核心验收目标「明天产生的新日报能自动生成选题」**直接落空**。

### 附加发现

- `fc15f9c4` 的 `Basic LLM Chain` 通过 `ai_languageModel` 连接 `DeepSeek Chat Model`，模型链路正常，只是缺分支。
- 用户手动换 MiniMax 的操作**只存在于未被发布的历史版本**（`9be61d63` … `756f5abc`），当前 draft 已回到 DeepSeek。**日报实际仍由 DeepSeek 生成** —— 这与「用户说换成了 MiniMax」的认知不一致，需在阶段 D 与用户确认最终模型选择。

## 5. 解析器实测（当前 `lib/markdown-parser.ts`）

用真实日报样本实跑 `parseReport()`：

| 样本 | 核心判断 | 头条 | 趋势 | 机会 | 头条 `深度解读` | 趋势 `判断依据/观点` | 机会三字段 |
|---|---|---|---|---|---|---|---|
| 2026-11-05（DeepSeek 格式） | 5 | 5 | 3 | 3 | ✅ 5/5 | ❌ | ❌ |
| 2026-11-06（MiniMax 格式） | 5 | 5 | 3 | 3 | ❌ 0/5 | ❌ | ❌ |

### 两种格式的实际差异

**11-05（DeepSeek）**：
```
## 四、行业趋势观察
1. **编码Agent竞争转向"代码理解—审查—安全修复"闭环。**
   - 判断依据：OpenAI收购Pierre以扩展Codex的代码构建、理解和审查工具；...
   - 观点：单纯补全的差异化下降，...
```

**11-06（MiniMax）**：
```
## 四、行业趋势观察
### 1. Agent基础设施从"GPU单点"转向"CPU+GPU+内存+仿真"全栈协同
```
（无 `- 判断依据：` / `- 观点：` 子字段）

### 结论修正

- 用户 19:25 报的「首页三栏暂不可解析」是**历史状态**，当时最新日报是 MiniMax 格式。现已被 DeepSeek 版覆盖，条目数已恢复（5/5/3/3）。
- 但**子字段（深度解读/判断依据/观点/机会来源/实现方向/潜在价值）全部丢失**，这是两个 Agent 都要修的真实缺口。
- `parseOrderedListItems` 遇到 `### 1. xxx` 这类 `###` 标题时，正则会先匹配到 `### 1.` 的数字部分吗？→ 实测 trends/opps 各出 3 条，说明 `###` 行确实被 `parseOrderedListItems` 当成有序列表项处理了（`3.` 前缀 + 空格），**侥幸能用但语义错误**。

## 6. 去重现状（两处确认失效）

`opportunities`（8 行）—— 3 组重复：
- #36 `为编码Agent提供网络出口审计与PII脱敏网关` ≈ #42 `为AI编程Agent提供网络出口审计与PII脱敏网关`
- #39 `为 Claude Code 等编程Agent做本地出站隐私网关与审计层` ≈ 同上（同一主题三种措辞）
- #37 `基于Rivet做轻量长任务Agent托管与部署服务` ≈ #40 `基于Rivet搭建长周期Agent的托管编排与状态迁移服务`
- #38 `用Codex为中小企业业务团队搭建内部小工具` ≈ #41 `用代码Agent为中小团队定制垂直内部运营工具`

`topic_ideas`（15 行）—— 5 组重复：
- #11/#16/#21 —— Claude Code 邮箱
- #13/#25 —— Cosmos 3
- #14/#17/#24 —— Gemini 低成本
- #12/#19/#22 —— CPU vs GPU
- #15/#20/#23 —— Facebook 深伪广告

当前去重规则：
- `lib/opportunity-draft.ts:64` `normalizeDraftTitle()` 仅 `trim()` → 全表 `trim(title) = ANY(...)` 精确匹配
- `lib/ideas.ts` 依赖 DB 层 `UNIQUE (report_date, title)` → 仅同日同标题防重，跨日完全无防护

## 7. 备份与运维

| 项 | 状态 |
|---|---|
| PG 备份 | ✅ n8n-radar-backup sidecar 容器运行中 |
| `com.aiintel.backup.plist` | 文件存在（16:21 创建），但 **launchd 未注册**（`launchctl list` 无匹配） |
| SQLite + Git bundle 自动备份 | ❌ 未生效 |

## 8. 测试

`npm test` → **71 pass / 0 fail**（6 suites，94s）。与基线一致。

---

## 与审计基线的差异清单

| # | 项 | 审计报告 | 实际核实 | 严重度 |
|---|---|---|---|---|
| 1 | n8n 版本错配 | 未提及 | published=16 节点旧版，定时任务不含选题/商机分支 | **P0** |
| 2 | 08:30 触发 | 「最近一次 08:30 是当天」 | `lastFiredAt` 空 + 0 条 trigger 记录 → 从未触发 | **P0** |
| 3 | MiniMax 生效范围 | 「3 个 LLM 节点全部为 MiniMax」 | MiniMax 仅存在于**未发布历史版本**，当前 draft 已回 DeepSeek | **P1** |
| 4 | 首页解析失败 | 「三栏暂不可解析」 | 当前已恢复 5/5/3/3，但**子字段全丢** | P1 |
| 5 | 审计时间矛盾 | 20:30 vs 21:08 | PG 时区 Asia/Tokyo，21:08+09 = 北京 20:08 → 矛盾消解 | 已澄清 |
| 6 | 数据库名 | 未明确 | `ai_intelligence` | P3 |
| 7 | launchd 备份 | 「需用户手动装」 | plist 在，未注册 → 确认 | P2 |

## 阶段 2 必须处理的 P0

1. **发布 n8n 新版本**（阶段 D）：让定时任务实际执行含选题/商机分支 + 失败兜底的版本。
2. **08:30 触发验证**：修完必须等到次日 08:30 实跑，或用 `n8n execute` 验证等价链路 + 确认 scheduled_job 会真实触发。
