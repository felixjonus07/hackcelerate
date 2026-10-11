-- Append-only guards (§4.1 evaluations immutable, §13.6 audit log append-only,
-- §4.1 consent history append-only). Retention and erasure jobs (§13.5, §13.7)
-- may delete only inside a transaction that sets:  SET LOCAL aspiredge.allow_erasure = 'on';
CREATE OR REPLACE FUNCTION aspiredge_reject_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('aspiredge.allow_erasure', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION aspiredge_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION aspiredge_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER evaluations_immutable BEFORE UPDATE OR DELETE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION aspiredge_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER artifact_status_events_append_only BEFORE UPDATE OR DELETE ON artifact_status_events
  FOR EACH ROW EXECUTE FUNCTION aspiredge_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER counseling_card_moves_append_only BEFORE UPDATE OR DELETE ON counseling_card_moves
  FOR EACH ROW EXECUTE FUNCTION aspiredge_reject_mutation();
