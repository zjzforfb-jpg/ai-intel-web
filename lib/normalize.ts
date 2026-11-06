// 轻量文本归一化 —— 为语义去重提供统一的文本特征
//
// 设计约束（重要，主控在阶段 D 需要把本文件逐函数移植到 n8n 的 Code 节点）：
// - 本文件严禁 import 任何 Node 内置模块或第三方库，只用字符串与正则运算；
// - 不使用 Intl.Segmenter 等环境相关 API，中文切分采用「领域词典最长匹配 + 2~4 字片段回退」；
// - 所有可调参数（实体变体表、领域词典、主题分类表、停用词表）都以常量导出，便于 n8n 侧同步。
//
// 归一化流程（与契约 docs/phase2-stageB-interface.md 第 3.1 节规则清单一一对应）：
//   全半角 → 中英标点统一 → 英文小写 → 空格收敛 → 营销修饰词去除
//   → 无意义前缀去除 → 实体名变体合并 → 剔除标点
//
// 提取维度：
//   - keywords：领域词典命中的规范词（权重 1.0）+ 未登录中文 2~4 字片段 / 英文词（权重 0.5）
//   - entities：实体变体表命中的规范名（公司 / 产品 / 技术名）
//   - topics：主题分类表命中的主题标签（用于「同主题」判定）

/** 归一化后的文本特征 */
export interface NormalizedText {
  /** 完全归一化后的小写文本（用于精确比较） */
  text: string;
  /** 提取的关键词集合（已去重、去停用词） */
  keywords: string[];
  /** 提取的重要实体（公司/产品/技术名等） */
  entities: string[];
  /** 提取的主题标签（用于主题相似度） */
  topics: string[];
}

/* ==================== 实体变体表（可扩展，n8n 侧需同步） ==================== */

export interface EntityVariant {
  /** 规范名：归一化后统一使用该形式 */
  canonical: string;
  /** 所有变体（大小写不敏感匹配） */
  variants: string[];
  /**
   * 强相关实体（同公司 / 同产品线 / 同概念族）：
   * 共享时视为「弱实体命中」，与契约第 3.3 节第 3 步同路径处理
   */
  related?: string[];
}

export const ENTITY_VARIANTS: readonly EntityVariant[] = [
  {
    canonical: "claude code",
    variants: ["claude code", "claude-code", "claudecode", "claude code cli", "claudecodecli"],
    related: ["anthropic", "编程agent"],
  },
  { canonical: "anthropic", variants: ["anthropic"], related: ["claude code"] },
  {
    canonical: "codex",
    variants: ["codex", "codex cli", "openai codex", "openai-codex"],
    related: ["openai", "编程agent"],
  },
  { canonical: "openai", variants: ["openai", "open ai", "open-ai"], related: ["codex", "gpt"] },
  {
    canonical: "gpt",
    variants: ["gpt", "gpt-4", "gpt-5", "gpt4", "gpt5", "chatgpt"],
    related: ["openai"],
  },
  { canonical: "google", variants: ["google", "谷歌"], related: ["gemini"] },
  {
    canonical: "gemini",
    variants: ["gemini", "gemini omni", "gemini omni 1.2 flash", "google gemini"],
    related: ["google"],
  },
  { canonical: "nvidia", variants: ["nvidia", "英伟达"], related: ["cosmos 3"] },
  {
    canonical: "cosmos 3",
    variants: ["cosmos 3", "cosmos3", "cosmos-3", "nvidia cosmos 3"],
    related: ["nvidia"],
  },
  { canonical: "facebook", variants: ["facebook", "meta", "fb"] },
  { canonical: "rivet", variants: ["rivet"] },
  { canonical: "microsoft", variants: ["microsoft", "微软"], related: ["copilot"] },
  { canonical: "copilot", variants: ["copilot"], related: ["microsoft"] },
  { canonical: "amazon", variants: ["amazon", "亚马逊"], related: ["aws"] },
  { canonical: "aws", variants: ["aws"], related: ["amazon"] },
  { canonical: "apple", variants: ["apple", "苹果"] },
  { canonical: "deepseek", variants: ["deepseek", "深度求索"] },
  { canonical: "qwen", variants: ["qwen", "通义千问", "通义"] },
  { canonical: "llama", variants: ["llama", "llama 3"] },
  { canonical: "cursor", variants: ["cursor"] },
  { canonical: "github", variants: ["github", "git hub"] },
  { canonical: "hugging face", variants: ["hugging face", "huggingface"] },
  { canonical: "langchain", variants: ["langchain"] },
  { canonical: "mcp", variants: ["mcp", "model context protocol"] },
  { canonical: "kubernetes", variants: ["kubernetes", "k8s"] },
  { canonical: "postgres", variants: ["postgres", "postgresql"] },
  { canonical: "redis", variants: ["redis"] },
  { canonical: "docker", variants: ["docker"] },
  { canonical: "perplexity", variants: ["perplexity"] },
  { canonical: "midjourney", variants: ["midjourney"] },
  { canonical: "sora", variants: ["sora"] },
  { canonical: "openrouter", variants: ["openrouter"] },
  {
    // 「编程类 Agent」家族：中文语境里同一件事的多种说法（不含裸 Agent，裸 Agent 过于泛化）
    canonical: "编程agent",
    variants: [
      "ai编程agent",
      "ai 编程agent",
      "编码agent",
      "代码agent",
      "编程agent",
      "ai编程工具",
      "ai编程神器",
      "ai编程助手",
    ],
    related: ["codex", "claude code"],
  },
  { canonical: "pii", variants: ["pii"] },
];

