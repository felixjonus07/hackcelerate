-- Roll numbers live in a restricted table (§4.1): analytics and reporting connect as `aspiredge_analytics`,
-- which can read every table except `student_identities` (roll numbers and names). The role cannot log in by
-- itself; give it a password and LOGIN in the deployment if a reporting tool needs a connection.
-- The block is guarded so a managed database without CREATEROLE rights does not fail the migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aspiredge_analytics') THEN
    CREATE ROLE aspiredge_analytics NOLOGIN;
  END IF;
  GRANT USAGE ON SCHEMA public TO aspiredge_analytics;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO aspiredge_analytics;
  REVOKE ALL ON TABLE student_identities FROM aspiredge_analytics;
  REVOKE ALL ON TABLE account, session, verification, "user" FROM aspiredge_analytics;
  REVOKE ALL ON TABLE notifications, notification_preferences, demographic_profiles FROM aspiredge_analytics;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO aspiredge_analytics;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Skipping the analytics role: this database user cannot create roles';
END
$$;
--> statement-breakpoint
-- The archive is append-only too: events move in, and are never edited or removed.
CREATE TRIGGER audit_events_archive_append_only BEFORE UPDATE OR DELETE ON audit_events_archive
  FOR EACH ROW EXECUTE FUNCTION aspiredge_reject_mutation();
