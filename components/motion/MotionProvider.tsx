"use client";

import { MotionConfig } from "motion/react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * 动效总开关容器。
 *
 * 用 `<MotionConfig reducedMotion="user">` 包裹全站：
 * 用户在系统里开启「减弱动态效果」时，motion 的所有 transform / layout 动画
 * 自动降级为纯透明度变化（不产生位移），符合 WCAG 2.3.3。
 *
 * 设置页的「启用界面过渡动画」开关通过 motionEnabled 额外控制：
 * 关闭时把 transition duration 压到 0，实现「彻底不动」。
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const { motionEnabled } = useTheme();

  return (
    <MotionConfig
      reducedMotion="user"
      transition={motionEnabled ? undefined : { duration: 0 }}
    >
      {children}
    </MotionConfig>
  );
}
