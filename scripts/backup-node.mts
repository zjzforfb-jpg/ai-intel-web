/**
 * AI 情报平台每日自动备份（Node 版，launchd 入口）
 *
 * 为什么不用 backup.sh（zsh）：
 *   2026-11-09 实测，macOS launchd agent 上下文中 /bin/zsh 对外接卷的
 *   open()/write() 一律被 TCC 拒绝（报 "can't open input file" /
 *   "operation not permitted"），与 WorkingDirectory、路径写法无关；
 *   而 node 的 fs.stat/read/write 正常，git 二进制也正常。
 *   探针矩阵结论：5 种 WorkingDirectory × {zsh, node} 中，
 *   zsh 全部被拒、node 全部成功。
 *   → 因此备份逻辑整体改用 Node 实现，launchd 直接跑本文件。
 *
 * 产物（14 天保留，位于 AIINTEL_BACKUP_DIR，默认 $HOME/WorkBuddyData/backups/aiintel/）：
 *   db/pg_ai_intelligence_YYYY-MM-DD.sql.gz   PostgreSQL 全量（由 sidecar 容器 crond 产出）
 *   n8n_sqlite_YYYY-MM-DD.sqlite              n8n 工作流库（WAL 感知一致快照）
 *   ai_intel_web_code_YYYY-MM-DD.bundle       git 全 refs 打包
 *
 * 路径可移植性：
 *   所有路径均来自环境变量，不写死任何机器的个人目录名。
 *   AIINTEL_REPO         仓库根目录（默认由本文件位置自推导）
 *   AIINTEL_BACKUP_DIR   备份输出目录（默认 $HOME/WorkBuddyData/backups/aiintel）
 *   AIINTEL_N8N_CONTAINER / AIINTEL_PG_CONTAINER  容器名
 *   launchd 场景请在 plist 的 EnvironmentVariables 里注入这些变量。
 *
 * 设计原则（延续 zsh 版）：
 *   1. 任一步失败必须以非零码退出，否则 launchd 永远看到成功。
 *   2. 备份"写完"不等于"备份可用"：每步都要验证产物内容，不能只看退出码。
 *   3. pg_dump 由容器 sidecar 独占，本脚本只校验其当日产物；缺失/损坏时才自己补做。
 *
 * 手动验证：npm run backup:run; echo "exit=$?"
 */
import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------------
// 路径与运行时配置（全部可被环境变量覆盖，见文件头说明）
// ------------------------------------------------------------------
function envOr(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : fallback;
}

