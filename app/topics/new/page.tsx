import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TopicForm } from "@/components/topics/TopicForm";

// 表单页本身不读库（只是渲染 TopicForm），可缓存。
export const revalidate = 3600;

export default function NewTopicPage() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      <div>
        <Link
          href="/topics"
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <ArrowLeft size={14} />
          返回专题列表
        </Link>
        <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] mt-2 mb-1">
          创建专题
        </h1>
        <p className="text-[13px] text-[var(--color-text-muted)]">
          填写名称与分类，添加关键词后即可自动关联历史日报。
        </p>
      </div>
      <TopicForm mode="create" />
    </div>
  );
}
