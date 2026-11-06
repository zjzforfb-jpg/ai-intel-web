// 文本归一化测试 —— Owner: Agent B（阶段 2）
// 运行：node --env-file=.env.local --import tsx --test --test-concurrency=1 tests/normalize.test.ts
// 覆盖契约 docs/phase2-stageB-interface.md 第 3.1 节的全部归一化规则清单
import { test } from "node:test";
import assert from "node:assert";
import {
  normalizeText,
  normalizeTitle,
  extractEntities,
  extractKeywords,
  extractTopics,
  toHalfWidth,
  unifyPunctuation,
  stripMarketingModifiers,
  stripMeaninglessPrefixes,
  mergeEntityVariants,
  relatedEntities,
  type NormalizedText,
} from "@/lib/normalize";

test("toHalfWidth：全角标点与数字转半角", () => {
  assert.strictEqual(toHalfWidth("１２３"), "123");
  assert.strictEqual(toHalfWidth("Ａ：Ｂ"), "A:B");
  assert.strictEqual(toHalfWidth("（测试）"), "(测试)");
  assert.strictEqual(toHalfWidth("正常文本"), "正常文本");
});

test("unifyPunctuation：中英标点统一", () => {
  assert.strictEqual(unifyPunctuation("a：b"), "a:b");
  assert.strictEqual(unifyPunctuation("a＝b"), "a=b");
  assert.strictEqual(unifyPunctuation("a，b"), "a,b");
});

test("stripMarketingModifiers：去除营销修饰词", () => {
  assert.strictEqual(stripMarketingModifiers("重磅发布"), "发布");
  assert.strictEqual(stripMarketingModifiers("最新模型"), "模型");
  assert.strictEqual(stripMarketingModifiers("深度解读报告"), "解读报告");
  assert.strictEqual(stripMarketingModifiers("普通标题"), "普通标题");
});

test("stripMeaninglessPrefixes：去除无意义前缀", () => {
  assert.strictEqual(stripMeaninglessPrefixes("如何做Agent"), "Agent");
  assert.strictEqual(stripMeaninglessPrefixes("关于AI的观察"), "AI的观察");
  assert.strictEqual(stripMeaninglessPrefixes("Agent工具"), "Agent工具");
});

test("stripMeaninglessPrefixes：前导装饰标点不阻断前缀剥离", () => {
  assert.strictEqual(stripMeaninglessPrefixes("！如何做Agent工具"), "Agent工具");
  assert.strictEqual(stripMeaninglessPrefixes("???关于AI"), "AI");
});

test("mergeEntityVariants：实体名变体合并到规范名", () => {
  // 统一替换为规范名（小写形式）
  assert.strictEqual(mergeEntityVariants("Facebook"), "facebook");
  assert.strictEqual(mergeEntityVariants("Meta 的产品"), "facebook 的产品");
  assert.strictEqual(mergeEntityVariants("Open AI"), "openai");
  assert.strictEqual(mergeEntityVariants("英伟达发布"), "nvidia发布");
  assert.strictEqual(mergeEntityVariants("ClaudeCode 更新"), "claude code 更新");
});

test("mergeEntityVariants：大小写不敏感匹配", () => {
  assert.strictEqual(mergeEntityVariants("META"), "facebook");
  assert.strictEqual(mergeEntityVariants("OPEN AI"), "openai");
  assert.strictEqual(mergeEntityVariants("NVIDIA"), "nvidia");
});

test("normalizeText：返回完整特征集", () => {
  const n: NormalizedText = normalizeText("为AI编程Agent提供网络出口审计与PII脱敏网关");
  assert.ok(n.text.length > 0);
  assert.ok(n.keywords.length > 0);
  assert.ok(n.entities.length > 0);
  assert.ok(n.topics.length > 0);
  // 文本已小写
  assert.strictEqual(n.text, n.text.toLowerCase());
});

test("normalizeText：大小写归一", () => {
  assert.strictEqual(normalizeText("NVIDIA").text, "nvidia");
  assert.strictEqual(normalizeText("OpenAI").text, "openai");
});

test("normalizeText：全半角归一后结果一致", () => {
  const a = normalizeText("ＡＩ Agent：测试").text;
  const b = normalizeText("AI Agent: 测试").text;
  assert.strictEqual(a, b);
});

test("normalizeText：中英标点混用归一后一致", () => {
  const a = normalizeText("Agent，工具：测试").text;
  const b = normalizeText("Agent,工具:测试").text;
  assert.strictEqual(a, b);
});