/** 仓库根目录：优先 AIINTEL_REPO，否则由本文件位置向上两级自推导 */
function resolveRepoRoot(): string {
  const fromEnv = envOr("AIINTEL_REPO", "");
  if (fromEnv) return path.resolve(fromEnv);
  // 本文件位于 <repo>/scripts/backup-node.mts
  // 注意：必须用 fileURLToPath 解码，不能直接用 URL.pathname ——
  // pathname 会把中文与空格留成 %20 / %E6... 的 URL 编码，路径就失效了。
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

const BK = path.resolve(
  envOr("AIINTEL_BACKUP_DIR", path.join(os.homedir(), "WorkBuddyData", "backups", "aiintel"))
);
const AIWEB = resolveRepoRoot();
const LOG = path.join(BK, "backup.log");
const RETENTION_DAYS = 14;
const N8N_CONTAINER = envOr("AIINTEL_N8N_CONTAINER", "n8n-radar");
const PG_CONTAINER = envOr("AIINTEL_PG_CONTAINER", "n8n-radar-postgres");

function ts(): string {
  // 与 zsh 版一致：本地时区（宿主 TZ=Asia/Shanghai）
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

function log(msg: string): void {
  fs.appendFileSync(LOG, `[${ts()}] ${msg}\n`);
}

function fail(msg: string): never {
  log(`FAILED: ${msg}`);
  console.error(`FAILED: ${msg}`);
  process.exit(1);
}

function day(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1024 / 1024).toFixed(0)}M`;
}

/** 运行命令，返回 { ok, stdout, stderr } */
function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; input?: Buffer } = {}
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    input: opts.input,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout ? r.stdout.toString("utf8") : "",
    stderr: r.stderr ? r.stderr.toString("utf8") : "",
    status: r.status,
  };
}

async function main(): Promise<void> {
  const D = day();
  const sidecarPg = path.join(BK, "db", `pg_ai_intelligence_${D}.sql.gz`);
  const hostPg = path.join(BK, `pg_ai_intelligence_${D}.sql.gz`);
  const tmpPg = `${sidecarPg}.tmp`;

  fs.mkdirSync(path.join(BK, "db"), { recursive: true });

  const head = run("git", ["-C", AIWEB, "rev-parse", "--short", "HEAD"]);
  log(`===== backup start (HEAD ${head.stdout.trim() || "unknown"}) =====`);

  // ----------------------------------------------------------------
  // 1. PostgreSQL 全量：校验 sidecar 当日产物；缺失或损坏才自己补
  // ----------------------------------------------------------------
  let pgOk = 0;
  const sidecarValid = (() => {
    if (!fs.existsSync(sidecarPg)) return false;
    try {
      // gzip -t 等价校验：完整解压一遍并确认结尾标记
      const done = spawnSync(
        "sh",
        ["-c", `gzip -dc ${JSON.stringify(sidecarPg)} | tail -5`],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
      );
      return done.status === 0 && done.stdout.includes("PostgreSQL database dump complete");
    } catch {
      return false;
    }
  })();

  if (sidecarValid) {
    log(
      `pg_dump OK (sidecar): ${path.basename(sidecarPg)} (${humanSize(fs.statSync(sidecarPg).size)})`
    );
    pgOk = 1;
  } else {
    log("pg_dump: sidecar 当日产物缺失或不可用，本脚本补做");
    const dump = spawnSync(
      "docker",
      [
        "exec",
        PG_CONTAINER,
        "sh",
        "-c",
        'pg_dump -U "$POSTGRES_USER" "${POSTGRES_DB:-ai_intelligence}"',
      ],
      { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }
    );
    if (dump.status === 0 && dump.stdout.length > 0) {
      // 用 gzip 压缩后写盘
      const gz = spawnSync("gzip", ["-c"], { input: dump.stdout, maxBuffer: 256 * 1024 * 1024 });
      if (gz.status === 0) {
        fs.writeFileSync(tmpPg, gz.stdout);
        const chk = run("sh", ["-c", `gzip -dc ${JSON.stringify(tmpPg)} | tail -5`]);
        if (chk.stdout.includes("PostgreSQL database dump complete")) {
          fs.renameSync(tmpPg, sidecarPg);
          log(
            `pg_dump OK (fallback): ${path.basename(sidecarPg)} (${humanSize(fs.statSync(sidecarPg).size)})`
          );
          pgOk = 1;
        } else {
          fs.rmSync(tmpPg, { force: true });
          log("pg_dump FAILED: dump 内容不完整");
        }
      } else {
        fs.rmSync(tmpPg, { force: true });
        log("pg_dump FAILED: gzip 返回非零");
      }
    } else {
      fs.rmSync(tmpPg, { force: true });
      log("pg_dump FAILED: pg_dump 返回非零或无输出");
    }
  }
  void hostPg;

  // ----------------------------------------------------------------
  // 2. n8n SQLite：拷三件套，用 node:sqlite backup API 生成一致快照
  // ----------------------------------------------------------------
  let sqliteOk = 0;
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "aiintel_n8n_bak_"));
  try {
    const mainFile = path.join(TMP, "database.sqlite");
    const cpMain = run("docker", ["cp", `${N8N_CONTAINER}:/home/node/.n8n/database.sqlite`, mainFile]);
    if (cpMain.ok && fs.existsSync(mainFile)) {
      // wal/shm 可能不存在（正常 checkpoint 后），失败不算错
      run("docker", ["cp", `${N8N_CONTAINER}:/home/node/.n8n/database.sqlite-wal`, `${mainFile}-wal`]);
      run("docker", ["cp", `${N8N_CONTAINER}:/home/node/.n8n/database.sqlite-shm`, `${mainFile}-shm`]);

      const src = new DatabaseSync(mainFile);
      const snapPath = path.join(TMP, "snapshot.sqlite");
      await backup(src, snapPath);
      src.close();

      // 快照必须能被完整性检查，避免留下一个"打不开的备份"
      const dest = new DatabaseSync(snapPath, { readOnly: true });
      const chk = dest.prepare("PRAGMA integrity_check;").get() as Record<string, string>;
      dest.close();
      const verdict = chk?.integrity_check;
      if (verdict !== "ok") {
        log(`n8n sqlite FAILED: snapshot integrity_check = ${verdict}`);
      } else {
        const outFile = path.join(BK, `n8n_sqlite_${D}.sqlite`);
        // copy 而非 rename：/tmp 与 /Volumes 跨文件系统
        fs.copyFileSync(snapPath, outFile);
        log(
          `n8n sqlite OK: ${path.basename(outFile)} (${humanSize(fs.statSync(outFile).size)})`
        );
        sqliteOk = 1;
      }
    } else {
      log("n8n sqlite FAILED: 无法从容器拷出 database.sqlite");
    }
  } catch (e) {
    log(`n8n sqlite FAILED: ${(e as Error).message}`);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  // ----------------------------------------------------------------
  // 3. 代码 git bundle（全 refs）+ 记录覆盖到哪个提交
  // ----------------------------------------------------------------
  let bundleOk = 0;
  const bundleFile = path.join(BK, `ai_intel_web_code_${D}.bundle`);
  const bundleTmp = `${bundleFile}.tmp`;
  try {
    const b = run("git", ["-C", AIWEB, "bundle", "create", bundleTmp, "--all"]);
    if (b.ok) {
      const headSha = run("git", ["-C", AIWEB, "rev-parse", "main"]).stdout.trim();
      const heads = run("git", ["bundle", "list-heads", bundleTmp]);
      if (heads.stdout.includes(headSha)) {
        fs.renameSync(bundleTmp, bundleFile);
        log(
          `git bundle OK: ${path.basename(bundleFile)} (${humanSize(fs.statSync(bundleFile).size)}) covers main=${headSha}`
        );
        bundleOk = 1;
      } else {
        fs.rmSync(bundleTmp, { force: true });
        log(`git bundle FAILED: bundle 未包含当前 main (${headSha})`);
      }
    } else {
      fs.rmSync(bundleTmp, { force: true });
      log(`git bundle FAILED: ${b.stderr.trim().slice(0, 200)}`);
    }
  } catch (e) {
    fs.rmSync(bundleTmp, { force: true });
    log(`git bundle FAILED: ${(e as Error).message}`);
  }

  // ----------------------------------------------------------------
  // 4. 清理过期备份（先计数再删，如实记录删了几条）
  // ----------------------------------------------------------------
  let removed = 0;
  const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
  for (const pattern of ["n8n_sqlite_*.sqlite", "ai_intel_web_code_*.bundle"]) {
    for (const f of fs.readdirSync(BK)) {
      if (!f.startsWith(pattern.split("*")[0])) continue;
      const fp = path.join(BK, f);
      try {
        const st = fs.statSync(fp);
        if (st.isFile() && st.mtimeMs < cutoff) {
          fs.rmSync(fp, { force: true });
          removed++;
        }
      } catch {
        /* 忽略 */
      }
    }
  }
  // pg 的 retention 归 sidecar 管（它也在 db/ 下清理）
  log(`retention removed=${removed} (threshold ${RETENTION_DAYS}d)`);

  // ----------------------------------------------------------------
  // 5. 结论：三项全成才算成功
  // ----------------------------------------------------------------
  const summary = `pg=${pgOk} sqlite=${sqliteOk} bundle=${bundleOk}`;
  if (pgOk === 1 && sqliteOk === 1 && bundleOk === 1) {
    log(`===== backup OK (${summary}) =====`);
    console.log(`backup OK (${summary})`);
    process.exit(0);
  } else {
    log(`===== backup FAILED (${summary}) =====`);
    console.error(`backup FAILED: ${summary}`);
    process.exit(1);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  try {
    log(`===== backup FAILED (${msg}) =====`);
  } catch {
    /* 日志都写不了就只能输出到 stderr */
  }
  console.error(`backup FAILED: ${msg}`);
  process.exit(1);
});
