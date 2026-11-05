// 专题追踪 —— Server Actions（写操作唯一入口）
// 客户端组件调用这些 action 完成创建/编辑/删除；服务端重新校验全部输入后再落库。
"use server";

import { revalidatePath } from "next/cache";
import { createTopic, deleteTopic, updateTopic } from "./topics-write";
import { validateTopicInput } from "./topics-input";

export type TopicActionResult =
  | { ok: true; id: number; message: string }
  | {
      ok: false;
      message: string;
      fieldErrors?: Partial<Record<"name" | "category" | "keywords" | "description", string>>;
    };

/** 创建专题 */
export async function createTopicAction(input: {
  name: string;
  category: string;
  keywords: string;
  description: string;
}): Promise<TopicActionResult> {
  const validated = validateTopicInput(input);
  if (!validated.ok)
    return { ok: false, message: "表单校验未通过，请检查填写内容", fieldErrors: validated.fieldErrors };

  const result = await createTopic(validated.value);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/topics");
  return { ok: true, id: result.topic.id, message: "专题已创建" };
}

/** 更新专题 */
export async function updateTopicAction(
  id: number,
  input: {
    name: string;
    category: string;
    keywords: string;
    description: string;
  }
): Promise<TopicActionResult> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: "无效的专题 ID" };

  const validated = validateTopicInput(input);
  if (!validated.ok)
    return { ok: false, message: "表单校验未通过，请检查填写内容", fieldErrors: validated.fieldErrors };

  const result = await updateTopic(id, validated.value);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/topics");
  revalidatePath(`/topics/${id}`);
  return { ok: true, id: result.topic.id, message: "专题已更新" };
}

/** 删除专题 */
export async function deleteTopicAction(id: number): Promise<TopicActionResult> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: "无效的专题 ID" };

  const result = await deleteTopic(id);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath("/topics");
  revalidatePath(`/topics/${id}`);
  return { ok: true, id, message: "专题已删除" };
}
