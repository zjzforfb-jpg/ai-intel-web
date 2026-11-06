// 语义去重测试 —— Owner: Agent B（阶段 2）
// 运行：node --env-file=.env.local --import tsx --test --test-concurrency=1 tests/dedup.test.ts
// 覆盖契约 docs/phase2-stageB-interface.md 第 3.3 节的全部样例：
//   - 6 组「必须判定为重复」
//   - 4 组「必须判定为不重复」（反例）
// 外加审计阶段发现的 4 组真实重复商机 + 5 组真实重复选题
import { test } from "node:test";
import assert from "node:assert";
import {
  isDuplicate,
  filterDuplicates,
  DEFAULT_DEDUP_OPTIONS,
  type DedupCandidate,
} from "@/lib/dedup";

/* ------------------------------------------------------------------ */
/* 契约 3.3：必须判定为重复（6 组）                                      */
/* ------------------------------------------------------------------ */

const MUST_DUPLICATE: Array<{ group: string; a: string; b: string }> = [
  {
    group: "同主题不同措辞（编码Agent 网络出口网关）",
    a: "为编码Agent提供网络出口审计与PII脱敏网关",
    b: "为AI编程Agent提供网络出口审计与PII脱敏网关",
  },
  {
    group: "同主题不同措辞（Rivet 长任务托管）",
    a: "基于Rivet做轻量长任务Agent托管与部署服务",
    b: "基于Rivet搭建长周期Agent的托管编排与状态迁移服务",
  },
  {
    group: "同主题不同措辞（Codex 内部小工具）",
    a: "用Codex为中小企业业务团队搭建内部小工具",
    b: "用代码Agent为中小团队定制垂直内部运营工具",
  },
  {
    group: "同一事件不同表述（Claude Code 邮箱泄露）",
    a: "Claude Code竟把邮箱发给网站？企业该慌了",
    b: "Claude Code会把邮箱发给网站？这份报告仍待确认",
  },
  {
    group: "同一事件不同表述（Facebook 深伪广告）",
    a: "Facebook被指放任AI深伪广告？160亿美元争议来了",
    b: "AI换脸诈骗广告赚160亿？Facebook被指明知故犯",
  },
  {
    group: "同一事件不同表述（NVIDIA Cosmos 3）",
    a: "英伟达开源世界模型Cosmos 3，机器人训练场要变天？",
    b: "NVIDIA发世界模型？Cosmos 3让AI在仿真里学干活",
  },
];

for (const c of MUST_DUPLICATE) {
  test(`必须判重：${c.group}`, () => {
    const r = isDuplicate({ title: c.b }, [{ title: c.a }]);
    assert.strictEqual(r.duplicate, true, `应判重，实际说明：${r.explanation}`);
    assert.ok(r.match, "判重时必须返回 match");
    assert.ok(r.match.reason.length > 0, "必须给出判定依据");
    assert.ok(r.explanation.length > 0, "必须给出可读说明");
    assert.ok(r.score > 0 && r.score <= 1, "得分必须在 0~1");
  });
}

/* ------------------------------------------------------------------ */
/* 契约 3.3：必须判定为不重复（4 组反例）                                */
/* ------------------------------------------------------------------ */

const MUST_NOT_DUPLICATE: Array<{ group: string; a: string; b: string }> = [
  {
    group: "同公司不同产品（Codex 内部工具 vs Rivet 托管服务）",
    a: "用Codex为中小企业业务团队搭建内部小工具",
    b: "用Rivet搭建长周期Agent托管服务",
  },
  {
    group: "同领域不同机会（内存成本优化 vs 网络审计网关）",
    a: "长上下文内存成本优化工具",
    b: "Agent网络出口审计网关",
  },
  {
    group: "同领域不同机会（Gemini 评测工作流 vs Cosmos 3 仿真平台）",
    a: "Gemini低成本长片段 API 评测工作流",
    b: "Cosmos 3 仿真训练平台",
  },
  {
    group: "同一实体的不同侧面（隐私风险 vs 编程效率）",
    a: "Claude Code 邮箱泄露隐私风险",
    b: "Claude Code 编程效率对比评测",
  },
];