/* ==================== 领域词典（可扩展，n8n 侧需同步） ==================== */

export interface DomainTerm {
  /** 规范词：切分后统一使用该形式 */
  term: string;
  /** 表面形式（别名） */
  aliases: string[];
}

export const DOMAIN_TERMS: readonly DomainTerm[] = [
  /* —— 隐私与安全 —— */
  { term: "隐私", aliases: ["隐私"] },
  { term: "脱敏", aliases: ["脱敏"] },
  { term: "泄露", aliases: ["泄露", "泄漏", "外泄", "泄密"] },
  { term: "审计", aliases: ["审计"] },
  { term: "出站", aliases: ["出站", "网络出口", "出口流量", "数据出口", "出网"] },
  { term: "网关", aliases: ["网关"] },
  { term: "代理", aliases: ["代理"] },
  { term: "白名单", aliases: ["白名单"] },
  { term: "域名", aliases: ["域名"] },
  { term: "拦截", aliases: ["拦截", "阻断"] },
  { term: "敏感", aliases: ["敏感"] },
  { term: "加密", aliases: ["加密"] },
  { term: "权限", aliases: ["权限"] },
  { term: "身份", aliases: ["身份", "认证", "鉴权"] },
  { term: "合规", aliases: ["合规"] },
  { term: "风控", aliases: ["风控"] },
  { term: "漏洞", aliases: ["漏洞"] },
  { term: "攻击", aliases: ["攻击"] },
  { term: "防护", aliases: ["防护"] },
  { term: "防火墙", aliases: ["防火墙"] },
  { term: "审查", aliases: ["审查"] },
  { term: "令牌", aliases: ["令牌"] },
  { term: "邮箱", aliases: ["邮箱", "邮件地址"] },
  { term: "邮件", aliases: ["邮件"] },
  { term: "证书", aliases: ["证书"] },
  { term: "密钥", aliases: ["密钥"] },
  { term: "供应链", aliases: ["供应链"] },
  { term: "检测", aliases: ["检测", "扫描"] },
  { term: "监控", aliases: ["监控"] },
  { term: "溯源", aliases: ["溯源"] },
  { term: "风险", aliases: ["风险"] },
  { term: "风险控", aliases: [] },
  /* —— 成本与价格 —— */
  { term: "成本", aliases: ["成本"] },
  { term: "便宜", aliases: ["便宜", "廉价"] },
  { term: "价格", aliases: ["价格", "定价", "报价"] },
  { term: "降价", aliases: ["降价", "降本"] },
  { term: "费用", aliases: ["费用", "收费", "计费"] },
  { term: "预算", aliases: ["预算"] },
  { term: "性价比", aliases: ["性价比"] },
  { term: "省钱", aliases: ["省钱"] },
  { term: "涨价", aliases: ["涨价"] },
  { term: "账单", aliases: ["账单"] },
  /* —— 评测与对比 —— */
  { term: "评测", aliases: ["评测", "测评"] },
  { term: "基准", aliases: ["基准"] },
  { term: "对比", aliases: ["对比"] },
  { term: "效率", aliases: ["效率"] },
  { term: "准确率", aliases: ["准确率"] },
  { term: "成功率", aliases: ["成功率"] },
  { term: "质量", aliases: ["质量"] },
  { term: "指标", aliases: ["指标"] },
  { term: "榜单", aliases: ["榜单"] },
  { term: "复现", aliases: ["复现"] },
  { term: "评估", aliases: ["评估"] },
  { term: "性能", aliases: ["性能"] },
  { term: "跑分", aliases: ["跑分"] },
  { term: "工作流", aliases: ["工作流"] },
  /* —— 模型与发布 —— */
  { term: "模型", aliases: ["模型", "大模型"] },
  { term: "发布", aliases: ["发布"] },
  { term: "开源", aliases: ["开源"] },
  { term: "权重", aliases: ["权重"] },
  { term: "版本", aliases: ["版本"] },
  { term: "上线", aliases: ["上线"] },
  { term: "微调", aliases: ["微调"] },
  { term: "蒸馏", aliases: ["蒸馏"] },
  { term: "参数", aliases: ["参数"] },
  { term: "能力", aliases: ["能力"] },
  { term: "生态", aliases: ["生态"] },
  /* —— 仿真与训练 —— */
  { term: "仿真", aliases: ["仿真"] },
  { term: "训练场", aliases: ["训练场"] },
  { term: "合成数据", aliases: ["合成数据", "数据合成"] },
  { term: "世界模型", aliases: ["世界模型"] },
  { term: "机器人", aliases: ["机器人", "具身"] },
  { term: "训练", aliases: ["训练"] },
  /* —— 平台治理与内容风控 —— */
  { term: "广告", aliases: ["广告"] },
  { term: "深伪", aliases: ["深伪", "深度伪造"] },
  { term: "诈骗", aliases: ["诈骗", "欺诈"] },
  { term: "治理", aliases: ["治理"] },
  { term: "审核", aliases: ["审核"] },
  { term: "违规", aliases: ["违规"] },
  { term: "监管", aliases: ["监管"] },
  { term: "标注", aliases: ["标注"] },
  { term: "换脸", aliases: ["换脸"] },
  { term: "争议", aliases: ["争议"] },
  { term: "指控", aliases: ["指控"] },
  { term: "平台", aliases: ["平台"] },
  { term: "诉讼", aliases: ["诉讼"] },
  { term: "侵权", aliases: ["侵权"] },
  { term: "版权", aliases: ["版权"] },
  { term: "金额", aliases: ["金额", "亿美元"] },
  /* —— 部署与运维 —— */
  { term: "部署", aliases: ["部署"] },
  { term: "托管", aliases: ["托管"] },
  { term: "运维", aliases: ["运维"] },
  { term: "编排", aliases: ["编排"] },
  { term: "迁移", aliases: ["迁移"] },
  { term: "容器", aliases: ["容器"] },
  { term: "休眠", aliases: ["休眠", "睡觉"] },
  { term: "扩容", aliases: ["扩容", "弹性"] },
  { term: "集群", aliases: ["集群"] },
  { term: "备份", aliases: ["备份"] },
  { term: "恢复", aliases: ["恢复"] },
  { term: "架构", aliases: ["架构"] },
  { term: "可观测", aliases: ["可观测"] },
  { term: "长任务", aliases: ["长任务"] },
  { term: "长周期", aliases: ["长周期"] },
  { term: "轻量", aliases: ["轻量"] },
  { term: "状态", aliases: ["状态"] },
  { term: "服务", aliases: ["服务"] },
  { term: "无服务器", aliases: ["无服务器"] },
  /* —— 内部工具定制 —— */
  { term: "内部", aliases: ["内部"] },
  { term: "工具", aliases: ["工具", "小工具"] },
  { term: "定制", aliases: ["定制"] },
  { term: "看板", aliases: ["看板"] },
  { term: "报表", aliases: ["报表"] },
  { term: "流程", aliases: ["流程"] },
  { term: "自动化", aliases: ["自动化"] },
  { term: "排班", aliases: ["排班"] },
  { term: "工单", aliases: ["工单"] },
  { term: "垂直", aliases: ["垂直"] },
  { term: "交付", aliases: ["交付"] },
  { term: "订阅", aliases: ["订阅"] },
  { term: "项目", aliases: ["项目"] },
  { term: "业务", aliases: ["业务"] },
  { term: "场景", aliases: ["场景"] },
  { term: "需求", aliases: ["需求"] },
  { term: "提效", aliases: ["提效"] },
  { term: "运营", aliases: ["运营"] },
  /* —— 算力与性能 —— */
  { term: "gpu", aliases: ["gpu"] },
  { term: "cpu", aliases: ["cpu"] },
  { term: "算力", aliases: ["算力"] },
  { term: "显卡", aliases: ["显卡"] },
  { term: "芯片", aliases: ["芯片"] },
  { term: "hbm", aliases: ["hbm"] },
  { term: "内存", aliases: ["内存"] },
  { term: "瓶颈", aliases: ["瓶颈"] },
  { term: "延迟", aliases: ["延迟", "变慢"] },
  { term: "吞吐", aliases: ["吞吐"] },
  { term: "存储", aliases: ["存储"] },
  { term: "带宽", aliases: ["带宽"] },
  /* —— 多模态创作 —— */
  { term: "视频", aliases: ["视频"] },
  { term: "图像", aliases: ["图像"] },
  { term: "多模态", aliases: ["多模态"] },
  { term: "剪辑", aliases: ["剪辑"] },
  { term: "生成", aliases: ["生成"] },
  { term: "创作", aliases: ["创作"] },
  { term: "内容", aliases: ["内容"] },
  { term: "音频", aliases: ["音频"] },
  { term: "画质", aliases: ["画质"] },
  { term: "一致性", aliases: ["一致性"] },
  /* —— 开发工具 —— */
  { term: "编程", aliases: ["编程"] },
  { term: "代码", aliases: ["代码"] },
  { term: "编码", aliases: ["编码"] },
  { term: "开发者", aliases: ["开发者"] },
  { term: "开发", aliases: ["开发"] },
  { term: "工具链", aliases: ["工具链"] },
  { term: "仓库", aliases: ["仓库"] },
  { term: "重构", aliases: ["重构"] },
  { term: "调试", aliases: ["调试"] },
  { term: "插件", aliases: ["插件"] },
  /* —— 路由与调度 —— */
  { term: "路由", aliases: ["路由"] },
  { term: "调度", aliases: ["调度"] },
  { term: "聚合", aliases: ["聚合"] },
  { term: "多模型", aliases: ["多模型"] },
  { term: "兜底", aliases: ["兜底"] },
  { term: "中转", aliases: ["中转"] },
  /* —— 长文本与上下文 —— */
  { term: "上下文", aliases: ["上下文"] },
  { term: "长上下文", aliases: ["长上下文"] },
  { term: "记忆", aliases: ["记忆"] },
  { term: "缓存", aliases: ["缓存"] },
  { term: "窗口", aliases: ["窗口"] },
  { term: "截断", aliases: ["截断"] },
  { term: "更长", aliases: ["更长"] },
  { term: "长片段", aliases: ["长片段"] },
  { term: "长文本", aliases: ["长文本"] },
  { term: "长文", aliases: ["长文"] },
  /* —— 通用名词 —— */
  { term: "团队", aliases: ["团队"] },
  { term: "中小", aliases: ["中小", "中小企业"] },
  { term: "企业", aliases: ["企业"] },
  { term: "行业", aliases: ["行业"] },
  { term: "市场", aliases: ["市场"] },
  { term: "用户", aliases: ["用户"] },
  { term: "方案", aliases: ["方案"] },
  { term: "产品", aliases: ["产品"] },
  { term: "技术", aliases: ["技术"] },
  { term: "公司", aliases: ["公司"] },
  { term: "数据", aliases: ["数据"] },
  { term: "请求", aliases: ["请求"] },
  { term: "日志", aliases: ["日志"] },
  { term: "配置", aliases: ["配置"] },
  { term: "报告", aliases: ["报告"] },
  { term: "落地", aliases: ["落地"] },
];

