// 写入连接池 —— ai_intel_writer 账号，仅限 topics / opportunities 两张表的 CRUD
// 并行开发约定：只有专题追踪、商业机会管理两条线可以 import 本文件；
// 任何模块不得对 daily_reports 执行写操作（数据库权限也已拒绝，双保险）。
// 红线：全部 SQL 必须参数化；不得拼接用户输入。
import { Pool } from "pg";

let writePool: Pool | null = null;

export function getWritePool(): Pool {
  if (writePool) return writePool;

  const host = process.env.DB_HOST || "postgres";
  const port = Number(process.env.DB_PORT) || 5432;
  const user = process.env.DB_WRITE_USER || "ai_intel_writer";
  const password = process.env.DB_WRITE_PASSWORD;
  const database = process.env.DB_NAME || "ai_intelligence";

  if (!password) {
    throw new Error("DB_WRITE_PASSWORD is not set in environment");
  }

  writePool = new Pool({
    host,
    port,
    user,
    password,
    database,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: false,
  });

  return writePool;
}

// ---------- 类型定义（两条线共用，只追加不改字段） ----------

export type TopicCategory = "公司" | "模型" | "产品" | "技术";

export interface TopicRow {
  id: number;
  name: string;
  category: TopicCategory;
  keywords: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type OpportunityStatus = "待研究" | "验证中" | "已实施" | "已放弃";

export interface OpportunityRow {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  source_report_date: string | null;
  status: OpportunityStatus;
  notes: string | null;
  action_plan: string | null;
  created_at: string;
  updated_at: string;
}
