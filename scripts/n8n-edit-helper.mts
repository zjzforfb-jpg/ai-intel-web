#!/usr/bin/env node
// n8n SQLite 编辑辅助脚本（主控专用，阶段 D 施工用）
// 用法：
//   node --import tsx scripts/n8n-edit-helper.mts snapshot   # 备份当前库到 /tmp/n8n-edit
//   node --import tsx scripts/n8n-edit-helper.mts verify    # 校验完整性
//   node --import tsx scripts/n8n-edit-helper.mts publish <versionId>  # 发布指定版本
//
// ⚠️ 安全流程（必须按序执行）：
//   1. docker --context orbstack stop n8n-radar
//   2. snapshot（拷三件套 + checkpoint）
//   3. 编辑 /tmp/n8n-edit/database.sqlite
//   4. docker --context orbstack cp 回拷 + chown 1000:1000 + 删旧 WAL/SHM
//   5. docker --context orbstack start n8n-radar
//   6. verify

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, rmSync } from "node:fs";

const DB_PATH = "/tmp/n8n-edit/database.sqlite";
const DOCKER = "docker --context orbstack";
const WF_ID = "ZtIAVVtWmcPLXywX";

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sqlite(sql: string): string {
  return sh(`cd /tmp/n8n-edit && sqlite3 database.sqlite ${JSON.stringify(sql)}`);
}

const cmd = process.argv[2];

switch (cmd) {
  case "snapshot": {
    mkdirSync("/tmp/n8n-edit", { recursive: true });
    for (const f of ["database.sqlite", "database.sqlite-wal", "database.sqlite-shm"]) {
      try {
        sh(`${DOCKER} cp n8n-radar:/home/node/.n8n/${f} /tmp/n8n-edit/${f}`);
      } catch {
        console.log(`  (跳过 ${f}，可能不存在)`);
      }
    }
    // 删掉 shm 让 sqlite 重建，再 checkpoint 把 WAL 合入主文件
    rmSync("/tmp/n8n-edit/database.sqlite-shm", { force: true });
    console.log("checkpoint:", sqlite("PRAGMA wal_checkpoint(TRUNCATE);"));
    console.log("integrity:", sqlite("PRAGMA integrity_check;"));
    console.log("journal_mode:", sqlite("PRAGMA journal_mode;"));
    console.log("快照完成 → /tmp/n8n-edit/database.sqlite");
    break;
  }

  case "verify": {
    if (!existsSync(DB_PATH)) {
      console.error("/tmp/n8n-edit/database.sqlite 不存在");
      process.exit(1);
    }
    console.log("integrity:", sqlite("PRAGMA integrity_check;"));
    console.log("journal_mode:", sqlite("PRAGMA journal_mode;"));
    console.log("workflows:", sqlite("SELECT count(*) FROM workflow_entity;"));
    console.log("executions:", sqlite("SELECT count(*) FROM execution_entity;"));
    console.log(
      "activeVersionId:",
      sqlite(`SELECT activeVersionId FROM workflow_entity WHERE id='${WF_ID}';`)
    );
    console.log(
      "published:",
      sqlite("SELECT publishedVersionId FROM workflow_published_version;")
    );
    const v = sqlite(`SELECT versionId FROM workflow_entity WHERE id='${WF_ID}';`);
    const nodeCount = sqlite(
      `SELECT count(*) FROM json_each((SELECT nodes FROM workflow_entity WHERE id='${WF_ID}'));`
    );
    const pubCount = sqlite(
      `SELECT count(*) FROM json_each((SELECT nodes FROM workflow_history WHERE versionId=(SELECT activeVersionId FROM workflow_entity WHERE id='${WF_ID}')));`
    );
    console.log(`draft 节点数: ${nodeCount} | active(published) 节点数: ${pubCount}`);
    if (nodeCount !== pubCount) {
      console.log("⚠️ 警告：draft 与 published 节点数不一致 —— 定时任务会跑旧版！");
    } else {
      console.log("✅ draft 与 published 节点数一致");
    }
    break;
  }

  case "publish": {
    const versionId = process.argv[3];
    if (!versionId) {
      console.error("用法：publish <versionId>");
      process.exit(1);
    }
    const exists = sqlite(
      `SELECT count(*) FROM workflow_history WHERE versionId='${versionId}';`
    );
    if (exists !== "1") {
      console.error(`版本 ${versionId} 不存在`);
      process.exit(1);
    }
    const nodeCount = sqlite(
      `SELECT count(*) FROM json_each((SELECT nodes FROM workflow_history WHERE versionId='${versionId}'));`
    );
    console.log(`准备发布 ${versionId}（${nodeCount} 节点）`);
    sqlite(
      `UPDATE workflow_entity SET activeVersionId='${versionId}' WHERE id='${WF_ID}';`
    );
    sqlite(
      `INSERT INTO workflow_published_version (workflowId, publishedVersionId)
       VALUES ('${WF_ID}', '${versionId}')
       ON CONFLICT(workflowId) DO UPDATE SET publishedVersionId=excluded.publishedVersionId, updatedAt=datetime('now');`
    );
    console.log("已更新 activeVersionId 与 workflow_published_version");
    console.log("  activeVersionId:", sqlite(`SELECT activeVersionId FROM workflow_entity WHERE id='${WF_ID}';`));
    console.log("  published:", sqlite("SELECT publishedVersionId FROM workflow_published_version;"));
    break;
  }

  default:
    console.log(`用法：
  node --import tsx scripts/n8n-edit-helper.mts snapshot
  node --import tsx scripts/n8n-edit-helper.mts verify
  node --import tsx scripts/n8n-edit-helper.mts publish <versionId>`);
}
