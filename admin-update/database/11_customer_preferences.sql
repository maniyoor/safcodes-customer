-- Apply after 004_customer_portal as the Safcodes database owner.
BEGIN;
SET LOCAL search_path = safcodes, pg_catalog;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(hashtextextended('safcodes.schema_migration', 0));
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_versions WHERE version = '004_customer_portal') THEN
    RAISE EXCEPTION 'Apply 10_customer_portal.sql first.';
  END IF;
END;
$migration$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_avatar text
  CHECK (customer_avatar IS NULL OR (NOT is_staff AND length(customer_avatar) <= 96000
    AND customer_avatar LIKE 'data:image/jpeg;base64,%'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_test_customer_id text
  CHECK (stripe_test_customer_id ~ '^cus_[A-Za-z0-9]{1,64}$');
CREATE UNIQUE INDEX IF NOT EXISTS customers_stripe_test_customer_unique ON customers(stripe_test_customer_id)
  WHERE stripe_test_customer_id IS NOT NULL;

INSERT INTO schema_versions(version) VALUES ('005_customer_preferences') ON CONFLICT DO NOTHING;
COMMIT;
