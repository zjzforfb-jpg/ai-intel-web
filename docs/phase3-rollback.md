# 阶段 3 · Migration 回滚方案

> 涉及：`006_entities.sql`、`007_content_projects.sql`、`008_entity_mentions_dedup_key.sql`
> 原则：本轮所有 migration 都是 **additive-only**，不修改任何既有表，因此回滚只需要删新增对象。

---

## 一、回滚前的备份

migration 执行前已全库备份：

```
backups/phase3/pre-phase3-YYYYMMDD-HHMMSS.sql
```

恢复整库（会覆盖当前数据，谨慎）：

```bash
docker exec -i n8n-radar-postgres sh -c \
  'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d $POSTGRES_DB' \
  < backups/phase3/pre-phase3-<时间戳>.sql
```

---

## 二、按对象精确回滚（推荐）

### 2.1 回滚 008（幂等约束变更）

008 只改了 `entity_mentions` 的唯一约束，把 `(entity_id, report_id)` 换回三列版本。

```sql
ALTER TABLE entity_mentions DROP CONSTRAINT IF EXISTS entity_mentions_entity_report_key;
ALTER TABLE entity_mentions
  ADD CONSTRAINT entity_mentions_dedup_key UNIQUE (entity_id, report_id, source_title);
```

> ⚠️ 回滚前必须先确认没有重复的 `(entity_id, report_id)` 组合，否则加不上三列唯一约束。
> 检查：
> ```sql
> SELECT entity_id, report_id, count(*) FROM entity_mentions
> GROUP BY 1,2 HAVING count(*) > 1;
> ```
> 有结果就先按 §2.3 清理。

### 2.2 回滚 007（内容项目）

```sql
DROP TABLE IF EXISTS content_projects;
```

`content_projects` 没有被任何其他表引用，直接删即可。
如果只是想停用而不是删除，更安全的是改名保留：

```sql
ALTER TABLE content_projects RENAME TO content_projects_deprecated;
```

### 2.3 回滚 006（实体追踪）

**注意删除顺序**：`entity_mentions` 有指向 `entities` 的外键（ON DELETE CASCADE），
先删子表再删父表。

```sql
DROP TABLE IF EXISTS entity_mentions;
DROP TABLE IF EXISTS entities;
```

### 2.4 权限回滚

删表时对应的 `GRANT` 会随之失效，无需单独 `REVOKE`。
若只想收回权限而保留表：

```sql
REVOKE ALL ON entities, entity_mentions, content_projects FROM ai_intel_writer;
REVOKE ALL ON entities, entity_mentions, content_projects FROM ai_intel_reader;
```

---

## 三、只清数据、保留表结构（最常见的场景）

想让实体追踪「从零开始」而不动表结构：

```sql
-- 会连带删除所有提及（CASCADE）
TRUNCATE TABLE entity_mentions RESTART IDENTITY;
TRUNCATE TABLE entities RESTART IDENTITY CASCADE;
TRUNCATE TABLE content_projects RESTART IDENTITY;
```

> `RESTART IDENTITY` 让自增 id 从 1 重新开始，便于对照。

---

## 四、n8n 侧回滚

实体抽取节点是**新增**的，回滚不影响既有 36 节点逻辑：

1. 停容器：
   ```bash
   docker --context orbstack stop n8n-radar
   ```
2. 用 `scripts/phase3-n8n-entities.mts` 之前的快照恢复 `workflow_entity.nodes`，
   或者直接从备份 SQLite 回拷。
3. 阶段 2 的发布版本是 `c6d4ccf3-bb02-4c65-b97e-06d2ffa8c469`（36 节点），
   本阶段是 `1da464ba-5035-4cff-9658-1fad07596a7c`（38 节点）。
4. 回拷后务必确认三处版本指针一致：
   ```sql
   SELECT versionId, activeVersionId FROM workflow_entity WHERE id='ZtIAVVtWmcPLXywX';
   SELECT publishedVersionId FROM workflow_published_version WHERE workflowId='ZtIAVVtWmcPLXywX';
   ```

> 回滚 SQLite 时**必须先停容器并处理 WAL**，否则会损坏数据库。
> 正确做法：停容器 → 拷 `database.sqlite` + `-wal` + `-shm` 三件套 → 改回属主 1000:1000。

---

## 五、回滚影响评估

| 回滚对象 | 影响 | 是否影响既有功能 |
|---------|------|----------------|
| `008` | 实体提及幂等性变差（重跑会累积） | 否 |
| `007` | 内容项目页面 500 | 否 |
| `006` | 实体页面 500，n8n 实体写入节点报错 | 否（节点有 `onError: continueRegularOutput`，日报主流程不受影响） |

**关键**：因为实体抽取挂在并行分支且允许失败，即使完全回滚数据库新表，
日报采集、选题提取、商机分析、监控等既有功能都不受影响。

---

## 六、回滚验证清单

回滚后逐项确认：

- [ ] `SELECT to_regclass('public.entities'), to_regclass('public.entity_mentions'), to_regclass('public.content_projects');` 均为 null
- [ ] `daily_reports` / `topic_ideas` / `opportunities` 行数与回滚前一致
- [ ] `npm test` 仍全绿（不含阶段 3 新增测试文件时）
- [ ] `npm run build` 仍成功（需先移除引用新表的页面）
- [ ] n8n `/healthz` 返回 ok
- [ ] `PRAGMA integrity_check` 返回 ok