test("normalizeText：中文间空格被去除、英文间空格保留单空格", () => {
  // 中文之间的空格全部去除
  assert.strictEqual(normalizeText("Agent 工具 测试").text, "agent工具测试");
  assert.strictEqual(normalizeText("Agent工具测试").text, "agent工具测试");
  // 英文单词之间保留单空格（多个空格收敛为一个）
  assert.strictEqual(normalizeText("hello  world  agent").text, "hello world agent");
});

test("normalizeText：营销修饰词与无意义前缀被剔除", () => {
  const withNoise = normalizeText("重磅！如何做Agent工具").text;
  const withoutNoise = normalizeText("做Agent工具").text;
  assert.ok(!withNoise.includes("重磅"), "营销词应被剔除");
  assert.ok(!withNoise.includes("如何"), "无意义前缀应被剔除");
  assert.strictEqual(withNoise, withoutNoise);
});

test("normalizeTitle：同义标题归一到同一字符串", () => {
  const a = normalizeTitle("为编码Agent提供网络出口审计与PII脱敏网关");
  const b = normalizeTitle("为AI编程Agent提供网络出口审计与PII脱敏网关");
  assert.strictEqual(a, b);
  assert.strictEqual(normalizeTitle("  多余空格  "), "多余空格");
  assert.strictEqual(normalizeTitle("OpenAI"), "openai");
});

test("extractEntities：识别公司 / 产品 / 技术名", () => {
  assert.ok(extractEntities("英伟达开源世界模型Cosmos 3").includes("nvidia"));
  assert.ok(extractEntities("英伟达开源世界模型Cosmos 3").includes("cosmos 3"));
  assert.ok(extractEntities("Facebook被指放任AI深伪广告").includes("facebook"));
  assert.ok(extractEntities("Claude Code竟把邮箱发给网站").includes("claude code"));
  assert.ok(extractEntities("基于Rivet做长任务Agent托管").includes("rivet"));
  assert.ok(extractEntities("用Codex搭建内部工具").includes("codex"));
});

test("extractEntities：同义写法归一到同一规范名", () => {
  assert.ok(extractEntities("Meta发布").includes("facebook"));
  assert.ok(extractEntities("谷歌发布").includes("google"));
  assert.ok(extractEntities("英伟达发布").includes("nvidia"));
});

test("extractEntities：无实体时返回空数组", () => {
  assert.deepStrictEqual(extractEntities("长上下文内存成本优化工具"), []);
});

test("extractKeywords：中文按 2-4 字切分 + 英文按词切分", () => {
  const k = extractKeywords("Agent网络出口审计网关");
  assert.ok(k.includes("审计"));
  assert.ok(k.includes("网关"));
  // 英文按词切分
  const k2 = extractKeywords("Cosmos 3 world model");
  assert.ok(k2.some((x) => x.includes("world")));
});

test("extractKeywords：停用词被剔除", () => {
  const k = extractKeywords("的 了 是 在 和 与");
  assert.ok(!k.includes("的"));
  assert.ok(!k.includes("了"));
});

test("extractKeywords：结果去重", () => {
  const k = extractKeywords("审计 审计 审计");
  assert.strictEqual(new Set(k).size, k.length);
});

test("extractTopics：命中主题分类标签", () => {
  const t = extractTopics("Agent网络出口审计与PII脱敏网关");
  assert.ok(t.includes("隐私安全"), `实际：${t.join(",")}`);
  const t2 = extractTopics("长上下文内存成本优化工具");
  assert.ok(t2.includes("算力性能"), `实际：${t2.join(",")}`);
  const t3 = extractTopics("Facebook深伪诈骗广告治理");
  assert.ok(t3.includes("平台治理"), `实际：${t3.join(",")}`);
});

test("extractTopics：无主题命中时返回空数组", () => {
  assert.deepStrictEqual(extractTopics(""), []);
});

test("relatedEntities：实体弱关联关系", () => {
  const rel = relatedEntities("codex");
  assert.ok(rel.includes("编程agent"), `实际：${rel.join(",")}`);
  assert.ok(relatedEntities("nvidia").includes("cosmos 3"));
  assert.deepStrictEqual(relatedEntities("不存在的实体xyz"), []);
});

test("归一化对输入类型鲁棒：空值不抛错", () => {
  assert.strictEqual(normalizeText("").text, "");
  assert.strictEqual(normalizeText("   ").text, "");
  assert.deepStrictEqual(extractEntities(""), []);
  assert.deepStrictEqual(extractKeywords(""), []);
  assert.deepStrictEqual(extractTopics(""), []);
  assert.strictEqual(normalizeTitle(""), "");
});
