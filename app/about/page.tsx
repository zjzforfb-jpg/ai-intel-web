// 纯静态文案页，无任何数据依赖：缓存一天，改动后由构建重新生成。
export const revalidate = 3600;

import { Database, Server, ShieldCheck, Workflow } from "lucide-react";
import { PageHeader, PageBody } from "@/components/PageHeader";

/** 链路四步（T9 说明页的编号步骤条） */
const PIPELINE = [
  { step: "01", label: "采集", desc: "n8n 定时抓取 AI 行业新闻源" },
  { step: "02", label: "生成", desc: "调用模型整理成结构化情报报告" },
  { step: "03", label: "入库", desc: "写入 PostgreSQL，规则抽取实体与选题" },
  { step: "04", label: "展示", desc: "本站通过只读账号查询并渲染" },
];

/** 技术栈条目 */
const STACK = [
  { icon: Workflow, label: "自动化引擎", value: "n8n（Docker Compose 自托管）" },
  { icon: Database, label: "数据存储", value: "PostgreSQL 16（命名卷持久化）" },
  { icon: Server, label: "Web 前端", value: "Next.js + TypeScript + Tailwind CSS" },
  { icon: ShieldCheck, label: "数据访问", value: "只读用户，仅 SELECT 权限" },
];

/** 安全约定 */
const SECURITY = [
  "数据库密码仅保存在后端环境变量中",
  "Web 前端不直接连接数据库",
  "API 仅提供只读接口（写操作限定本机工具）",
  "Markdown 内容经过安全过滤渲染",
  "所有服务仅绑定 127.0.0.1，不暴露到公网",
];

export default function AboutPage() {
  return (
    <PageBody>
      <PageHeader title="关于平台" subtitle="自托管的 AI 行业情报阅读平台" />

      {/* 2:1 介绍区 + 技术栈 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <section className="lg:col-span-2 card-l flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
            平台简介
          </h2>
          <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
            「每日 AI 情报内参」是一个自托管的 AI 行业情报阅读平台。
            每日通过 n8n 自动化工作流采集 AI 行业新闻、生成情报报告、
            保存到 PostgreSQL 数据库，并通过本网站展示。
          </p>
          <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
            除日报本身外，平台还从日报中派生短视频选题、商业机会与实体追踪视图，
            把「读情报」接到「用情报」。
          </p>

          {/* 链路步骤条 */}
          <div className="mt-2">
            <p className="text-[11px] text-[var(--color-text-muted)] mb-2.5">数据链路</p>
            <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {PIPELINE.map((p) => (
                <li key={p.step} className="card-s">
                  <span className="text-[10px] tnum text-[var(--color-accent-light)] font-bold">
                    {p.step}
                  </span>
                  <p className="text-[13px] font-semibold text-[var(--color-text-primary)] mt-0.5">
                    {p.label}
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)] leading-snug mt-0.5">
                    {p.desc}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="card-l flex flex-col gap-3">
          <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
            技术架构
          </h2>
          <ul className="flex flex-col gap-2.5">
            {STACK.map((s) => {
              const Icon = s.icon;
              return (
                <li key={s.label} className="flex items-start gap-2.5 min-w-0">
                  <span
                    className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center mt-0.5"
                    style={{
                      color: "var(--color-accent-light)",
                      background: "var(--color-accent-glow)",
                    }}
                    aria-hidden
                  >
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] text-[var(--color-text-muted)]">{s.label}</p>
                    <p className="text-[13px] text-[var(--color-text-secondary)] leading-snug [overflow-wrap:anywhere]">
                      {s.value}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* 数据安全 */}
      <section className="card-l flex flex-col gap-3">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          <ShieldCheck size={15} style={{ color: "var(--color-success)" }} />
          数据安全
        </h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
          {SECURITY.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 text-[13px] text-[var(--color-text-secondary)] leading-relaxed"
            >
              <span
                className="shrink-0 w-1 h-1 rounded-full mt-2"
                style={{ background: "var(--color-success)" }}
                aria-hidden
              />
              {item}
            </li>
          ))}
        </ul>
      </section>
    </PageBody>
  );
}
