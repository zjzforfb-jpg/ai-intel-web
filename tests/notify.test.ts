// 通知模块测试 —— Owner: Agent D
// 运行：node --env-file=.env.local --import tsx --test tests/notify.test.ts
// 全部请求打到 127.0.0.1 本地 mock 服务器；测试结束关闭服务器，不外发任何真实网络请求。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createNotifyWebhook,
  notifyWebhook,
  withRetry,
  makeDedupKey,
} from "@/lib/monitor/notify";
import type { CheckRun, QualityIssue } from "@/lib/monitor/types";

type Handler = (req: IncomingMessage, res: ServerResponse, hit: number) => void;

/** 起本地 mock webhook 服务器；URL 故意带 token query 用于验证脱敏 */
async function startMock(handler: Handler): Promise<{
  url: string;
  hits: () => number;
  bodies: string[];
  close: () => Promise<void>;
}> {
  const bodies: string[] = [];
  let hits = 0;
  const server = createServer((req, res) => {
    // 客户端提前断开（超时用例）时不许写响应导致未捕获错误
    res.on("error", () => {});
    hits += 1;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      bodies.push(body);
      handler(req, res, hits);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook?token=test-secret-token`,
    hits: () => hits,
    bodies,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const issueA: QualityIssue = {
  code: "SHORT_CONTENT",
  severity: "warn",
  message: "正文偏短：850 字 < 1000",
};
const issueB: QualityIssue = {
  code: "MISSING_SECTION",
  severity: "error",
  message: "缺少必需章节：商业机会",
};

function makeRun(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    checkType: "daily_quality",
    targetDate: "2026-11-06",
    status: "warn",
    summary: "2026-11-06 日报检查发现 0 项异常、1 项警告",
    issues: [issueA],
    ...overrides,
  };
}

test("成功 200 → sent；payload 含 text 与结构化精简字段", async (t) => {
  const mock = await startMock((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
  t.after(() => mock.close());

  const notify = createNotifyWebhook({ url: mock.url, sleep: async () => {} });
  const result = await notify(makeRun());

  assert.equal(result.status, "sent");
  assert.equal(mock.hits(), 1);

  const body = JSON.parse(mock.bodies[0]) as Record<string, unknown>;
  assert.equal(typeof body.text, "string");
  assert.match(String(body.text), /AI情报监控/);
  assert.equal(body.status, "warn");
  assert.equal(body.targetDate, "2026-11-06");
  assert.equal(typeof body.summary, "string");
  const issues = body.issues as Array<Record<string, string>>;
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "SHORT_CONTENT");
  assert.equal(issues[0].severity, "warn");
});

test("500 后重试 → 最终 sent（共 2 次请求、退避 1s）", async (t) => {
  const mock = await startMock((_req, res, hit) => {
    if (hit === 1) {
      res.writeHead(500);
      res.end("boom");
    } else {
      res.writeHead(200);
      res.end("{}");
    }
  });
  t.after(() => mock.close());

  const delays: number[] = [];
  const notify = createNotifyWebhook({
    url: mock.url,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  const result = await notify(makeRun());

  assert.equal(result.status, "sent");
  assert.equal(mock.hits(), 2);
  assert.deepEqual(delays, [1000]);
});

test("一直 500 → failed（重试 2 次共 3 次请求、退避 1s/2s、错误脱敏）", async (t) => {
  const mock = await startMock((_req, res) => {
    res.writeHead(500);
    res.end("boom");
  });
  t.after(() => mock.close());

  const delays: number[] = [];
  const notify = createNotifyWebhook({
    url: mock.url,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  const result = await notify(makeRun());

  assert.equal(result.status, "failed");
  assert.equal(mock.hits(), 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.ok(result.reason?.includes("500"), `reason 应含状态码：${result.reason}`);
  assert.ok(!result.reason?.includes("test-secret-token"), "reason 不得含 URL token");
  assert.ok(!result.reason?.includes("token="), "reason 不得含 token query");
});

test("超时 → failed（AbortController 中止，不抛出）", async (t) => {
  const mock = await startMock((_req, res) => {
    // 迟到的响应：客户端应已中止
    setTimeout(() => {
      res.writeHead(200);
      res.end("{}");
    }, 300);
  });
  t.after(() => mock.close());

  const notify = createNotifyWebhook({
    url: mock.url,
    timeoutMs: 100,
    retries: 0,
    sleep: async () => {},
  });
  const result = await notify(makeRun());

  assert.equal(result.status, "failed");
  assert.match(result.reason ?? "", /超时/);
  assert.equal(mock.hits(), 1);
});

test("无 MONITOR_WEBHOOK_URL → skipped，不发任何请求", async (t) => {
  const mock = await startMock((_req, res) => {
    res.writeHead(200);
    res.end("{}");
  });
  t.after(() => mock.close());

  const r1 = await createNotifyWebhook({ url: "" })(makeRun());
  assert.equal(r1.status, "skipped");
  assert.ok(r1.reason);

  // 默认导出：环境变量清空后同样 skipped
  const saved = process.env.MONITOR_WEBHOOK_URL;
  delete process.env.MONITOR_WEBHOOK_URL;
  try {
    const r2 = await notifyWebhook(makeRun());
    assert.equal(r2.status, "skipped");
    assert.ok(r2.reason);
  } finally {
    if (saved !== undefined) process.env.MONITOR_WEBHOOK_URL = saved;
  }
  assert.equal(mock.hits(), 0);
});

test("URL 非法（非 http/https 或不可解析）→ failed，不抛出", async () => {
  const r1 = await createNotifyWebhook({ url: "ftp://example.com/hook" })(
    makeRun()
  );
  assert.equal(r1.status, "failed");
  assert.ok(r1.reason?.includes("http"));

  const r2 = await createNotifyWebhook({ url: "not a url" })(makeRun());
  assert.equal(r2.status, "failed");
  assert.ok(r2.reason);
});

test("makeDedupKey 稳定性：同结论同键、与 issues 顺序无关、不同结论不同键", () => {
  // 同输入同键（多次调用稳定）
  assert.equal(makeDedupKey(makeRun()), makeDedupKey(makeRun()));

  // issues 顺序不同 → 同键
  const two = makeRun({ issues: [issueA, issueB] });
  const twoRev = makeRun({ issues: [issueB, issueA] });
  assert.equal(makeDedupKey(two), makeDedupKey(twoRev));

  // 结论不同（status / 异常码集合 / 日期）→ 不同键
  assert.notEqual(makeDedupKey(makeRun()), makeDedupKey(makeRun({ status: "error" })));
  assert.notEqual(
    makeDedupKey(makeRun()),
    makeDedupKey(
      makeRun({
        issues: [{ code: "EMPTY_CONTENT", severity: "error", message: "正文为空" }],
      })
    )
  );
  assert.notEqual(
    makeDedupKey(makeRun()),
    makeDedupKey(makeRun({ targetDate: "2026-11-05" }))
  );
});

test("withRetry：可注入 sleep，指数退避 1s/2s，重试次数正确，单次超时生效", async () => {
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };

  // 失败 2 次后成功：3 次尝试、2 次退避（1s/2s）
  let calls = 0;
  const value = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw new Error("boom");
    return "ok";
  }, { sleep });
  assert.equal(value, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);

  // 一直失败：retries=2 → 恰好 3 次尝试后抛出最后一次错误
  delays.length = 0;
  let calls2 = 0;
  await assert.rejects(
    withRetry(async () => {
      calls2 += 1;
      throw new Error("always");
    }, { retries: 2, sleep }),
    /always/
  );
  assert.equal(calls2, 3);
  assert.deepEqual(delays, [1000, 2000]);

  // 单次尝试超时 → 视为失败（此处 retries=0 直接抛出）
  await assert.rejects(
    withRetry(() => new Promise<string>(() => {}), { retries: 0, timeoutMs: 50, sleep }),
    /超时/
  );
});
