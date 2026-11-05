/** /history 路由加载态（搜索/翻页导航期间显示） */
export default function HistoryLoading() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-5 flex flex-col gap-4" aria-busy="true">
      <div>
        <div className="h-7 w-40 rounded-md bg-[var(--color-bg-card)] animate-pulse mb-2" />
        <div className="h-4 w-64 rounded-md bg-[var(--color-bg-card)] animate-pulse" />
      </div>
      <div className="h-[76px] rounded-xl bg-[var(--color-bg-card)] animate-pulse" />
      <div className="h-4 w-52 rounded-md bg-[var(--color-bg-card)] animate-pulse" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[104px] rounded-xl bg-[var(--color-bg-card)] animate-pulse" />
      ))}
    </div>
  );
}
