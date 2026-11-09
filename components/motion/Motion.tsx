"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValueEvent, useSpring } from "motion/react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * 全站动效原语。
 *
 * 设计约束（来自全局规范）：
 *  - 动效只做「引导视线」，不做「表演」：位移 ≤ 8px，时长 180–220ms。
 *  - 列表入场用 stagger；总时长封顶 —— 长列表逐项延迟会让用户等到最后一屏。
 *  - 所有动效必须能被 prefers-reduced-motion 与设置页开关关闭。
 *
 * 这些是 client 组件，Server Component 页面可以直接引用，
 * 不需要把页面本身改成 client。
 */

/** 页面级淡入：轻微上移 + 淡入 */
export function PageFade({ children }: { children: React.ReactNode }) {
  const { motionEnabled } = useTheme();
  if (!motionEnabled) return <>{children}</>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** 列表容器：子项依次入场 */
export function StaggerList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { motionEnabled } = useTheme();
  if (!motionEnabled) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: 0.03, delayChildren: 0.02 },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

/** 列表子项：配合 StaggerList 使用 */
export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { motionEnabled } = useTheme();
  if (!motionEnabled) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 6 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

/** 可悬停卡片：抬升 2px */
export function HoverCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { motionEnabled } = useTheme();
  if (!motionEnabled) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/**
 * 指标数值：进入视口时从 0 滚动到目标值。
 * 只用于指标卡的单个数字；长列表里不要用（会互相打断）。
 *
 * 实现说明：用 useSpring 驱动一个 motion value，再用 useMotionValueEvent
 * 把弹簧值同步到 state 渲染成文本。不用 CSS 变量是因为那需要 @property 注册，
 * 在 Tailwind v4 / Turbopack 下不可靠。
 */
export function CountUp({
  value,
  suffix = "",
  decimals = 0,
  className,
}: {
  value: number;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const { motionEnabled } = useTheme();
  // useSpring 由物理参数驱动（stiffness/damping），不接受 ease/duration
  const spring = useSpring(0, { stiffness: 90, damping: 20, mass: 0.8 });
  const [display, setDisplay] = useState(0);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  // 视口检测：进入后才启动，避免首屏之外的数字空转
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "-40px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 依赖变化时重置
  useEffect(() => {
    if (!motionEnabled || !Number.isFinite(value)) return;
    spring.set(0);
    setDisplay(0);
  }, [value, motionEnabled, spring]);

  // 到达视口且动效开启 → 启动弹簧
  useEffect(() => {
    if (!motionEnabled || !inView || !Number.isFinite(value)) return;
    spring.set(value);
  }, [inView, motionEnabled, value, spring]);

  useMotionValueEvent(spring, "change", (v) => {
    setDisplay(v);
  });

  const shown = motionEnabled && Number.isFinite(value) ? display : value;

  return (
    <span ref={ref} className={`tnum ${className ?? ""}`}>
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  );
}
