/** 实体页 URL 构造：只写非默认值，保持链接干净可分享 */
export interface EntityHrefParams {
  q?: string;
  types?: readonly string[];
  days?: number;
  page?: number;
}

export function entitiesHref(params: EntityHrefParams = {}): string {
  const sp = new URLSearchParams();
  const q = params.q?.trim();
  if (q) sp.set("q", q);
  if (params.types && params.types.length > 0) sp.set("type", params.types.join(","));
  if (params.days === 30) sp.set("days", "30");
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/entities?${qs}` : "/entities";
}