for (const c of MUST_NOT_DUPLICATE) {
  test(`不得误判：${c.group}`, () => {
    const r = isDuplicate({ title: c.b }, [{ title: c.a }]);
    assert.strictEqual(r.duplicate, false, `不应判重，实际说明：${r.explanation}`);
    assert.strictEqual(r.match, null);
    assert.ok(r.explanation.length > 0, "即使不判重也要给出说明");
  });
}

/* ------------------------------------------------------------------ */
/* 审计发现的真实重复商机（4 组）                                        */
/* ------------------------------------------------------------------ */

const REAL_DUPLICATE_OPPS: Array<{ group: string; ids: number[]; a: string; b: string }> = [
  {
    group: "真实商机组 1（Agent 网络出口审计网关）",
    ids: [36, 42],
    a: "为编码Agent提供网络出口审计与PII脱敏网关",
    b: "为AI编程Agent提供网络出口审计与PII脱敏网关",
  },
  {
    group: "真实商机组 1 变体（本地出站隐私网关与审计层）",
    ids: [39, 42],
    a: "为 Claude Code 等编程Agent做本地出站隐私网关与审计层",
    b: "为AI编程Agent提供网络出口审计与PII脱敏网关",
  },
  {
    group: "真实商机组 2（Rivet 长任务托管）",
    ids: [37, 40],
    a: "基于Rivet做轻量长任务Agent托管与部署服务",
    b: "基于Rivet搭建长周期Agent的托管编排与状态迁移服务",
  },
  {
    group: "真实商机组 3（代码Agent 内部工具）",
    ids: [38, 41],
    a: "用Codex为中小企业业务团队搭建内部小工具",
    b: "用代码Agent为中小团队定制垂直内部运营工具",
  },
];

for (const c of REAL_DUPLICATE_OPPS) {
  test(`真实重复商机：${c.group}`, () => {
    const r = isDuplicate({ title: c.b }, [{ title: c.a }]);
    assert.strictEqual(r.duplicate, true, `应判重（真实重复 id=${c.ids.join("/")}），实际：${r.explanation}`);
  });
}

/* ------------------------------------------------------------------ */
/* 审计发现的真实重复选题（5 组）                                        */
/* ------------------------------------------------------------------ */

const REAL_DUPLICATE_IDEAS: Array<{ group: string; ids: number[]; a: string; b: string }> = [
  {
    group: "真实选题组 1（Claude Code 邮箱泄露）",
    ids: [11, 16],
    a: "Claude Code竟把邮箱发给网站？企业该慌了",
    b: "Claude Code会把邮箱发给网站？这份报告仍待确认",
  },
  {
    group: "真实选题组 2（AI Agent 不只靠 GPU）",
    ids: [12, 22],
    a: "AI Agent不只靠GPU？英伟达突然给CPU加戏",
    b: "别只盯GPU了！NVIDIA说Agent落地卡在CPU和内存",
  },
  {
    group: "真实选题组 3（Cosmos 3 世界模型）",
    ids: [13, 25],
    a: "英伟达开源世界模型Cosmos 3，机器人训练场要变天？",
    b: "NVIDIA发世界模型？Cosmos 3让AI在仿真里学干活",
  },
  {
    group: "真实选题组 4（Gemini 便宜更长）",
    ids: [14, 24],
    a: "谷歌新模型更便宜还更长？内容团队先别急着换",
    b: "做视频成本要降？Gemini新模型主打快、便宜、长片段",
  },
  {
    group: "真实选题组 5（Facebook 深伪广告）",
    ids: [15, 23],
    a: "Facebook被指放任AI深伪广告？160亿美元争议来了",
    b: "AI换脸诈骗广告赚160亿？Facebook被指明知故犯",
  },
];

