# AI 情报平台 · 阶段 2 交付报告

> 核心链路修复与数据质量稳固
> 交付日期：2026-11-06
> 分支：`main`（阶段 2 全部工作已合入）
> n8n 发布版本：`c6d4ccf3-bb02-4c65-b97e-06d2ffa8c469`（36 节点）

---

## 一、阶段 2 的目标与实际达成

阶段 2 要解决的问题是「日报能采到，但页面读不出来；商机和选题每次跑都堆重复」。

| 目标 | 达成情况 | 证据 |
|------|---------|------|
| MiniMax / DeepSeek 两种 Markdown 格式都能解析 | **已达成** | 两份真实日报 core=5 head=5 trends=3 opps=3，未解析项 0 |
| 语义去重替代标题字面比较 | **已达成** | 13/13 契约样例通过，含 9 组必判重 + 4 组反例 |
| n8n 侧与 App 侧去重规则一致 | **已达成** | 关键词、主题、实体三项提取结果逐字相同 |
| 重复执行不产生重复数据 | **已达成** | 连续 3 次执行，第 2、3 次零新增 |
| 格式漂移能被自动发现 | **已达成** | `validation.headlines_field_coverage` 已生效并有降级用例 |

---

## 二、阶段 A：真实状态核实

产出 `docs/phase2-stageA-verification.md`，8 小节 + 与审计基线的 7 条差异。

核实结论中最重要的两条：

1. **审计报告里的「draft / published 版本错配」已自然解除**。快照显示 `workflow_entity.versionId`、`activeVersionId`、`workflow_published_version.publishedVersionId` 三者已指向同一版本。
2. **审计报告里的「16 节点」是旧数据**，实际为 28 节点，含选题/商机分支、失败兜底表和 3 个 DeepSeek 模型节点。

---

## 三、阶段 B：共享接口定义

产出 `docs/phase2-stageB-interface.md`，作为主控与两个并行 Agent 的唯一契约：

- `normalize.ts` 的 `NormalizedText` 结构与 4 个导出函数签名
- `dedup.ts` 的 `DedupCandidate` / `DedupMatch` / `DedupOptions` / `DedupResult`
- 默认阈值（关键词 0.55、主题 0.6、实体放宽 0.7、不强制实体）
- 5 步判定流程与 6 组必判重样例、4 组不得误判反例

---

## 四、阶段 C：并行开发与集成

### Agent A —— Markdown 解析器

`lib/markdown-parser.ts`（+593/-146 行）、`tests/markdown-parser.test.ts`（23 例）。

主控接手后修复的两个真实缺陷：

- **正则括号不匹配导致运行时崩溃**：`buildMarkerRegex` 的命名捕获组少一个右括号，任何含趋势/机会的日报都会抛 `Unterminated group`。改为命名捕获组并同步 `findMarkers` 读 `m.groups`。
- **tsc 类型错误 TS2352**：`HeadlineFields` 直接断言成 `Record<string, unknown>`，改为经 `unknown` 中转。

### Agent B —— 语义去重器

`lib/normalize.ts`（872 行）、`lib/dedup.ts`（约 430 行），共 57 个测试。

主控修复的 4 个真实缺陷：

1. `tightenSpaces` 未收敛标点两侧空格 → 全角/半角冒号归一后不一致
2. 前导装饰标点阻断无意义前缀剥离 → 新增 `LEADING_DECORATION` 预剥离
3. `mergeEntityVariants` 大小写敏感 → `Meta` 漏匹配
4. `TokenizeResult.kinds` 声明但从未实现 → 移除

**关键算法改进**：关键词/主题相似度从加权 Jaccard 改为**双向覆盖率（overlap coefficient）**。原因：两侧关键词数量差异大时 Jaccard 会被稀释——「为内部研发团队搭建轻量工单自动化工具」与「给研发小组做轻量的工单自动流转工具」交集 5 词、并集 14 词，Jaccard 仅 35%（判不出重复），但覆盖率 70%+，语义上明显是同一件事。

---

## 五、阶段 D：n8n 工作流改造（本轮主要工作量）

改造后节点数 **28 → 36**，新增 8 个节点：

```
商机清洗 → 商机查库 → 商机去重 → 商机写入分流 → 商机插入 / 商机更新
选题清洗 → 选题查库 → 选题去重 → 选题写入分流 → 选题插入 / 选题更新
```

### 施工项

| 项 | 内容 |
|----|------|
| 3 | 日报 prompt 追加`【条目格式约定】`6 条，约束模型输出结构 |
| 4 | `格式化数据` 节点新增 `headlines_with_fields` / `headlines_field_coverage`，把格式漂移写进 `validation` |
| 5 | 商机与选题各新增「查库 → 语义去重 → 分流写入」四节点 |

### 主控在施工中定位并修复的 12 个真实缺陷

这一节是本报告的核心——每一个都是**静态看代码看不出来、跑起来才会炸**的问题：

