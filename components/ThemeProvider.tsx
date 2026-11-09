"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  THEME_STORAGE_KEY,
  readStoredTheme,
  resolveTheme,
  type ResolvedTheme,
  type Theme,
} from "@/lib/theme";

interface ThemeContextValue {
  /** 用户显式选择的偏好（可能是 "system"） */
  preference: Theme;
  /** 实际生效的主题 */
  resolved: ResolvedTheme;
  setPreference: (t: Theme) => void;
  /** 动效总开关（设置页控制） */
  motionEnabled: boolean;
  setMotionEnabled: (on: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MOTION_STORAGE_KEY = "ai-intel-motion";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<Theme>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("dark");
  const [prefersLight, setPrefersLight] = useState(false);
  const [motionEnabled, setMotionEnabledState] = useState(true);

  // 挂载后读取用户偏好（服务端渲染时读不到 localStorage）
  useEffect(() => {
    setPreferenceState(readStoredTheme());
    try {
      setMotionEnabledState(localStorage.getItem(MOTION_STORAGE_KEY) !== "off");
    } catch {
      setMotionEnabledState(true);
    }
  }, []);

  // 监听系统偏好变化
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e: MediaQueryListEvent) => setPrefersLight(e.matches);
    setPrefersLight(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // 偏好或系统偏好变化时，更新 <html data-theme>
  useEffect(() => {
    const next = resolveTheme(preference, prefersLight);
    setResolved(next);
    document.documentElement.setAttribute("data-theme", next);
    document.documentElement.style.colorScheme = next;
  }, [preference, prefersLight]);

  const setPreference = useCallback((t: Theme) => {
    setPreferenceState(t);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      // 存储不可用时仅保留内存态
    }
  }, []);

  const setMotionEnabled = useCallback((on: boolean) => {
    setMotionEnabledState(on);
    try {
      localStorage.setItem(MOTION_STORAGE_KEY, on ? "on" : "off");
    } catch {
      // 同上
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{ preference, resolved, setPreference, motionEnabled, setMotionEnabled }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme 必须在 ThemeProvider 内使用");
  }
  return ctx;
}
