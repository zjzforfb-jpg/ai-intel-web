// 迷你逐日频次柱状缩略图（纯 SVG，固定尺寸，服务端渲染）
import type { KeywordPoint } from "@/lib/trends";

interface SparklineProps {
  points: KeywordPoint[];
  color?: string;
  width?: number;
  height?: number;
}

export function Sparkline({
  points,
  color = "#818cf8",
  width = 132,
  height = 28,
}: SparklineProps) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.count), 1);
  const n = points.length;
  const gap = 2;
  const bw = Math.max(2, (width - gap * (n - 1)) / n);
  const baseline = height - 2;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`逐日出现次数：${points
        .map((p) => `${p.date} ${p.count} 次`)
        .join("，")}`}
      style={{ display: "block" }}
      className="shrink-0 hidden sm:block"
    >
      {points.map((p, i) => {
        const h = p.count > 0 ? Math.max(2, (p.count / max) * (height - 6)) : 0;
        return (
          <rect
            key={p.date}
            x={i * (bw + gap)}
            y={baseline - h}
            width={bw}
            height={h}
            rx={1.5}
            fill={color}
            opacity={p.count > 0 ? 0.85 : 0.25}
          >
            <title>{`${p.date}：${p.count} 次`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
