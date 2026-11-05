// 监控 REST API —— 检查记录列表：GET /api/monitor/runs?status=&limit=&offset=
// 只暴露必要信息：错误响应为通用文案，详情仅记录到服务端 console
import { NextResponse } from "next/server";
import { listCheckRuns } from "@/lib/monitor/store";
import { isCheckStatus, toApiRow } from "@/components/monitor/run-utils";
import type { CheckStatus } from "@/lib/monitor/types";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 50;

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

/** GET /api/monitor/runs?status=&limit=&offset= → { ok, items, total } */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status");
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");

  let status: CheckStatus | undefined;
  if (statusRaw !== null && statusRaw !== "") {
    if (!isCheckStatus(statusRaw)) {
      return badRequest("status 必须是 ok / warn / error 之一");
    }
    status = statusRaw;
  }

  const parseNonNegative = (v: string | null): number | null | "error" => {
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return "error";
    return n;
  };

  const limit = parseNonNegative(limitRaw);
  const offset = parseNonNegative(offsetRaw);
  if (limit === "error" || (limit !== null && limit < 1)) {
    return badRequest("limit 必须是 1~50 的整数");
  }
  if (offset === "error") {
    return badRequest("offset 必须是非负整数");
  }

  try {
    const { items, total } = await listCheckRuns({
      status,
      limit: limit === null ? undefined : Math.min(limit, MAX_LIMIT),
      offset: offset === null ? undefined : offset,
    });
    return NextResponse.json({ ok: true, items: items.map(toApiRow), total });
  } catch (error) {
    console.error("[api/monitor/runs] 查询失败:", error);
    return NextResponse.json(
      { ok: false, error: "监控数据查询失败，请稍后重试" },
      { status: 500 }
    );
  }
}