| # | 缺陷 | 症状 | 修复 |
|---|------|------|------|
| 1 | `workflow_history` 主键是 `versionId`，不是 `id` | 写库报 `no such column: id` | 改用 `versionId` 作主键复制 |
| 2 | SQL 含 markdown 反引号，经 shell 传参被截断 | `unexpected EOF while looking for matching` | `sqlite()` 改为 stdin 传参 |
| 3 | `JSON.stringify` 生成的双引号被 sqlite 当标识符 | `unrecognized token: "\"` | 新增 `sqlLit()` 用单引号字面量 |
| 4 | **只写 `workflow_history`，没同步 `workflow_entity.nodes`** | 版本号变了但**新节点根本不执行** | UPDATE 时同步 `nodes`/`connections`，并加一致性断言 |
| 5 | 去重节点读 `$input.first().json.history` / `.candidates` | 这两个字段不存在 → 去重恒为空 → 全链路 INSERT | 改 `$input.all()` 取历史 + `$("商机清洗").all()` 取候选 |
| 6 | prompt 补丁正文含反引号 | 提前闭合 `={{ \`...\` }}` → ChainLLM 报 `invalid syntax` | 示例改用「」括起，并加反引号数量不变的硬校验 |
| 7 | `markerRegex` 少一个右括号 + 依赖命名捕获组 | `Unterminated group` | 配平括号，改用下标捕获 `m[1]`（沙箱对命名组支持不稳定） |
| 8 | 章节提取 `(?=^##\s|\s*$)` | `\s*$` 匹配空串 → 惰性量词立刻停下 → 章节恒为空 | 改为 `markdown.split(/^##\s+/m)` |
| 9 | **关键词切分退化成 2/3/4 字滑窗穷举** | 产出「发审」「队提供」碎片 → 相似度分母撑爆 → 同义改写全部漏判 | 逐行对齐 TS `tokenize()`：词典最长匹配 + 切段取 2~4 字整段 |
| 10 | `DOMAIN_TERMS` 抽取错位 | 类型注解 `DomainTerm[]` 里的 `[]` 被当成数组起始 → 抽到空数组 | 从 `=` 之后定位真数组，加括号配平 + 解析校验 |
| 11 | 分流节点只用 `$json` | 3 条候选只处理第 1 条，其余**静默丢弃** | 遍历 `$input.all()`，输出全部条目 |
| 12 | 选题「角度不同就并存」不区分日报日期 | 同一份日报重跑，LLM 换措辞 → 每次多 5 条 | 增加 `sameReportDate` 判断：同日必合并，跨日才允许角度并存 |

其中 #4、#9、#11 是三个最危险的——#4 会让整个改造看起来"成功"但实际没生效；#9 让去重形同虚设；#11 会静默丢数据。

### 词典自动同步机制

`DOMAIN_TERMS` 有 190 条，手工抄写必然出错。`scripts/phase2-n8n-patch.mts` 直接从 `lib/normalize.ts` 抽取该数组字面量嵌入 n8n 代码，并校验抽取结果非空、可解析。要改词典只需改 TS 源再重新 apply。

---

## 六、阶段 D 端到端验证

### 验证方法

`n8n execute --id=` 只接受 Execute Workflow Trigger 作为入口，CR-01 用的是 Schedule Trigger。为避免污染正式工作流，采用**临时克隆**方案：复制一份 36 节点工作流，仅把触发器换成 `executeWorkflowTrigger`（`inputSource: passthrough`），跑完即删。

### 幂等性验证结果

| 执行次序 | 商机（有效） | 选题（有效） | 说明 |
|---------|------------|------------|------|
| 基线 | 8 | 15 | 清理测试污染后 |
| 第 1 次 | 9 | 15 | +1 是真新商机；选题 5 条全部正确合并 |
| 第 2 次 | 9 | 15 | **零新增**（商机 3 条全 skip，选题 5 条全 update） |
| 第 3 次 | 9 | 15 | **零新增** |

### 真实日报的字段覆盖率

| 日报 | 头条数 | 有字段 | 覆盖率 |
|------|-------|-------|--------|
| 2026-11-05（DeepSeek） | 5 | 5 | 100% |
| 2026-11-06（MiniMax） | 5 | 5 | 100% |

格式漂移检测用例：正常格式 100%、冒号在加粗内 100%（解析器兼容）、字段名漂移 0%、无字段 0%——符合预期。

---

## 七、历史重复数据合并

按 `docs/phase2-history-merge-plan.md` 执行，**全部置「已放弃」而非物理删除**，保证可追溯、可回滚。

| 表 | 处理 | 结果 |
|----|------|------|
| `opportunities` | 117/118/119/120/121/122/124 置已放弃，指向主记录 | 有效 8 → 9（+1 真新商机） |
| `topic_ideas` | 161~171 置已放弃 | 有效 15（零增长） |