/* ==================== 主题分类表（可扩展，n8n 侧需同步） ==================== */

export interface TopicCategory {
  /** 主题标签 */
  tag: string;
  /** 触发词（规范词或实体规范名） */
  triggers: string[];
}

export const TOPIC_CATEGORIES: readonly TopicCategory[] = [
  {
    tag: "隐私安全",
    triggers: [
      "隐私", "脱敏", "泄露", "审计", "出站", "网关", "代理", "白名单", "拦截", "敏感",
      "加密", "权限", "身份", "合规", "风控", "漏洞", "攻击", "防护", "防火墙", "审查",
      "令牌", "邮箱", "邮件", "证书", "密钥", "供应链", "检测", "监控", "溯源", "pii", "域名",
    ],
  },
  {
    tag: "成本价格",
    triggers: ["成本", "便宜", "价格", "降价", "费用", "预算", "性价比", "省钱", "涨价", "账单"],
  },
  {
    tag: "评测对比",
    triggers: ["评测", "基准", "对比", "效率", "准确率", "成功率", "质量", "指标", "榜单", "复现", "评估", "性能", "跑分"],
  },
  {
    tag: "模型发布",
    triggers: ["模型", "发布", "开源", "权重", "版本", "上线", "微调", "蒸馏", "参数", "能力", "gemini", "openai", "gpt", "google", "anthropic", "cosmos 3"],
  },
  {
    tag: "仿真训练",
    triggers: ["仿真", "训练场", "合成数据", "世界模型", "机器人", "训练", "nvidia"],
  },
  {
    tag: "平台治理",
    triggers: ["广告", "深伪", "诈骗", "治理", "审核", "违规", "监管", "标注", "换脸", "争议", "指控", "平台", "诉讼", "侵权", "版权", "金额", "facebook"],
  },
  {
    tag: "部署运维",
    triggers: ["部署", "托管", "运维", "编排", "迁移", "容器", "休眠", "扩容", "集群", "备份", "恢复", "架构", "可观测", "长任务", "长周期", "轻量", "状态", "服务", "无服务器", "rivet"],
  },
  {
    tag: "工具定制",
    triggers: ["内部", "定制", "看板", "报表", "流程", "自动化", "排班", "工单", "垂直", "交付", "订阅", "项目", "业务", "场景", "需求", "提效", "运营", "工作流"],
  },
  {
    tag: "算力性能",
    triggers: ["gpu", "cpu", "算力", "显卡", "芯片", "hbm", "内存", "瓶颈", "延迟", "吞吐", "存储", "带宽"],
  },
  {
    tag: "多模态创作",
    triggers: ["视频", "图像", "多模态", "剪辑", "生成", "创作", "内容", "音频", "画质", "一致性"],
  },
  {
    tag: "开发工具",
    triggers: ["编程", "代码", "编码", "开发者", "开发", "工具链", "仓库", "重构", "调试", "插件", "编程agent", "claude code", "codex", "cursor", "copilot", "microsoft"],
  },
  {
    tag: "路由调度",
    triggers: ["路由", "调度", "聚合", "多模型", "兜底", "中转"],
  },
  {
    tag: "长文本",
    triggers: ["上下文", "长上下文", "记忆", "缓存", "窗口", "截断", "更长", "长片段", "长文本", "长文"],
  },
];

