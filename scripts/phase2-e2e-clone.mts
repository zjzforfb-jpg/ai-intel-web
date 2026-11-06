#!/usr/bin/env node
// 阶段 D 端到端测试辅助：创建/删除「临时克隆工作流」
//
// 为什么需要它：
//   n8n CLI `execute --id=...` 只接受 Execute Workflow Trigger 作为入口节点，
//   CR-01 用的是 Schedule Trigger，CLI 直接跑会报 "Missing node to start execution"。
//   为了不污染正式工作流，这里复制一份克隆：节点、连接、prompt 全部一致，
//   仅把 Schedule Trigger 换成 Execute Workflow Trigger。
//
// 用法：
//   node scripts/phase2-e2e-clone.mts create   # 创建克隆，打印 id
//   node scripts/phase2-e2e-clone.mts drop     # 删除克隆
//   node scripts/phase2-e2e-clone.mts list     # 列出克隆
//
// 前提：n8n-radar 容器已停止，/tmp/n8n-edit/database.sqlite 为最新快照。

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const DB_DIR = "/tmp/n8n-edit";
const SRC_WF = "ZtIAVVtWmcPLXywX";
const CLONE_PREFIX = "E2E-CLONE-";

function sh(cmd: string, input?: string): string {
  return execSync(cmd, {
    encoding: "utf-8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    input,
  }).trim();
}

function sqlite(sql: string): string {
  return sh(`cd ${DB_DIR} && sqlite3 database.sqlite`, `${sql}\n`);
}

function sqlLit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

const mode = process.argv[2] ?? "list";

if (mode === "list") {
  console.log(sqlite(`SELECT id, name, active FROM workflow_entity WHERE name LIKE '${CLONE_PREFIX}%';`) || "(无克隆)");
  process.exit(0);
}

if (mode === "drop") {
  const ids = sqlite(`SELECT id FROM workflow_entity WHERE name LIKE '${CLONE_PREFIX}%';`)
    .split("\n")
    .filter(Boolean);
  if (ids.length === 0) {
    console.log("没有需要删除的克隆工作流");
    process.exit(0);
  }
  for (const id of ids) {
    // 先删 workflow_history（外键 RESTRICT 需先解除 activeVersionId 引用）
    sqlite(`UPDATE workflow_entity SET activeVersionId=NULL WHERE id='${id}';`);
    sqlite(`DELETE FROM workflow_published_version WHERE workflowId='${id}';`);
    sqlite(`DELETE FROM workflow_history WHERE workflowId='${id}';`);
    sqlite(`DELETE FROM shared_workflow WHERE workflowId='${id}';`);
    sqlite(`DELETE FROM workflow_entity WHERE id='${id}';`);
    console.log("已删除克隆:", id);
  }
  console.log("integrity:", sqlite("PRAGMA integrity_check;"));
  process.exit(0);
}

if (mode !== "create") {
  console.error("用法: create | drop | list");
  process.exit(1);
}

/* ------------------------- create ------------------------- */

// 读当前生效版本的节点与连接（用 sqlite3 -json，避免手工拼接 JSON）
const wfRaw = sh(
  `cd ${DB_DIR} && sqlite3 -json database.sqlite "SELECT nodes, connections, name FROM workflow_entity WHERE id='${SRC_WF}';"`
);
const wf = JSON.parse(wfRaw)[0] as { nodes: string; connections: string; name: string };
const nodes = JSON.parse(wf.nodes) as Array<Record<string, any>>;
const connections = JSON.parse(wf.connections) as Record<string, any>;

// 把 Schedule Trigger 换成 Execute Workflow Trigger（CLI 唯一认可的入口）
//   inputSource: "passthrough" —— 不需要预先声明输入字段，直接放行一条空数据
let replaced = 0;
for (const n of nodes) {
  if (n.type === "n8n-nodes-base.scheduleTrigger") {
    n.type = "n8n-nodes-base.executeWorkflowTrigger";
    n.typeVersion = 1.1;
    n.parameters = { inputSource: "passthrough" };
    n.name = "When Executed by Another Workflow";
    delete n.retryOnFail;
    delete n.maxTries;
    delete n.waitBetweenTries;
    replaced++;
  }
}
if (replaced === 0) {
  throw new Error("源工作流里没有找到 Schedule Trigger 节点，克隆终止");
}

// 连接表里的源节点名要同步改
if (connections["Schedule Trigger"]) {
  connections["When Executed by Another Workflow"] = connections["Schedule Trigger"];
  delete connections["Schedule Trigger"];
}

const cloneId = randomUUID();
const cloneName = `${CLONE_PREFIX}${new Date().toISOString().slice(0, 19)}`;
const now = new Date().toISOString();

// 1) workflow_entity（active=0，不参与定时调度）
//    versionId / activeVersionId 都指向下面自建的 history 行，避免引用源工作流的版本
sqlite(`
INSERT INTO workflow_entity
  (id, name, active, nodes, connections, settings, staticData, pinData, versionId,
   triggerCount, meta, createdAt, updatedAt, isArchived, versionCounter, description,
   activeVersionId, nodeGroups)
SELECT
  '${cloneId}', ${sqlLit(cloneName)}, 0,
  ${sqlLit(JSON.stringify(nodes))}, ${sqlLit(JSON.stringify(connections))},
  settings, staticData, pinData, '${cloneId}',
  1, meta, ${sqlLit(now)}, ${sqlLit(now)}, 0, 1,
  '阶段 D 端到端测试用临时克隆，验证完即删除',
  '${cloneId}', nodeGroups
FROM workflow_entity WHERE id='${SRC_WF}';
`);

// 2) workflow_history（让 workflow_entity.nodes 与 history 一致）
sqlite(`
INSERT INTO workflow_history
  (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description, nodeGroups)
SELECT
  '${cloneId}', '${cloneId}', 'e2e', ${sqlLit(now)}, ${sqlLit(now)},
  ${sqlLit(JSON.stringify(nodes))}, ${sqlLit(JSON.stringify(connections))},
  'Version e2e', 1, '阶段 D 端到端测试用临时克隆', '[]';
`);

// 3) shared_workflow（n8n 用项目共享关系控制可见性，缺了会查不到）
sqlite(`
INSERT INTO shared_workflow (workflowId, projectId, role, createdAt, updatedAt)
SELECT '${cloneId}', projectId, role, ${sqlLit(now)}, ${sqlLit(now)}
FROM shared_workflow WHERE workflowId='${SRC_WF}';
`);

console.log("克隆工作流 id:", cloneId);
console.log("名称:", cloneName);
console.log("节点数:", nodes.length);
console.log("integrity:", sqlite("PRAGMA integrity_check;"));

