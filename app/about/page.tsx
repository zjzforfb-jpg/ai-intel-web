export const dynamic = "force-dynamic";

export default function AboutPage() {
  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl">
      <h1 className="text-xl font-bold text-[var(--color-text-primary)] mb-6">
        关于平台
      </h1>

      <div className="space-y-4">
        <div className="glass-card p-6">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
            平台简介
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
            「每日 AI 情报内参」是一个自托管的 AI 行业情报阅读平台。
            每日通过 n8n 自动化工作流采集 AI 行业新闻、生成情报报告、
            保存到 PostgreSQL 数据库，并通过本网站展示。
          </p>
        </div>

        <div className="glass-card p-6">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
            技术架构
          </h2>
          <ul className="space-y-1.5 text-sm text-[var(--color-text-secondary)]">
            <li>• 自动化引擎：n8n（Docker Compose 自托管）</li>
            <li>• 数据存储：PostgreSQL 16（Docker 命名卷持久化）</li>
            <li>• Web 前端：Next.js + TypeScript + Tailwind CSS</li>
            <li>• 数据库连接：只读用户，仅 SELECT 权限</li>
            <li>• 部署方式：Docker Compose，仅本机访问</li>
          </ul>
        </div>

        <div className="glass-card p-6">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">
            数据安全
          </h2>
          <ul className="space-y-1.5 text-sm text-[var(--color-text-secondary)]">
            <li>• 数据库密码仅保存在后端环境变量中</li>
            <li>• Web 前端不直接连接数据库</li>
            <li>• API 仅提供只读接口</li>
            <li>• Markdown 内容经过安全过滤渲染</li>
            <li>• 所有服务仅绑定 127.0.0.1，不暴露到公网</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
