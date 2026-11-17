-- Apply to the existing Safcodes database as its owner, after 003_admin_api.
BEGIN;
SET LOCAL search_path = safcodes, pg_catalog;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(hashtextextended('safcodes.schema_migration', 0));
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_versions WHERE version = '003_admin_api') THEN
    RAISE EXCEPTION 'Apply 09_admin_api.sql first.';
  END IF;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_temp_password_expires_at timestamptz;
END;
$migration$;

-- Check eligibility before a customer identity has been verified for RLS.
-- Returns only a boolean and cannot be called by the public runtime role.
CREATE OR REPLACE FUNCTION safcodes.customer_sign_in_allowed(p_user uuid, p_invited boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = safcodes, pg_temp AS $eligible$
  SELECT EXISTS (
    SELECT 1 FROM customer_members m JOIN customers c ON c.id=m.customer_id
    JOIN users u ON u.id=m.user_id JOIN roles r ON r.code=m.role_code AND r.scope='customer'
    WHERE m.user_id=p_user AND NOT u.is_staff AND c.status='active' AND c.currency='AED'
      AND CASE WHEN p_invited THEN
        u.status='invited' AND m.status='invited' AND m.access_approved_at IS NOT NULL
        AND u.email=coalesce(c.portal_email,c.billing_email)
      ELSE u.status='active' AND m.status='active' AND u.email_verified_at IS NOT NULL END
  )
$eligible$;
REVOKE ALL ON FUNCTION safcodes.customer_sign_in_allowed(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safcodes.customer_sign_in_allowed(uuid,boolean) TO safcodes_worker;

CREATE OR REPLACE FUNCTION safcodes.activate_approved_memberships(p_user uuid, p_challenge uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = safcodes, pg_temp AS $activate$
DECLARE affected integer;
BEGIN
  IF NOT customer_sign_in_allowed(p_user, true) OR NOT EXISTS (
    SELECT 1 FROM auth_challenges a WHERE a.user_id=p_user AND a.id=p_challenge
      AND a.purpose='password_reset' AND a.consumed_at IS NOT NULL AND a.expires_at>now()
  ) THEN RETURN 0; END IF;
  UPDATE customer_members m SET status='active' FROM customers c, users u, roles r
  WHERE m.user_id=p_user AND u.id=p_user AND c.id=m.customer_id
    AND r.code=m.role_code AND r.scope='customer' AND m.status='invited' AND m.access_approved_at IS NOT NULL
    AND c.status='active' AND c.currency='AED' AND u.email=coalesce(c.portal_email,c.billing_email);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$activate$;
REVOKE ALL ON FUNCTION safcodes.activate_approved_memberships(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safcodes.activate_approved_memberships(uuid,uuid) TO safcodes_worker;
INSERT INTO schema_versions(version) VALUES ('004_customer_portal') ON CONFLICT DO NOTHING;
COMMIT;
