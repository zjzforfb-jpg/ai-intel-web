// 词典与词表 —— 全项目唯一真源（single source of truth）
//
// 为什么单独成文件：
//   ENTITY_VARIANTS（实体词典）、STOP_WORDS（停用词）、DOMAIN_TERMS（领域词）等
//   需要同时存在于三处：App 侧纯函数、n8n 的「实体抽取」节点、n8n 的「选题/商机去重」节点。
//   历史上这些副本靠手抄维护，已经实际漂移过（n8n 侧 STOP_WORDS 119 条 vs 本文件 185 条，
//   导致同一个标题在两侧算出不同关键词集、去重判定不一致）。
//   现在只有这一个物理位置，其余全部由脚本生成：
//     scripts/phase2-n8n-patch.mts     → 生成 NORMALIZE_JS（选题/商机去重节点）
//     scripts/phase3-n8n-entities.mts  → 生成实体抽取节点
//   一致性由 scripts/verify/lexicon-drift.mts 校验，可随时检出漂移。
//
// 硬约束（勿破坏）：
//   本文件只允许包含**纯数据字面量**，禁止 import 任何模块（含 Node 内置）、
//   禁止任何 IO 或环境相关 API。原因：n8n Code 节点沙箱只能跑字符串与正则运算，
//   本文件的数据要能被逐字内联进节点代码。
//
// 改词典的正确姿势：只改这里 → 跑 lexicon-drift 校验 → 重新 apply 两个 n8n 脚本。
// 不要再去 n8n UI 里手改节点代码，那样会被下一次 apply 覆盖。

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

export interface DomainTerm {
  /** 规范词：切分后统一使用该形式 */
  term: string;
  /** 表面形式（别名） */
  aliases: string[];
}

export interface TopicCategory {
  /** 主题标签 */
  tag: string;
  /** 触发词（规范词或实体规范名） */
  triggers: string[];
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
export const PREFIX_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
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

/**
 * 实体类型映射（契约 §3.4）：规范名 → 实体类型。
 * 表里没有的 canonical 一律 'unknown'，不猜测。
 *
 * 放在这里而不是 lib/entities-extract.ts 的原因：
 * n8n 的「实体抽取」节点也需要这张表，以前是第三处手抄副本。
 * 现在与 ENTITY_VARIANTS 同源同文件，`lexicon-drift` 会顺带校验两者是否对齐。
 */
export const ENTITY_TYPE_MAP: Readonly<Record<string, string>> = {
  // company
  openai: "company",
  anthropic: "company",
  google: "company",
  nvidia: "company",
  facebook: "company",
  microsoft: "company",
  amazon: "company",
  apple: "company",
  deepseek: "company",
  github: "company",
  "hugging face": "company",
  // ai_product
  gpt: "ai_product",
  gemini: "ai_product",
  "cosmos 3": "ai_product",
  "claude code": "ai_product",
  codex: "ai_product",
  copilot: "ai_product",
  cursor: "ai_product",
  sora: "ai_product",
  midjourney: "ai_product",
  perplexity: "ai_product",
  openrouter: "ai_product",
  qwen: "ai_product",
  llama: "ai_product",
  rivet: "ai_product",
  // technology
  mcp: "technology",
  langchain: "technology",
  kubernetes: "technology",
  postgres: "technology",
  redis: "technology",
  docker: "technology",
  pii: "technology",
  编程agent: "technology",
  // organization
  aws: "organization",
};

