import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TopicForm } from "@/components/topics/TopicForm";
import { PageHeader, PageBody } from "@/components/PageHeader";
import type { Metadata } from "next";

// 表单页本身不读库（只是渲染 TopicForm），可缓存。
export const metadata: Metadata = {
  title: "创建专题 | 每日 AI 情报内参",
  description: "填写名称与分类，添加关键词后自动关联历史日报。",
};

export const revalidate = 3600;

export default function NewTopicPage() {
  return (
    <PageBody>
      <PageHeader
        title="创建专题"
        subtitle="填写名称与分类，添加关键词后即可自动关联历史日报。"
        actions={
          <Link href="/topics" className="btn-secondary">
            <ArrowLeft size={14} />
            返回专题列表
          </Link>
        }
      />
      {/* 表单页按 T6 收窄到 720px，不满铺 */}
      <div className="w-full max-w-3xl">
        <TopicForm mode="create" />
      </div>
    </PageBody>
  );
}
