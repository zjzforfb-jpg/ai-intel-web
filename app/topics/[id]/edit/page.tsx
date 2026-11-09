import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTopicById } from "@/lib/topics";
import { TopicForm } from "@/components/topics/TopicForm";
import { DbErrorState } from "@/components/DbErrorState";
import { PageHeader, PageBody } from "@/components/PageHeader";

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
    <PageBody>
      <PageHeader
        title="编辑专题"
        subtitle={<>正在编辑「{topic.name}」</>}
        actions={
          <Link href={`/topics/${topic.id}`} className="btn-secondary">
            <ArrowLeft size={14} />
            返回专题详情
          </Link>
        }
      />
      <div className="w-full max-w-3xl">
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
    </PageBody>
  );
}