/* ==================== 停用词 / 无意义前缀 / 营销修饰词 ==================== */

/**
 * 停用词：功能词 + 口语填充词。
 * - 完整词条：切分出的片段命中则整段丢弃（例如「突然」「其实」「关键」）；
 * - 单字条目：既是停用词，也用作中文片段的「切分字符」（片段内含这些字则丢弃）。
 */
export const STOP_WORDS: readonly string[] = [
  // 中文功能词
  "的", "了", "是", "在", "和", "与", "及", "或", "也", "都", "就", "还", "又", "更", "最", "很", "太",
  "挺", "但", "却", "而", "并", "把", "被", "让", "使", "给", "从", "向", "到", "对", "为", "以", "于",
  "其", "之", "这", "那", "哪", "什", "么", "怎", "样", "如", "何", "谁", "仍", "已", "将", "曾", "正",
  "刚", "才", "只", "再", "各", "某", "该", "本", "此", "一", "个", "些", "点", "种", "类", "位", "名",
  "次", "有", "没", "不", "未", "非", "无",
  // 口语 / 冗余修饰
  "十分", "非常", "真的", "其实", "竟然", "居然", "到底", "究竟", "据悉", "报道", "据", "所谓",
  "突然", "悄悄", "偷偷", "千万", "万万", "吗", "呢", "吧", "啊", "呀", "哦", "嗯", "嘛",
  "哪些", "什么样", "这份", "仍待", "实操", "清单", "翻车", "炸裂", "炸锅", "神器",
  "可能", "也许", "大概", "基本", "完全", "值得", "需要", "建议", "请问", "我们", "你们", "大家",
  // 英文功能词
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "for", "with", "is", "are",
  "was", "were", "be", "been", "it", "its", "this", "that", "these", "those", "as", "at", "by",
  "from", "we", "you", "they", "he", "she", "not", "no", "yes", "do", "does", "did", "has", "have",
  "had", "will", "would", "can", "could", "should", "may", "might", "must", "so", "than", "then",
  "there", "here", "what", "when", "where", "which", "who", "how", "why",
];

