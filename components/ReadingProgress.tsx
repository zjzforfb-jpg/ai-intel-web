"use client";

import { useEffect, useState } from "react";

/** 顶部阅读进度条：仅读取原生滚动位置，不触发任何数据请求 */
export function ReadingProgress() {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    let raf = 0;

    const compute = () => {
      raf = 0;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      const value =
        scrollable <= 0 ? 0 : Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100));
      setPercent(value);
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
  }, []);

  return (
    <div
      data-print-hide
      className="fixed left-0 top-0 z-40 h-[3px] bg-gradient-to-r from-indigo-500 via-indigo-400 to-blue-400 transition-[width] duration-150 ease-out"
      style={{ width: `${percent}%` }}
      aria-hidden="true"
    />
  );
}