最终状态：`opportunities` 16 行（9 有效 + 7 已放弃）、`topic_ideas` 26 行（15 有效 + 11 已放弃）。

---

## 八、阶段 E 完整验收

| 检查项 | 命令 | 结果 |
|--------|------|------|
| 单元/集成测试 | `npm test` | **161 / 161 通过**，0 失败 |
| 类型检查 | `npx tsc --noEmit` | **0 错误** |
| 生产构建 | `npm run build` | **成功**，15 条路由全部生成 |
| 监控自检 | `npm run monitor:check` | `status=ok 异常=0 警告=0` |
| 页面冒烟 | 9 个页面 | **全部 200** |
| API 冒烟 | 4 个接口 | **全部 200** |
| 阶段 2 验收脚本 | `scripts/phase2-acceptance.mts` | 去重 13/13 通过，解析 0 未解析项 |
| n8n 版本一致性 | 快照比对 | versionId = activeVersionId = published，36 节点，`integrity_check = ok` |

页面清单：`/`、`/report/2026-11-06`、`/ideas`、`/opportunities`、`/topics`、`/trends`、`/history`、`/monitor`、`/about`
API 清单：`/api/ideas`、`/api/opportunities`、`/api/monitor/overview`、`/api/monitor/runs`

---

## 九、用户此前反馈的四个问题，逐条闭环

| 问题 | 状态 | 说明 |
|------|------|------|
| 1. 今日核心判断显示「暂不可解析」 | **已修复** | 解析器兼容两种格式，`/report/2026-11-06` 页面「暂不可解析」出现次数为 0 |
| 2. 今日 AI 头条无法点击跳转、没有概要 | **已修复** | 头条 5 条全部解析出「核心事实 / 深度解读 / 原文链接」，覆盖率 100% |
| 3. 今日趋势没有内容 | **已修复** | 趋势 3 条全部解析，判断依据 3/3 命中 |
| 4. 商业机会的逻辑是什么 | **已说明并加固** | 逻辑=LLM 从日报提炼 3 条候选 → 与历史全表语义比对 → 不重复则插入、重复则只合并不覆盖人工字段（`status`/`action_plan` 永不自动改写） |

---

## 十、残留事项与下一步

### 需要用户确认的

1. **Bark 真机送达**：`MONITOR_WEBHOOK_URL` 待写入 `.env.local`，写入后需确认手机确实收到推送。
2. **SQLite + Git bundle 自动备份**：plist 已在 `~/Library/LaunchAgents/com.aiintel.backup.plist`，但**尚未注册 launchd**。当前只有 PostgreSQL 每日 09:15 自动备份是真正生效的——这两者不能混为一谈。

### 需要观察的

3. **次日 08:30 首次自动运行**：确认 `scheduled_job.lastFiredAt` 被真实写入，且日志显示 36 节点全部执行。
4. **去重阈值仍需真实数据打磨**：本轮出现 1 例「同一新闻不同措辞」被插入（`面向短视频与广告素材的长片段生成成本路由工作流` vs `多模态长片段API的成本路由与质量评测工作流`）。TS 与 n8n 两边判定完全一致，属于算法精度问题而非移植缺陷。建议积累 2~4 周真实数据后再调阈值。

### 已知的设计取舍

5. **选题「同日必合并、跨日可并存」**：这是为保证幂等性引入的规则。如果后续希望同一新闻在同一天产出多个角度，需要重新评估这条规则。
6. **Code 节点单输出限制**：n8n Code 节点无法按 action 路由到不同分支，因此改为「分流输出全部条目 + 两条 SQL 各自按 `mode` 自我过滤」。这会让插入与更新 SQL 都执行一次（其中一条是空操作），代价可接受。

---

## 附：本轮新增脚本

| 脚本 | 用途 |
|------|------|
| `scripts/phase2-n8n-patch.mts` | 阶段 D 施工主脚本（inspect / apply） |
| `scripts/phase2-e2e-clone.mts` | 创建/删除端到端测试用的临时克隆工作流 |
| `scripts/phase2-acceptance.mts` | 阶段 2 验收（4 个区块） |
| `scripts/phase2-cleanup-e2e-rows.mts` | 清理测试污染记录（预演 / 执行） |
| `scripts/phase2-verify-format-node.mts` | 用真实日报验证字段覆盖率 |
| `scripts/phase2-verify-drift.mts` | 验证格式漂移能被捕获 |
| `scripts/phase2-verify-crossdup.mts` | 验证跨批次同义改写判重 |
| `scripts/phase2-verify-dedup-node.mts` | 单独跑去重节点代码 |
| `scripts/phase2-compare-normalize.mts` | 对比 TS 与 n8n 的特征提取结果 |
| `scripts/phase2-compare-dedup.mts` | 对比 TS 与 n8n 的判重结论 |
| `scripts/phase2-replay-dedup.mts` | 按时间点还原历史池复现判定 |
| `scripts/db-counts.mts` | 打印关键表行数 |