/**
 * 通用词（权重 0.5）：出现在大量标题里，单独出现不构成「同一件事」的证据。
 * 权重越低，关键词重合度越容易被「泛用词」撑起来。
 */
export const WEAK_KEYWORDS: readonly string[] = [
  "ai", "agent", "app", "api", "sdk", "cli", "llm", "saas", "web", "system", "tool", "model",
];

/** 无意义前缀：出现在标题开头时直接删除（契约 3.1 节清单 + 常见补充） */
export const MEANINGLESS_PREFIXES: readonly string[] = [
  "为什么", "怎么样", "怎么办", "有没有", "是不是", "究竟", "到底", "请问", "大家",
  "如何", "怎样", "怎么", "什么", "是否", "可以", "能否", "一个", "关于", "针对", "基于",
  "通过", "值得", "需要", "建议", "其实", "用", "做", "的", "了", "吗", "呢",
];

/** 前缀删除的例外：前缀后面紧跟这些字时说明是另一个词，不能删 */
const PREFIX_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  用: ["户", "途", "例", "工", "语", "事", "量", "时", "心", "意", "情", "场", "法", "电", "药", "款", "品"],
  做: ["法", "空", "出"],
  的: ["确"],
  了: ["解", "结", "事", "然"],
  开: ["发", "源", "始", "放"],
  是: ["否"],
  会: ["计", "员"],
};

