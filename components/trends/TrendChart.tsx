"use client";

// 手写 SVG 折线 / 柱状图（无任何图表依赖）
// - 容器宽度经 ResizeObserver 实测后按真实像素绘制，字体始终 ≥13px，移动端不溢出
// - 轴标签 + 网格线 + 图例 + SVG <title> 原生 tooltip；点位少时追加数值标注
// - 单数据点（仅一天日报）时画单点/单柱并标注数值，不伪造趋势线

import { useEffect, useRef, useState } from "react";

export interface TrendChartSeries {
  key: string;
  name: string;
  color: string;
  /** 与 dates 一一对应；null 表示该日无数据（不画点/柱） */
  values: (number | null)[];
}

export interface TrendChartProps {
  type: "line" | "bar";
  /** x 轴分类标签（报告日期 YYYY-MM-DD，升序） */
  dates: string[];
  series: TrendChartSeries[];
  /** y 轴含义（用于无障碍描述） */
  yLabel?: string;
  height?: number;
}

const AXIS_TEXT = "#6b7689"; // --color-text-muted
const VALUE_TEXT = "#9ba8b8"; // --color-text-secondary
const GRID_LINE = "#1e2d44"; // --color-border-subtle
const FONT_SIZE = 13; // 全局约定：字号不小于 13px

const PAD = { top: 18, right: 16, bottom: 42, left: 46 };

/** y 轴刻度步长取整（1/2/3/5/10 × 10^k，且 ≥1） */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const frac = raw / base;
  const mult = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 3 ? 3 : frac <= 5 ? 5 : 10;
  return Math.max(1, Math.round(mult * base));
}

/** 容器宽度实测（SSR 期间先按 720 绘制，挂载后修正为真实宽度） */
function useMeasuredWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.floor(el.clientWidth)));
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return [ref, width];
}

/** "2026-11-05" → "11-05" */
function shortDate(d: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(5) : d;
}

