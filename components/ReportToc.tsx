"use client";

import { useEffect, useState } from "react";
import { List, ChevronDown, ChevronUp } from "lucide-react";
import type { TocItem } from "@/lib/markdown-parser";

interface ReportTocProps {
  items: TocItem[];
}

/** 当前阅读位置高亮 + 平滑锚点跳转（使用原生 <a href="#id">，保留浏览器返回/前进行为） */
export function ReportToc({ items }: ReportTocProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (items.length === 0) return;
    let raf = 0;

    const compute = () => {
      raf = 0;
      const offset = 130;
      let current = items[0].id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - offset <= 0) {
          current = item.id;
        } else {
          break;
        }
      }
      const nearBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4;
      if (nearBottom) current = items[items.length - 1].id;
      setActiveId(current);
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [items]);

  if (items.length === 0) return null;

  const linkClass = (id: string, level: number) =>
    [
      "block py-1.5 leading-snug break-words transition-colors border-l-2",
      level === 3 ? "pl-4 text-xs" : "pl-3 text-[13px]",
      activeId === id
        ? "border-[var(--color-accent)] text-[var(--color-accent-light)] font-medium"
        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",
    ].join(" ");

  return (
    <>
      {/* 桌面端：吸顶目录 */}
      <aside
        data-print-hide
        className="hidden lg:block w-60 shrink-0 sticky top-[76px] self-start max-h-[calc(100vh-100px)] overflow-y-auto pr-2"
      >
        <div className="text-xs font-semibold text-[var(--color-text-muted)] mb-2.5 tracking-widest uppercase">
          目录
        </div>
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} className={linkClass(item.id, item.level)}>
                {item.text}
              </a>
            </li>
          ))}
        </ul>
      </aside>

      {/* 移动端：可折叠目录 */}
      <div data-print-hide className="lg:hidden mb-4">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] text-[15px] text-[var(--color-text-secondary)]"
        >
          <span className="inline-flex items-center gap-2">
            <List size={16} />
            目录（{items.length}）
          </span>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {open && (
          <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] px-3 py-2">
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    onClick={() => setOpen(false)}
                    className={linkClass(item.id, item.level)}
                  >
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