/** 营销修饰词：整篇剔除（契约 3.1 节清单 + 常见补充） */
export const MARKETING_MODIFIERS: readonly string[] = [
  "重磅", "最新", "独家", "深度", "终极", "全新", "最强", "必看", "实测", "亲测", "免费",
  "限时", "推荐", "抢先", "揭秘", "突发", "刚刚", "首次", "罕见", "最全", "最细", "一文读懂",
  "全解析", "干货", "收藏", "必存", "手把手", "保姆级", "惊呆", "震撼", "刷屏", "霸榜",
];

/* ==================== 内部词典索引 ==================== */

interface DictEntry {
  term: string;
  kind: "entity" | "term";
}

const DICT = new Map<string, DictEntry>();
let MAX_ALIAS_LEN = 1;

function addAlias(alias: string, term: string, kind: "entity" | "term"): void {
  if (!alias) return;
  const key = alias.toLowerCase();
  const existed = DICT.get(key);
  // 实体优先于普通领域词
  if (existed && existed.kind === "entity") return;
  DICT.set(key, { term, kind });
  if (key.length > MAX_ALIAS_LEN) MAX_ALIAS_LEN = key.length;
}

for (const e of ENTITY_VARIANTS) {
  for (const v of e.variants) addAlias(v, e.canonical, "entity");
}
for (const t of DOMAIN_TERMS) {
  for (const a of t.aliases) addAlias(a, t.term, "term");
}

/** 主题分类 → 触发词集合 */
const TOPIC_TRIGGER_MAP = new Map<string, Set<string>>();
for (const c of TOPIC_CATEGORIES) {
  TOPIC_TRIGGER_MAP.set(c.tag, new Set(c.triggers));
}

/** 实体 → 强相关实体（双向展开，便于任一侧查询） */
const ENTITY_RELATED_MAP = new Map<string, Set<string>>();
function linkRelated(a: string, b: string): void {
  const setA = ENTITY_RELATED_MAP.get(a) ?? new Set<string>();
  setA.add(b);
  ENTITY_RELATED_MAP.set(a, setA);
  const setB = ENTITY_RELATED_MAP.get(b) ?? new Set<string>();
  setB.add(a);
  ENTITY_RELATED_MAP.set(b, setB);
}
for (const e of ENTITY_VARIANTS) {
  for (const r of e.related ?? []) linkRelated(e.canonical, r);
}

const STOP_WORD_SET = new Set(STOP_WORDS);
const WEAK_KEYWORD_SET = new Set(WEAK_KEYWORDS);
/** 片段切分字符：中文单字停用词 */
const FRAGMENT_CUT_CHARS = new Set(
  STOP_WORDS.filter((w) => w.length === 1 && /[\u3400-\u9fff]/.test(w))
);

/* ==================== 基础归一化工具 ==================== */

const CJK_PATTERN = "[\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]";
const RE_CJK = new RegExp(CJK_PATTERN);
const RE_LATIN_NUM = /[a-z0-9]/;

function isCjk(ch: string): boolean {
  return ch.length > 0 && RE_CJK.test(ch);
}

function isLatinNum(ch: string): boolean {
  return ch.length > 0 && RE_LATIN_NUM.test(ch);
}

/** 全角 → 半角（含全角空格与全角标点、数字） */
export function toHalfWidth(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x3000) {
      out += " ";
      continue;
    }
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
      continue;
    }
    out += ch;
  }
  return out;
}

/** 中英标点混用统一（契约 3.1 节：全角标点 → 半角，冒号/等号/逗号统一） */
const PUNCT_MAP: Readonly<Record<string, string>> = {
  "、": ",",
  "。": ".",
  "，": ",",
  "；": ";",
  "：": ":",
  "！": "!",
  "？": "?",
  "（": "(",
  "）": ")",
  "【": "[",
  "】": "]",
  "《": "<",
  "》": ">",
  "「": '"',
  "」": '"',
  "『": '"',
  "』": '"',
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "—": "-",
  "–": "-",
  "―": "-",
  "−": "-",
  "～": "~",
  "·": "-",
  "•": "-",
  "・": "-",
  "…": "...",
  "‥": "...",
  "∶": ":",
  "＝": "=",
};

/** 标点统一：把各类中文标点映射成 ASCII 标点 */
export function unifyPunctuation(input: string): string {
  let out = "";
  for (const ch of input) {
    out += PUNCT_MAP[ch] ?? ch;
  }
  return out;
}

