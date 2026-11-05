// 商业机会 REST API —— 集合端点：GET 列表（筛选/分页）、POST 新建
import { NextResponse } from "next/server";
import {
  listOpportunities,
  getOpportunityFacets,
  createOpportunity,
} from "@/lib/opportunities";
import {
  isOpportunityStatus,
  validateOpportunity,
  type OpportunityStatus,
} from "@/lib/opportunities-shared";

export const dynamic = "force-dynamic";

function badRequest(errors: Record<string, string>) {
  return NextResponse.json({ ok: false, errors }, { status: 400 });
}

/** GET /api/opportunities?status=&category=&page=&size= */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status");
  const categoryRaw = (url.searchParams.get("category") ?? "").trim();
  const pageRaw = url.searchParams.get("page");
  const sizeRaw = url.searchParams.get("size");

  let status: OpportunityStatus | null = null;
  if (statusRaw !== null && statusRaw !== "") {
    if (!isOpportunityStatus(statusRaw)) {
      return badRequest({ status: "状态必须是 待研究 / 验证中 / 已实施 / 已放弃 之一" });
    }
    status = statusRaw;
  }

  const parsePositive = (v: string | null): number | null | "error" => {
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) return "error";
    return n;
  };
  const page = parsePositive(pageRaw);
  const size = parsePositive(sizeRaw);
  if (page === "error") return badRequest({ page: "页码必须是正整数" });
  if (size === "error") return badRequest({ size: "每页条数必须是正整数" });

  try {
    const [list, facets] = await Promise.all([
      listOpportunities({
        status,
        category: categoryRaw || null,
        page: page ?? undefined,
        size: size ?? undefined,
      }),
      getOpportunityFacets({ status, category: categoryRaw || null }),
    ]);
    return NextResponse.json({ ok: true, ...list, facets });
  } catch (error) {
    console.error("[api/opportunities] GET failed:", error);
    return NextResponse.json(
      {
        ok: false,
        errors: { form: "数据库查询失败" },
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/** POST /api/opportunities */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest({ form: "请求体不是合法 JSON" });
  }

  const result = validateOpportunity(body, "create");
  if (!result.ok) {
    return badRequest(result.errors as Record<string, string>);
  }

  try {
    const item = await createOpportunity(result.value);
    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (error) {
    console.error("[api/opportunities] POST failed:", error);
    return NextResponse.json(
      {
        ok: false,
        errors: { form: "数据库写入失败" },
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
