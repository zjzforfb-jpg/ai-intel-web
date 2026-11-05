import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTopicById } from "@/lib/topics";
import { TopicForm } from "@/components/topics/TopicForm";
import { DbErrorState } from "@/components/DbErrorState";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function EditTopicPage({ params }: { params: Params }) {
  const { id: idRaw } = await params;
  // 只接受纯数字 id，非法值直接 404（不把非法值传给数据库）
  if (!/^\d+$/.test(idRaw)) notFound();
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();

  let topic: Awaited<ReturnType<typeof getTopicById>> | null = null;
  let dbError: string | null = null;
  try {
    topic = await getTopicById(id);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (dbError) return <DbErrorState title="无法读取专题" detail={dbError} />;
  if (!topic) notFound();

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      <div>
        <Link
          href={`/topics/${topic.id}`}
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <ArrowLeft size={14} />
          返回专题详情
        </Link>
        <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] mt-2 mb-1">
          编辑专题
        </h1>
        <p className="text-[13px] text-[var(--color-text-muted)] break-words">
          正在编辑「{topic.name}」
        </p>
      </div>
      <TopicForm
        mode="edit"
        topicId={topic.id}
        initial={{
          name: topic.name,
          category: topic.category,
          keywords: topic.keywords,
          description: topic.description,
        }}
      />
    </div>
  );
}