/** 空格收敛：中文字符间空格全部去除；中文与英文/数字间空格去除；英文单词间保留单空格 */
export function tightenSpaces(input: string): string {
  let out = input;
  let prev = "";
  let guard = 0;
  while (prev !== out && guard < 8) {
    prev = out;
    out = out.replace(new RegExp(`(${CJK_PATTERN})\\s+(?=${CJK_PATTERN})`, "g"), "$1");
    out = out.replace(new RegExp(`(${CJK_PATTERN})\\s+(?=[a-z0-9])`, "g"), "$1");
    out = out.replace(new RegExp(`([a-z0-9])\\s+(?=${CJK_PATTERN})`, "g"), "$1");
    guard++;
  }
  // 标点两侧的空格一律收敛为「标点紧贴文字」：
  // 全角冒号与半角冒号在归一化后必须得到同一个结果，
  // 否则「ＡＩ Agent：测试」与「AI Agent: 测试」会算出不同的 text。
  out = out.replace(/\s+([,.:;!?)\]}])/g, "$1");
  out = out.replace(/([([{])\s+/g, "$1");
  // 标点前的空格也要去掉（含中英混排时英文侧的空格）
  out = out.replace(/([,.:;!?)\]}])\s+(?=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffa-z0-9])/g, "$1");
  return out.replace(/\s+/g, " ").trim();
}

/** 剔除营销修饰词（整篇） */
export function stripMarketingModifiers(input: string): string {
  let out = input;
  for (const w of MARKETING_MODIFIERS) {
    if (out.includes(w)) out = out.split(w).join("");
  }
  return out;
}