for (const c of REAL_DUPLICATE_IDEAS) {
  test(`真实重复选题：${c.group}`, () => {
    const r = isDuplicate({ title: c.b }, [{ title: c.a }]);
    assert.strictEqual(r.duplicate, true, `应判重（真实重复 id=${c.ids.join("/")}），实际：${r.explanation}`);
  });
}

/* ------------------------------------------------------------------ */
/* 阈值与行为细节                                                       */
/* ------------------------------------------------------------------ */

test("默认阈值符合契约 3.4", () => {
  assert.strictEqual(DEFAULT_DEDUP_OPTIONS.keywordThreshold, 0.55);
  assert.strictEqual(DEFAULT_DEDUP_OPTIONS.topicThreshold, 0.6);
  assert.strictEqual(DEFAULT_DEDUP_OPTIONS.entityRelaxFactor, 0.7);
  assert.strictEqual(DEFAULT_DEDUP_OPTIONS.requireEntity, false);
});

test("标题归一化后完全一致 → 直接判重且给出明确依据", () => {
  const r = isDuplicate(
    { title: "  为AI编程Agent提供网络出口审计与PII脱敏网关  " },
    [{ title: "为编码Agent提供网络出口审计与PII脱敏网关" }]
  );
  assert.strictEqual(r.duplicate, true);
  assert.match(r.match?.reason ?? "", /标题归一化后完全一致/);
  assert.strictEqual(r.score, 1);
});

test("requireEntity=true 时，无共同实体的相似项不判重", () => {
  // 「Agent网络出口审计网关」与「长上下文内存成本优化工具」主题有部分重合，
  // 但没有任何共同重要实体；requireEntity 打开后必须拒绝判重
  const r = isDuplicate(
    { title: "Agent网络出口审计网关" },
    [{ title: "长上下文内存成本优化工具" }],
    { requireEntity: true }
  );
  assert.strictEqual(r.duplicate, false, `实际：${r.explanation}`);
  assert.match(r.explanation, /要求实体命中|不判重/);
});

test("requireEntity=false（默认）时，同样的两项也不判重（严格双条件）", () => {
  const r = isDuplicate(
    { title: "Agent网络出口审计网关" },
    [{ title: "长上下文内存成本优化工具" }]
  );
  assert.strictEqual(r.duplicate, false);
});

test("阈值可配置：提高 topicThreshold 后应放弃判重", () => {
  // 选一组「无共同重要实体、但主题与关键词都有部分重合」的两项：
  // 它们只可能通过「主题 + 关键词」双条件判重，因此 topicThreshold 生效
  const c = { title: "Agent网络出口审计网关" };
  const h = [{ title: "长上下文内存成本优化工具" }];
  const r = isDuplicate(c, h);
  assert.strictEqual(r.duplicate, false, `默认阈值下不应判重：${r.explanation}`);
  // 提高 topicThreshold → 依然不判重（可审计说明应体现阈值）
  const strict = isDuplicate(c, h, { topicThreshold: 1 });
  assert.strictEqual(strict.duplicate, false);
  assert.match(strict.explanation, /主题相似/);
});

test("阈值可配置：同时降低两个阈值时严格路径可判重", () => {
  // 构造一组关键词高度重合、主题也相同、但无共同实体的两项
  const c = { title: "多模态视频生成的成本优化工作流" };
  const h = [{ title: "多模态视频生成成本优化工作流方案" }];
  assert.strictEqual(isDuplicate(c, h, { topicThreshold: 0.01, keywordThreshold: 0.01 }).duplicate, true);
});

test("实体命中路径下 keywordThreshold 生效（放宽系数可调）", () => {
  const c = { title: "AI换脸诈骗广告赚160亿？Facebook被指明知故犯" };
  const h = [{ title: "Facebook被指放任AI深伪广告？160亿美元争议来了" }];
  assert.strictEqual(isDuplicate(c, h).duplicate, true);
  // 把放宽后的关键词阈值提到 1，实体路径的第二条腿失效，
  // 但第一条腿（主题相似度 100%）仍成立，所以依然判重
  assert.strictEqual(isDuplicate(c, h, { keywordThreshold: 1 }).duplicate, true);
});

