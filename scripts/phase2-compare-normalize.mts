// 阶段 D 辅助：对比 TS 侧 normalize 与 n8n 移植版的特征提取结果
// 用法：node --env-file=.env.local --import tsx scripts/phase2-compare-normalize.mts
import { readFileSync } from "node:fs";
import { normalizeText, extractKeywords, extractTopics } from "../lib/normalize.js";

const nodes = JSON.parse(readFileSync("/tmp/n8n-verify/nodes-v6.json", "utf8")) as any[];
const code = nodes.find((n) => n.name === "商机去重").parameters.jsCode;

// 从 n8n 代码里抽出 normalizer 部分（到 isDuplicate 定义之前）
const cut = code.indexOf("function isDuplicate(");
const normalizePart = code.slice(0, cut);
// n8n 版把关键词/主题合并进了 normalizeText 的返回值，没有独立导出函数
const jsFn = new Function(`${normalizePart}\nreturn { normalizeText, keywordSimilarity, topicSimilarity, entityHit };`);
const n8n = jsFn();

const samples = [
  "为小团队提供 AI 编码 CLI 外发审计与脱敏代理",
  "为编码与浏览器Agent做本地出站请求审计和脱敏网关",
  "为编码和浏览器 Agent 提供网络请求脱敏与审计网关",
  "为AI编码/浏览Agent做本地出站请求脱敏与审计网关",
  "为AI编程Agent提供网络出口审计与PII脱敏网关",
];

for (const s of samples) {
  const ts = normalizeText(s);
  const nn = n8n.normalizeText(s);
  // TS 侧 extractKeywords/ extractTopics 接收纯文本字符串
  const tsKw = extractKeywords(s).slice().sort();
  const nnKw = (nn.keywords || []).slice().sort();
  const tsTp = extractTopics(s).slice().sort();
  const nnTp = (nn.topics || []).slice().sort();
  console.log("\n" + s);
  console.log("  TS  关键词:", tsKw.join(","));
  console.log("  n8n 关键词:", nnKw.join(","));
  console.log("  关键词一致:", JSON.stringify(tsKw) === JSON.stringify(nnKw));
  console.log("  TS  主题:", tsTp.join(","), "| n8n:", nnTp.join(","), "| 一致:", JSON.stringify(tsTp) === JSON.stringify(nnTp));
}