/** 标题开头的装饰性标点（!/！?？.。、,，:：等），剥离前缀前先去掉 */
const LEADING_DECORATION = /^[\s!！?？.。、,，:：;；~～\-—_"'“”‘’《》【】()（）\[\]]+/;

/**
 * 剔除标题开头的无意义前缀（可连续剔除）
 * 前置处理：先剥掉开头的装饰性标点，
 * 否则「！如何做Agent工具」这类「标点 + 前缀」的写法会绕过前缀剥离。
 */
export function stripMeaninglessPrefixes(input: string): string {
  let out = input.trim().replace(LEADING_DECORATION, "").trim();
  let changed = true;
  let guard = 0;
  while (changed && guard < 12) {
    changed = false;
    guard++;
    for (const p of MEANINGLESS_PREFIXES) {
      if (!out.startsWith(p)) continue;
      const next = out.charAt(p.length);
      const exceptions = PREFIX_EXCEPTIONS[p];
      if (exceptions && next && exceptions.includes(next)) continue;
      out = out.slice(p.length).trim();
      changed = true;
      break;
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 实体变体合并：把所有变体统一替换成规范名（大小写不敏感匹配） */
export function mergeEntityVariants(input: string): string {
  let out = input;
  // 长变体优先，避免「claude code」被更短的变体抢先匹配
  const all: Array<{ variant: string; canonical: string }> = [];
  for (const e of ENTITY_VARIANTS) {
    for (const v of e.variants) all.push({ variant: v.toLowerCase(), canonical: e.canonical });
  }
  all.sort((a, b) => b.variant.length - a.variant.length);
  for (const { variant, canonical } of all) {
    // 大小写不敏感的前置判断，避免「Meta」「OPEN AI」等写法漏匹配
    if (!out.toLowerCase().includes(variant)) continue;
    const escaped = escapeRegExp(variant);
    // 纯拉丁变体加词边界；含中文的变体不加（中文与英文之间没有词边界概念）
    // 正则带 i 标志，保证「Meta」与「meta」都能命中
    const pattern = RE_CJK.test(variant)
      ? new RegExp(escaped, "gi")
      : new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "gi");
    out = out.replace(pattern, canonical);
  }
  return out;
}

/** 基础归一化：全半角 → 标点统一 → 小写 → 空格 → 营销词 → 前缀 → 实体合并 → 剔除标点 */
function basicNormalize(input: unknown): string {
  if (input == null) return "";
  let s = typeof input === "string" ? input : String(input);
  if (!s.trim()) return "";
  s = toHalfWidth(s);
  s = unifyPunctuation(s);
  s = s.toLowerCase();
  s = tightenSpaces(s);
  s = stripMarketingModifiers(s);
  s = stripMeaninglessPrefixes(s);
  s = mergeEntityVariants(s);
  // 剔除剩余标点，只保留字母数字与中文
  s = s.replace(new RegExp(`[^a-z0-9${CJK_PATTERN}\\s]`, "g"), " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/* ==================== 切分 ==================== */

export interface TokenizeResult {
  tokens: string[];
  entities: string[];
}

/**
 * 领域词典最长匹配切分（无外部依赖，可等价移植到 n8n）：
 * - 命中实体别名 → 产出实体规范名；
 * - 命中领域词别名 → 产出规范词；
 * - 未命中的英文串 → 作为英文词产出（长度 ≥ 2）；
 * - 未命中的中文串 → 按单字停用词切分后，取 2~4 字片段产出（更长的丢弃，避免稀释相似度）。
 */
export function tokenize(input: unknown): TokenizeResult {
  const text = basicNormalize(input);
  const tokens: string[] = [];
  const entities: string[] = [];
  if (!text) return { tokens, entities };

  let i = 0;
  let cjkRun = "";

  const flushCjk = (): void => {
    if (!cjkRun) return;
    const run = cjkRun;
    cjkRun = "";
    for (const seg of splitByCutChars(run)) {
      if (seg.length >= 2 && seg.length <= 4 && !STOP_WORD_SET.has(seg)) tokens.push(seg);
    }
  };

  while (i < text.length) {
    const firstCh = text.charAt(i);
    const prevCh = i > 0 ? text.charAt(i - 1) : "";
    // 拉丁词需要词边界；中文词不需要（中文与英文之间没有词边界概念）
    const canStartHere = isLatinNum(firstCh) ? !isLatinNum(prevCh) : true;
    let matched = false;
    if (canStartHere) {
      const maxLen = Math.min(MAX_ALIAS_LEN, text.length - i);
      for (let len = maxLen; len >= 1; len--) {
        const slice = text.slice(i, i + len);
        const hit = DICT.get(slice);
        if (!hit) continue;
        flushCjk();
        tokens.push(hit.term);
        if (hit.kind === "entity") entities.push(hit.term);
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (isCjk(firstCh)) {
      cjkRun += firstCh;
      i++;
      continue;
    }
    flushCjk();
    if (isLatinNum(firstCh)) {
      let j = i;
      while (
        j < text.length &&
        (isLatinNum(text.charAt(j)) || text.charAt(j) === "." || text.charAt(j) === "_" || text.charAt(j) === "-")
      ) {
        j++;
      }
      const word = text.slice(i, j).replace(/[._-]+$/, "");
      if (word.length >= 2) tokens.push(word);
      i = j;
      continue;
    }
    i++;
  }
  flushCjk();
  return { tokens, entities };
}

/** 按单字停用词切分中文片段 */
function splitByCutChars(run: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of run) {
    if (FRAGMENT_CUT_CHARS.has(ch)) {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/* ==================== 对外接口 ==================== */

/**
 * 轻量归一化：大小写、空格标点、中英混合、无意义前缀、营销修饰词
 * 不依赖 embedding / 向量库 / 外部 API
 */
export function normalizeText(input: string): NormalizedText {
  const text = basicNormalize(input);
  const { tokens, entities } = tokenize(input);
  const keywords = dedupe(tokens.filter((t) => !STOP_WORD_SET.has(t)));
  const entityList = dedupe(entities);
  const topics = topicsOf(keywords, entityList);
  return { text, keywords, entities: entityList, topics };
}

/**
 * 仅做标题级归一化，返回可直接用于唯一性比较的字符串
 * 规则：去营销前缀、去标点空白、统一全半角、统一大小写、实体名变体合并
 */
export function normalizeTitle(title: string): string {
  return basicNormalize(title).replace(/\s+/g, "");
}

/**
 * 提取重要实体（公司名、产品名、技术名等）
 */
export function extractEntities(text: string): string[] {
  const { entities } = tokenize(text);
  return dedupe(entities);
}

/**
 * 提取关键词（中文按领域词典切分 + 未登录片段 2~4 字 + 英文按词切分，去停用词）
 */
export function extractKeywords(text: string): string[] {
  const { tokens } = tokenize(text);
  return dedupe(tokens.filter((t) => !STOP_WORD_SET.has(t)));
}

/**
 * 提取主题标签（用于「同主题」判定）
 */
export function extractTopics(text: string): string[] {
  const { tokens, entities } = tokenize(text);
  const keywords = dedupe(tokens.filter((t) => !STOP_WORD_SET.has(t)));
  return topicsOf(keywords, dedupe(entities));
}

/** 实体弱关联关系查询（共享 related 时视为弱实体命中） */
export function relatedEntities(entity: string): string[] {
  return Array.from(ENTITY_RELATED_MAP.get(entity) ?? []);
}

/** 关键词权重：领域词 / 实体 = 1.0，通用词 = 0.5 */
export function keywordWeight(keyword: string): number {
  return WEAK_KEYWORD_SET.has(keyword) ? 0.5 : 1;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function topicsOf(keywords: string[], entities: string[]): string[] {
  const pool = new Set<string>([...keywords, ...entities]);
  const tags: string[] = [];
  for (const c of TOPIC_CATEGORIES) {
    const triggers = TOPIC_TRIGGER_MAP.get(c.tag);
    if (!triggers) continue;
    for (const t of pool) {
      if (triggers.has(t)) {
        tags.push(c.tag);
        break;
      }
    }
  }
  return tags;
}
