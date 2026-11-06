// store / runner 集成测试 —— Owner: Agent B
// 运行：node --env-file=.env.local --import tsx --test tests/store.test.ts
// 连真实库（ai_intel_monitor）；测试数据 summary 一律 '__test__' 前缀，每个测试在 finally 里自清理
import { test } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  saveCheckRun,
  getRunById,
  listCheckRuns,
  getMonitorOverview,
  saveNotificationLog,
  isNotified,
  listNotifications,
  markRunNotified,
  countRecoveryNotifications,
} from "@/lib/monitor/store";
import { runChecks } from "@/lib/monitor/runner";
import { makeDedupKey } from "@/lib/monitor/notify";
import { getMonitorPool } from "@/lib/monitor/db";
import type { CheckRun, QualityIssue } from "@/lib/monitor/types";

// runChecks 测试专用的「无报告」日期（真实日报不可能存在），按 target_date 定向清理
const FAKE_DATE_1 = "1992-08-16";
const FAKE_DATE_2 = "1992-08-17";

function testRun(overrides?: Partial<CheckRun>): CheckRun {
  const tag = `__test__${randomUUID()}`;
  return {
    checkType: `${tag}-check`,
    targetDate: "2026-01-15",
    status: "warn",
    summary: `${tag} 测试运行`,
    issues: [
      { code: "SHORT_CONTENT", severity: "warn", message: `${tag} 测试问题`, meta: { length: 1 } },
    ],
    ...overrides,
  };
}

async function cleanupTestRuns(tag: string): Promise<void> {
  const pool = getMonitorPool();
  await pool.query(
    `DELETE FROM monitor_notifications WHERE run_id IN (
       SELECT id FROM monitor_runs WHERE summary LIKE '__test__%' OR summary LIKE $1
     )`,
    [`${tag}%`]
  );
  await pool.query(`DELETE FROM monitor_runs WHERE summary LIKE '__test__%' OR summary LIKE $1`, [
    `${tag}%`,
  ]);
}

async function cleanupFakeDates(): Promise<void> {
  const pool = getMonitorPool();
  // FK ON DELETE CASCADE：删 run 顺带删其 notifications
  await pool.query(
    `DELETE FROM monitor_runs WHERE target_date IN ($1::date, $2::date)`,
    [FAKE_DATE_1, FAKE_DATE_2]
  );
}

async function latestRunIdByDate(date: string): Promise<number | null> {
  const pool = getMonitorPool();
  const { rows } = await pool.query(
    `SELECT id FROM monitor_runs WHERE target_date = $1::date ORDER BY id DESC LIMIT 1`,
    [date]
  );
  return rows[0]?.id ?? null;
}

test("链路：saveCheckRun→getRunById→listCheckRuns→saveNotificationLog→isNotified→getMonitorOverview", async () => {
  const run = testRun();
  const tag = run.summary.slice(0, 42);
  try {
    const saved = await saveCheckRun(run);
    assert.ok(saved.id > 0);
    assert.strictEqual(saved.checkType, run.checkType);
    assert.strictEqual(saved.targetDate, "2026-01-15");
    assert.strictEqual(saved.status, "warn");
    assert.strictEqual(saved.summary, run.summary);
    assert.strictEqual(saved.issues.length, 1);
    assert.strictEqual((saved.issues[0] as QualityIssue).code, "SHORT_CONTENT");

    const byId = await getRunById(saved.id);
    assert.ok(byId);
    assert.strictEqual(byId.summary, run.summary);
    assert.strictEqual(byId.checkType, run.checkType);
    assert.strictEqual(await getRunById(999999999), null);

    const listed = await listCheckRuns({ checkType: run.checkType, limit: 10 });
    assert.strictEqual(listed.total, 1);
    assert.strictEqual(listed.items[0].id, saved.id);

    const inRange = await listCheckRuns({
      checkType: run.checkType,
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });
    assert.strictEqual(inRange.total, 1);
    const outRange = await listCheckRuns({
      checkType: run.checkType,
      fromDate: "2026-02-01",
      toDate: "2026-02-28",
    });
    assert.strictEqual(outRange.total, 0);

    const dedupKey = `__test__${randomUUID()}`;
    await saveNotificationLog(saved.id, dedupKey, { status: "sent" });
    assert.strictEqual(await isNotified(dedupKey), true);
    assert.strictEqual(await isNotified(`__test__missing-${randomUUID()}`), false);
    const notifs = await listNotifications(saved.id);
    assert.strictEqual(notifs.length, 1);
    assert.strictEqual(notifs[0].status, "sent");
    assert.strictEqual(notifs[0].dedup_key, dedupKey);

    const ov = await getMonitorOverview();
    assert.ok(ov.lastCheckAt === null || typeof ov.lastCheckAt === "string");
    assert.ok(ov.lastOkAt === null || typeof ov.lastOkAt === "string");
    assert.strictEqual(
      ov.statusCounts7d.ok + ov.statusCounts7d.warn + ov.statusCounts7d.error,
      ov.checks7d
    );
    assert.strictEqual(ov.statusCounts7d.error, ov.errors7d);
    assert.ok(Array.isArray(ov.recentIssues));
    assert.ok(ov.recentIssues.length <= 5);
  } finally {
    await cleanupTestRuns(tag);
  }
});

