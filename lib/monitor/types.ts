// 监控模块共享契约 —— 主 Agent 维护，只追加不改字段
// 所有并行 Agent（A 规则 / B 记录 / C 界面 / D 通知 / E 测试）以此为唯一事实来源
// 约束：issues 中禁止存整篇报告正文或敏感信息；message ≤ 200 字

/** 检查结论：ok 全部通过 / warn 有警告 / error 有严重异常 */
export type CheckStatus = "ok" | "warn" | "error";

export type Severity = "warn" | "error";

/**
 * 异常类型枚举（并行约定：Agent A 可追加新码，不改已有码含义）
 * MISSING_REPORT      预期日期无报告
 * DUPLICATE_REPORT    同一 report_date 出现重复（防御性，UNIQUE 约束下应恒为空）
 * DUPLICATE_TITLE     不同日期标题+正文高度雷同（疑似重复内容）
 * EMPTY_CONTENT       正文为空/纯空白
 * SHORT_CONTENT       正文异常短（低于阈值）
 * PARSE_FAILED        Markdown 解析失败/无法切分章节
 * MISSING_SECTION     缺少必需章节（核心判断/头条/趋势/商业机会）
 * INVALID_FIELDS      必需字段缺失或非法（标题空、日期非法、计数为负等）
 * VALIDATION_FLAG     n8n validation JSONB 标志异常（has_content=false 等）
 * FUTURE_DATE         report_date 在未来
 * STALE_DATA          最近 N 天无任何新报告（覆盖性缺失）
 * CHECK_TIMEOUT       检查执行超时（MONITOR_CHECK_TIMEOUT_MS 内未完成）
 * FAILURE_RECORD      n8n 失败兜底表 report_failures 中存在该日期的失败记录
 * NOTIFY_FAILED       通知发送失败（不影响主检查）
 */
export type IssueCode =
  | "MISSING_REPORT"
  | "DUPLICATE_REPORT"
  | "DUPLICATE_TITLE"
  | "EMPTY_CONTENT"
  | "SHORT_CONTENT"
  | "PARSE_FAILED"
  | "MISSING_SECTION"
  | "INVALID_FIELDS"
  | "VALIDATION_FLAG"
  | "FUTURE_DATE"
  | "STALE_DATA"
  | "CHECK_TIMEOUT"
  | "FAILURE_RECORD"
  | "NOTIFY_FAILED";

export interface QualityIssue {
  code: IssueCode;
  severity: Severity;
  /** 人类可读诊断（≤200 字，不含报告正文） */
  message: string;
  /** 结构化细节（字段名、长度、日期等标量），禁止塞正文 */
  meta?: Record<string, string | number | boolean | null>;
}

/** 单次检查结果（对应 monitor_runs 一行） */
export interface CheckRun {
  checkType: string;
  /** 被检查的报告日期 YYYY-MM-DD；全局/覆盖性检查为 null */
  targetDate: string | null;
  status: CheckStatus;
  summary: string;
  issues: QualityIssue[];
}

/** monitor_runs 表行（含服务端生成字段） */
export interface CheckRunRow extends CheckRun {
  id: number;
  checked_at: string;
  created_at: string;
}

export type NotifyStatus = "sent" | "failed" | "skipped";

export interface NotifyResult {
  status: NotifyStatus;
  /** 失败/跳过原因（脱敏，不含密钥） */
  reason?: string;
}

/** 通知发送函数契约（Agent D 实现，Agent B 的 runner 调用） */
export type NotifyFn = (run: CheckRun) => Promise<NotifyResult>;