export function TrendChart({
  type,
  dates,
  series,
  yLabel = "数值",
  height = 300,
}: TrendChartProps) {
  const [ref, width] = useMeasuredWidth();

  const n = dates.length;
  const visible = series.filter((s) => s.values.some((v) => v != null));

  if (n === 0 || visible.length === 0) {
    return (
      <div
        ref={ref}
        className="flex items-center justify-center rounded-lg border border-[var(--color-border-subtle)] text-[13px] text-[var(--color-text-muted)]"
        style={{ height }}
      >
        暂无可绘制的数据
      </div>
    );
  }

  const innerW = Math.max(80, width - PAD.left - PAD.right);
  const innerH = Math.max(80, height - PAD.top - PAD.bottom);

  // y 轴刻度
  let maxV = 0;
  for (const s of visible) {
    for (const v of s.values) {
      if (v != null && v > maxV) maxV = v;
    }
  }
  const step = niceStep(maxV / 4);
  const yMax = step * 4;
  const yTicks = [0, step, step * 2, step * 3, step * 4];
  const yOf = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  // x 轴分类
  const band = innerW / n;
  const xCenter = (i: number) => PAD.left + band * (i + 0.5);
  const maxLabels = Math.max(2, Math.floor(innerW / 48));
  const labelEvery = Math.max(1, Math.ceil(n / maxLabels));

  // 数值标注策略（点/柱过多时不标，防重叠；tooltip 始终有）
  const totalMarks = n * visible.length;
  const showValues =
    n === 1
      ? true
      : type === "bar"
        ? totalMarks <= 16 && band >= 36
        : totalMarks <= 12 && band >= 34;

  // 柱状分组几何
  const groupW = Math.min(band * 0.7, 64);
  const barW = Math.max(3, (groupW - (visible.length - 1) * 3) / visible.length);

  // 数值标注防重叠：记录已画标签的 y 位置
  const drawnLabels: Array<[number, number]> = [];
  const canDrawLabel = (x: number, y: number): boolean => {
    for (const [dx, dy] of drawnLabels) {
      if (Math.abs(dx - x) < 36 && Math.abs(dy - y) < 15) return false;
    }
    drawnLabels.push([x, y]);
    return true;
  };

  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-2.5">
      {visible.map((s) => (
        <span
          key={s.key}
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text-secondary)]"
        >
          <span
            className="w-2.5 h-2.5 rounded-sm shrink-0"
            style={{ background: s.color }}
          />
          {s.name}
        </span>
      ))}
    </div>
  );

  return (
    <div ref={ref} className="w-full min-w-0">
      {legend}
      <svg
        role="img"
        aria-label={`${type === "bar" ? "柱状" : "折线"}图：${visible
          .map((s) => s.name)
          .join("、")}（${yLabel}）随日期变化`}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        style={{ display: "block" }}
      >
        {/* 水平网格线 + y 轴刻度 */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke={GRID_LINE}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={yOf(t) + FONT_SIZE / 3}
              textAnchor="end"
              style={{ fill: AXIS_TEXT, fontSize: FONT_SIZE }}
            >
              {t}
            </text>
          </g>
        ))}

        {/* x 轴 */}
        <line
          x1={PAD.left}
          x2={PAD.left + innerW}
          y1={PAD.top + innerH}
          y2={PAD.top + innerH}
          stroke={GRID_LINE}
          strokeWidth={1.5}
        />
        {dates.map((d, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text
              key={d}
              x={xCenter(i)}
              y={height - 14}
              textAnchor="middle"
              style={{ fill: AXIS_TEXT, fontSize: FONT_SIZE }}
            >
              {shortDate(d)}
            </text>
          ) : null
        )}

        {/* 数据本体 */}
        {type === "bar"
          ? visible.map((s, si) =>
              s.values.map((v, i) => {
                if (v == null) return null;
                const x =
                  xCenter(i) - groupW / 2 + si * (barW + 3);
                const y = yOf(v);
                const h = Math.max(v > 0 ? 2 : 0, PAD.top + innerH - y);
                return (
                  <g key={`${s.key}-${i}`}>
                    <rect
                      x={x}
                      y={v > 0 ? y : PAD.top + innerH}
                      width={barW}
                      height={h}
                      rx={2.5}
                      fill={s.color}
                      opacity={0.9}
                    >
                      <title>{`${dates[i]} · ${s.name}：${v}`}</title>
                    </rect>
                    {showValues && canDrawLabel(x + barW / 2, y - 8) && (
                      <text
                        x={x + barW / 2}
                        y={y - 6}
                        textAnchor="middle"
                        style={{ fill: VALUE_TEXT, fontSize: FONT_SIZE }}
                      >
                        {v}
                      </text>
                    )}
                  </g>
                );
              })
            )
          : visible.map((s) => {
              // 折线：null 处断开
              const segments: Array<Array<[number, number]>> = [];
              let cur: Array<[number, number]> = [];
              s.values.forEach((v, i) => {
                if (v == null) {
                  if (cur.length) segments.push(cur);
                  cur = [];
                } else {
                  cur.push([xCenter(i), yOf(v)]);
                }
              });
              if (cur.length) segments.push(cur);

              return (
                <g key={s.key}>
                  {segments.map((seg, gi) =>
                    seg.length > 1 ? (
                      <polyline
                        key={gi}
                        points={seg.map(([x, y]) => `${x},${y}`).join(" ")}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    ) : null
                  )}
                  {s.values.map((v, i) =>
                    v == null ? null : (
                      <g key={i}>
                        <circle
                          cx={xCenter(i)}
                          cy={yOf(v)}
                          r={3.4}
                          fill={s.color}
                        >
                          <title>{`${dates[i]} · ${s.name}：${v}`}</title>
                        </circle>
                        {showValues &&
                          canDrawLabel(xCenter(i), yOf(v) - 10) && (
                            <text
                              x={xCenter(i)}
                              y={yOf(v) - 9}
                              textAnchor="middle"
                              style={{ fill: VALUE_TEXT, fontSize: FONT_SIZE }}
                            >
                              {v}
                            </text>
                          )}
                      </g>
                    )
                  )}
                </g>
              );
            })}
      </svg>
    </div>
  );
}