test("幂等：dedup_key 重复写入不产生重复行，markRunNotified 恢复记录同键幂等", async () => {
  const run = testRun();
  const tag = run.summary.slice(0, 42);
  try {
    const saved = await saveCheckRun(run);
    const dedupKey = `__test__${randomUUID()}`;
    await saveNotificationLog(saved.id, dedupKey, { status: "sent" });
    await saveNotificationLog(saved.id, dedupKey, { status: "sent" }); // 不抛错、不重复
    assert.strictEqual((await listNotifications(saved.id)).length, 1);

    const recKey = `__test__rec-${randomUUID()}`;
    await markRunNotified(saved.id, "sent", { dedupKey: recKey, reason: "恢复测试" });
    await markRunNotified(saved.id, "sent", { dedupKey: recKey, reason: "恢复测试" });
    assert.strictEqual((await listNotifications(saved.id)).length, 2);

    // 默认恢复键（recovery:<checkType>:<targetDate>）重复调用同样幂等
    await markRunNotified(saved.id, "sent");
    await markRunNotified(saved.id, "sent");
    const notifs = await listNotifications(saved.id);
    assert.strictEqual(notifs.length, 3);
    const recovery = notifs.filter((n) => n.dedup_key.startsWith("recovery:"));
    assert.strictEqual(recovery.length, 1);
    assert.strictEqual(recovery[0].channel, "recovery");

    // 恢复序号推算：同 (checkType, targetDate) 的历史恢复记录（含旧格式键）应计为 1
    assert.strictEqual(await countRecoveryNotifications(run.checkType, "2026-01-15"), 1);
    assert.strictEqual(await countRecoveryNotifications(run.checkType, "1999-01-01"), 0);
  } finally {
    await cleanupTestRuns(tag);
  }
});

test("saveNotificationLog upsert：failed 可补记 sent，sent 不被 failed 降级", async () => {
  const run = testRun();
  const tag = run.summary.slice(0, 42);
  try {
    const saved = await saveCheckRun(run);

    // failed 占位 → 后续 sent 补记升级
    const key1 = `__test__${randomUUID()}`;
    await saveNotificationLog(saved.id, key1, { status: "failed", reason: "首发失败" });
    assert.strictEqual(await isNotified(key1), false);
    await saveNotificationLog(saved.id, key1, { status: "sent" });
    let notifs = await listNotifications(saved.id);
    assert.strictEqual(notifs.length, 1);
    assert.strictEqual(notifs[0].status, "sent");
    assert.strictEqual(notifs[0].error, null); // 升级 sent 后 error 清空
    assert.strictEqual(await isNotified(key1), true);

    // sent → failed 不降级（sent 是终态）
    const key2 = `__test__${randomUUID()}`;
    await saveNotificationLog(saved.id, key2, { status: "sent" });
    await saveNotificationLog(saved.id, key2, { status: "failed", reason: "不应降级" });
    notifs = await listNotifications(saved.id);
    assert.strictEqual(notifs.length, 2);
    const kept = notifs.find((n) => n.dedup_key === key2);
    assert.ok(kept);
    assert.strictEqual(kept.status, "sent");
    assert.strictEqual(kept.error, null);
    assert.strictEqual(await isNotified(key2), true);
  } finally {
    await cleanupTestRuns(tag);
  }
});

