import Link from "next/link";
import { CalendarDays, Lightbulb, SearchX, Sparkles } from "lucide-react";
import { listIdeas, countIdeas } from "@/lib/ideas";
import { isIdeaStatus, IDEA_STATUSES, type IdeaRow, type IdeaStatus } from "@/lib/ideas-shared";
import { DbErrorState } from "@/components/DbErrorState";
import { CreateIdeaSection } from "./CreateIdeaSection";
import { IdeaCard } from "./IdeaCard";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** 取查询参数的首个字符串值 */
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** 按来源日报日期分组（日期倒序），组内保持 listIdeas 的评分排序 */
function groupByDate(items: IdeaRow[]): Array<{ date: string; items: IdeaRow[] }> {
  const groups: Array<{ date: string; items: IdeaRow[] }> = [];
  const byDate = new Map<string, IdeaRow[]>();
  for (const item of items) {
    let arr = byDate.get(item.report_date);
    if (!arr) {
      arr = [];
      byDate.set(item.report_date, arr);
      groups.push({ date: item.report_date, items: arr });
    }
    arr.push(item);
  }
  return groups;
}

export default async function IdeasPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  // 非法状态一律忽略（不把非法值传给数据库）
  const statusRaw = first(sp.status);
  const status: IdeaStatus | "" = isIdeaStatus(statusRaw) ? statusRaw : "";

  let list: Awaited<ReturnType<typeof listIdeas>> | null = null;
  let total = 0;
  let dbError: string | null = null;

  try {
    [list, total] = await Promise.all([
      listIdeas({ status: status || null }),
      countIdeas(),
    ]);
  } catch (error) {
    dbError = error instanceof Error ? error.message : "数据库查询失败（未知错误）";
  }

  if (!list) {
    return (
      <DbErrorState
        title="无法读取选题"
        detail={dbError}
        hint={`可检查：Docker 中 n8n-radar-postgres 是否在运行、127.0.0.1:${process.env.DB_PORT ?? "5433"} 是否可连、数据库账号凭据是否有效。`}
      />
    );
  }

  const hasFilter = !!status;
  const groups = groupByDate(list);

  /** 构造状态筛选链接（状态空 = 全部） */
  function filterHref(s: IdeaStatus | ""): string {
    return s ? `/ideas?status=${encodeURIComponent(s)}` : "/ideas";
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4">
      {/* 页头 */}
      <div>
        <h1 className="text-[22px] lg:text-[24px] font-bold text-[var(--color-text-primary)] mb-1">
          选题提取
        </h1>
        <p className="text-[13px] text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={13} />
            共{" "}
            <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
              {total}
            </span>{" "}
            条选题
          </span>
          {hasFilter && (
            <span>
              当前筛选命中{" "}
              <span className="text-[var(--color-text-secondary)] font-medium tabular-nums">
                {list.length}
              </span>{" "}
              条
            </span>
          )}
          <span>从每日日报自动提取的短视频选题，含切入角度、素材来源与参考画面</span>
        </p>
      </div>

      {/* 新建 */}
      <CreateIdeaSection />

      {/* 状态筛选（条件进 URL query） */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["", ...IDEA_STATUSES] as const).map((s) => {
          const active = s === status;
          return (
            <Link
              key={s || "all"}
              href={filterHref(s)}
              aria-pressed={active}
              className={`inline-flex items-center px-3 py-1.5 rounded-full border text-[13px] font-medium transition-all ${
                active
                  ? "bg-[var(--color-accent)] text-white border-transparent"
                  : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {s || "全部"}
            </Link>
          );
        })}
      </div>

      {/* 按日期分组倒序的选题列表 */}
      {groups.length > 0 ? (
        groups.map((group) => (
          <section key={group.date} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-[var(--color-text-secondary)] tabular-nums">
              <CalendarDays size={14} />
              {group.date}
              <span className="text-[var(--color-text-muted)] font-normal">
                （{group.items.length} 条）
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {group.items.map((item) => (
                <IdeaCard key={item.id} idea={item} />
              ))}
            </div>
          </section>
        ))
      ) : hasFilter ? (
        <div className="glass-card p-10 text-center">
          <SearchX size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-base text-[var(--color-text-secondary)] mb-1">
            没有符合筛选条件的选题
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)] mb-5">
            试试更换状态条件，或查看全部选题。
          </p>
          <Link
            href="/ideas"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-glow)] hover:text-[var(--color-text-primary)] transition-all"
          >
            查看全部
          </Link>
        </div>
      ) : (
        <div className="glass-card p-10 text-center">
          <Lightbulb size={28} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-base text-[var(--color-text-secondary)] mb-1">
            还没有选题
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            n8n 每日日报生成后会自动提取 3-5 条选题写入这里，也可以点上方「新建选题」手动录入。
          </p>
        </div>
      )}
    </div>
  );
}
