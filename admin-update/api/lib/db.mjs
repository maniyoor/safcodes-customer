import pg from 'pg';

pg.types.setTypeParser(1082, value => value);
export const openPool = (user = process.env.PGUSER) => new pg.Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5030),
  database: process.env.PGDATABASE || 'safcodes_admin_v2_rehearsal',
  user,
  password: process.env.PGPASSWORD,
  max: 8,
  connectionTimeoutMillis: 6000,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : false,
});
export async function checkDatabase(pool, config) {
  const { rows: [row] } = await pool.query(`SELECT current_database() AS database, current_user AS role,
    r.rolsuper, r.rolbypassrls, pg_has_role(r.oid, n.nspowner, 'MEMBER') AS owns_schema,
    to_regclass('safcodes.admin_command_receipts') IS NOT NULL AS migrated,
    pg_has_role(current_user, 'safcodes_worker', 'MEMBER') AS worker
    FROM pg_roles r JOIN pg_namespace n ON n.nspname='safcodes' WHERE r.rolname=current_user`);
  if (!row?.worker || row.rolsuper || row.rolbypassrls || row.owns_schema) throw new Error('Use the non-owner safcodes_jobs worker login from the v1 setup.');
  if (!row.migrated) throw new Error('Apply database/09_admin_api.sql as the database owner first.');
  if (config?.customerOrigin) {
    const { rows: [client] } = await pool.query(`SELECT to_regprocedure('safcodes.customer_sign_in_allowed(uuid,boolean)') IS NOT NULL AS migrated,
      EXISTS (SELECT 1 FROM safcodes.schema_versions WHERE version='005_customer_preferences') AS preferences`);
    if (!client.migrated) throw new Error('Apply database/10_customer_portal.sql as the database owner first.');
    if (!client.preferences) throw new Error('Apply database/11_customer_preferences.sql as the database owner first.');
  }
  return row;
}
