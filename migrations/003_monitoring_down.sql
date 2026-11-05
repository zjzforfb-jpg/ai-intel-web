-- 003 回滚：删除监控两表（monitor_notifications 依赖 monitor_runs，先删子表）
-- 执行者：仅主 Agent。执行前确认已停止监控调度（cron/launchd）
-- 注意：仅删除监控日志数据，不影响 daily_reports / topics / opportunities

DROP TABLE IF EXISTS monitor_notifications;
DROP TABLE IF EXISTS monitor_runs;

-- 可选：撤销监控账号权限（保留账号本身，便于回滚后再启用）
-- REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ai_intel_monitor;