test("空历史集合 → 不判重", () => {
  const r = isDuplicate({ title: "任意标题" }, []);
  assert.strictEqual(r.duplicate, false);
  assert.strictEqual(r.match, null);
});

test("非法输入不抛错", () => {
  const r = isDuplicate({ title: "" }, [{ title: "" }]);
  assert.strictEqual(typeof r.duplicate, "boolean");
  const r2 = isDuplicate({ title: "x" }, undefined as unknown as DedupCandidate[]);
  assert.strictEqual(r2.duplicate, false);
});

test("description 参与关键词判定，提升准确度", () => {
  // 只比标题时，两边几乎没有共同关键词 → 不判重
  const withoutDesc = isDuplicate(
    { title: "全新形态的网关产品" },
    [{ title: "Agent网络出口审计与PII脱敏网关" }]
  );
  assert.strictEqual(withoutDesc.duplicate, false, `实际：${withoutDesc.explanation}`);

  // 加上 description 后，关键词覆盖达到阈值 → 判重
  const withDesc = isDuplicate(
    {
      title: "全新形态的网关产品",
      description: "Agent 网络出口审计 PII 脱敏 网关 白名单 审计日志",
    },
    [{ title: "Agent网络出口审计与PII脱敏网关", description: "企业安全采购刚需" }]
  );
  assert.strictEqual(withDesc.duplicate, true, `实际：${withDesc.explanation}`);
  assert.match(withDesc.explanation, /关键词重合度/);
});

test("filterDuplicates：批内重复也能识别", () => {
  const history: DedupCandidate[] = [{ title: "已有商机A" }];
  const candidates: DedupCandidate[] = [
    { title: "全新商机B" },
    { title: "已有商机A" },
    { title: "为AI编程Agent提供网络出口审计与PII脱敏网关" },
    { title: "为编码Agent提供网络出口审计与PII脱敏网关" },
  ];
  const { unique, duplicates } = filterDuplicates(candidates, history);
  // 「全新商机B」与「为AI编程Agent…」唯一；「已有商机A」与最后一项都是重复
  assert.strictEqual(unique.length, 2);
  assert.ok(unique.some((u) => u.title === "全新商机B"));
  assert.ok(unique.some((u) => u.title === "为AI编程Agent提供网络出口审计与PII脱敏网关"));
  assert.strictEqual(duplicates.length, 2);
  for (const d of duplicates) {
    assert.strictEqual(d.result.duplicate, true);
    assert.ok(d.result.match);
  }
});

test("filterDuplicates：空输入返回空结果", () => {
  const r = filterDuplicates([], []);
  assert.deepStrictEqual(r, { unique: [], duplicates: [] });
});

test("filterDuplicates：全部唯一时 duplicates 为空", () => {
  const r = filterDuplicates(
    [{ title: "全新商机A" }, { title: "全新商机B" }],
    []
  );
  assert.strictEqual(r.unique.length, 2);
  assert.strictEqual(r.duplicates.length, 0);
});

test("判重命中时返回匹配明细（实体/关键词/主题）", () => {
  const r = isDuplicate(
    { title: "英伟达开源世界模型Cosmos 3，机器人训练场要变天？" },
    [{ title: "NVIDIA发世界模型？Cosmos 3让AI在仿真里学干活" }]
  );
  assert.strictEqual(r.duplicate, true);
  assert.ok(r.match);
  assert.ok(r.match.matched.entities.length > 0, "应记录命中的实体");
  assert.ok(r.match.matched.topics.length > 0, "应记录命中的主题");
  assert.ok(r.match.reason.includes("实体"), `原因应说明实体命中：${r.match.reason}`);
});