test("runChecks：无报告日期返回 MISSING_REPORT 且 status=error，通知正常落库", async () => {
  await cleanupFakeDates();
  try {
    let called = 0;
    const res = await runChecks({
      targetDate: FAKE_DATE_1,
      notify: async () => {
        called += 1;
        return { status: "sent" };
      },
    });
    assert.strictEqual(res.run.targetDate, FAKE_DATE_1);
    assert.strictEqual(res.run.status, "error");
    assert.ok(res.run.issues.some((i) => i.code === "MISSING_REPORT"));
    assert.strictEqual(res.notified?.status, "sent");
    assert.strictEqual(called, 1);

    const runId = await latestRunIdByDate(FAKE_DATE_1);
    assert.ok(runId);
    const notifs = await listNotifications(runId);
    assert.strictEqual(notifs.length, 1);
    assert.strictEqual(notifs[0].status, "sent");
    assert.strictEqual(await isNotified(res.notified!.dedupKey), true);

    // 幂等：同结论再跑 → run 仍忠实新增一条记录，但通知去重跳过（回调不再被调用）
    const res2 = await runChecks({
      targetDate: FAKE_DATE_1,
      notify: async () => {
        called += 1;
        return { status: "sent" };
      },
    });
    assert.strictEqual(res2.run.status, "error");
    assert.strictEqual(res2.notified?.status, "skipped");
    assert.strictEqual(called, 1);
    const pool = getMonitorPool();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM monitor_runs WHERE target_date = $1::date`,
      [FAKE_DATE_1]
    );
    assert.strictEqual(rows[0].n, 2); // 两次执行两条 run（忠实记录）
    assert.strictEqual((await listNotifications(runId)).length, 1); // 通知只发一次
  } finally {
    await cleanupFakeDates();
  }
});

test("runChecks：skipNotify 不写 notifications", async () => {
  await cleanupFakeDates();
  try {
    const res = await runChecks({ targetDate: FAKE_DATE_2, skipNotify: true });
    assert.strictEqual(res.notified, null);
    assert.strictEqual(res.run.status, "error");
    const runId = await latestRunIdByDate(FAKE_DATE_2);
    assert.ok(runId);
    assert.strictEqual((await listNotifications(runId)).length, 0);
    assert.strictEqual(await isNotified(makeDedupKey(res.run)), false);
  } finally {
    await cleanupFakeDates();
  }
});

test("listReportFailures：表未建/未授权时优雅返回 null（FAILURE_RECORD 规则跳过，不崩）", async () => {
  const { listReportFailures } = await import("@/lib/monitor/db");
  // migration 004 应用前表不存在 → 42P01 → null；应用后且日期无记录 → 空数组；两者皆合法
  const rows = await listReportFailures("1992-08-16");
  assert.ok(rows === null || Array.isArray(rows));
});

test("清理确认：monitor_runs / monitor_notifications 无 __test__ 与测试日期残留", async () => {
  const pool = getMonitorPool();
  const t = await pool.query(
    `SELECT count(*)::int AS n FROM monitor_runs WHERE summary LIKE '__test__%'`
  );
  assert.strictEqual(t.rows[0].n, 0);
  const d = await pool.query(
    `SELECT count(*)::int AS n FROM monitor_runs WHERE target_date IN ($1::date, $2::date)`,
    [FAKE_DATE_1, FAKE_DATE_2]
  );
  assert.strictEqual(d.rows[0].n, 0);
  const n = await pool.query(
    `SELECT count(*)::int AS n FROM monitor_notifications
     WHERE dedup_key LIKE '__test__%' OR run_id IN (
       SELECT id FROM monitor_runs WHERE summary LIKE '__test__%' OR target_date IN ($1::date, $2::date)
     )`,
    [FAKE_DATE_1, FAKE_DATE_2]
  );
  assert.strictEqual(n.rows[0].n, 0);
});
