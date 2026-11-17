-- Optional cleanup. Read the preview notices first, then set apply_changes to true.
BEGIN;
SET LOCAL search_path = safcodes, pg_catalog;
SET LOCAL lock_timeout = '5s';

DO $cleanup$
DECLARE
  target_database constant text := 'safcodes_admin_v2_rehearsal';
  target_email constant text := 'ameenmnr@gmail.com';
  target_customer constant text := 'CUS-24B9AF17A500';
  apply_changes constant boolean := false;
  customer_id_selected uuid;
  seed text;
  service_ids uuid[];
  order_ids uuid[];
  invoice_ids uuid[];
  preview_ticket_id uuid;
  agreement_id uuid;
  project_ids uuid[];
  request_ids uuid[];
  guard record;
BEGIN
  IF current_database() <> target_database THEN
    RAISE EXCEPTION 'Select the local rehearsal database %. Current database: %.', target_database, current_database();
  END IF;
  SELECT c.id INTO STRICT customer_id_selected FROM customers c
  WHERE c.customer_no=target_customer AND EXISTS (SELECT 1 FROM customer_members m JOIN users u ON u.id=m.user_id
    WHERE m.customer_id=c.id AND lower(u.email)=target_email AND NOT u.is_staff);
  seed := 'PVW-' || upper(substr(md5(customer_id_selected::text),1,10)) || '-';
  PERFORM pg_advisory_xact_lock(hashtextextended(seed,0));

  service_ids := ARRAY(SELECT s.id FROM services s WHERE s.customer_id=customer_id_selected
    AND s.attributes->>'preview_batch'='customer-portal-v1'
    AND s.id IN (SELECT md5(seed||ref)::uuid FROM unnest(ARRAY['DOMAIN','DOMAIN-INVOICE','SHARED','CLOUD','EMAIL','EMAIL-ALT','WEBSITE','MARKETING','STORE']) ref));
  IF cardinality(service_ids)=0 THEN
    RAISE NOTICE 'No preview services found for %.',target_customer;
    RETURN;
  END IF;
  preview_ticket_id := md5(seed||'TICKET')::uuid;
  agreement_id := md5(seed||'AGREEMENT')::uuid;
  project_ids := ARRAY[md5(seed||'PROJECT')::uuid,md5(seed||'STORE-PROJECT')::uuid];
  order_ids := ARRAY(SELECT o.id FROM orders o WHERE o.customer_id=customer_id_selected
    AND (o.id=md5(seed||'ORDER')::uuid OR (o.kind IN ('renewal','hosting_upgrade','email_scale') AND EXISTS (
      SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.existing_service_id=ANY(service_ids)))));
  invoice_ids := ARRAY(SELECT DISTINCT l.invoice_id FROM invoice_lines l WHERE l.customer_id=customer_id_selected
    AND (l.service_id=ANY(service_ids) OR l.contract_id=agreement_id OR l.order_id=ANY(order_ids)));
  request_ids := ARRAY(SELECT p.id FROM payment_requests p WHERE p.customer_id=customer_id_selected AND p.invoice_id=ANY(invoice_ids));

  RAISE NOTICE 'Preview cleanup for %: % services, % orders, % invoices, % payment requests.',
    target_customer,cardinality(service_ids),cardinality(order_ids),cardinality(invoice_ids),cardinality(request_ids);
  IF NOT apply_changes THEN
    RAISE NOTICE 'Dry run. Set apply_changes to true only after checking the target and backing up the rehearsal database.';
    RETURN;
  END IF;

  -- Keep all recorded payments, credits, quotes, and mixed records intact.
  IF EXISTS (SELECT 1 FROM payment_allocations WHERE invoice_id=ANY(invoice_ids))
    OR EXISTS (SELECT 1 FROM credit_notes WHERE invoice_id=ANY(invoice_ids))
    OR EXISTS (SELECT 1 FROM quotes WHERE order_id=ANY(order_ids))
    OR EXISTS (SELECT 1 FROM invoices WHERE id=ANY(invoice_ids) AND quote_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM order_items WHERE order_id=ANY(order_ids) AND order_id<>md5(seed||'ORDER')::uuid
      AND NOT coalesce(existing_service_id=ANY(service_ids),false))
    OR EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id=ANY(invoice_ids) AND NOT
      (coalesce(service_id=ANY(service_ids),false) OR coalesce(contract_id=agreement_id,false) OR coalesce(order_id=ANY(order_ids),false)))
    OR EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id=ANY(invoice_ids) AND (
      (service_id IS NOT NULL AND NOT service_id=ANY(service_ids))
      OR (contract_id IS NOT NULL AND contract_id<>agreement_id)
      OR (order_id IS NOT NULL AND NOT order_id=ANY(order_ids))
      OR milestone_id IS NOT NULL OR service_change_id IS NOT NULL))
  THEN
    RAISE EXCEPTION 'Preview records now have payments, credits, quotes or mixed references. Keep them for review or restore your rehearsal backup.';
  END IF;

  -- These two constraints only protect immutable invoice history. Keep every foreign key enabled.
  FOR guard IN SELECT * FROM (VALUES ('invoices','invoice_header_guard'),('invoice_lines','invoice_line_guard')) AS x(table_name,trigger_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(format('safcodes.%I',guard.table_name))
      AND tgname=guard.trigger_name AND tgenabled='O' AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'Unexpected trigger state for %.',guard.trigger_name;
    END IF;
    EXECUTE format('ALTER TABLE safcodes.%I DISABLE TRIGGER %I',guard.table_name,guard.trigger_name);
  END LOOP;
  DELETE FROM admin_command_receipts WHERE response#>>'{record,id}'=ANY(
    ARRAY(SELECT id::text FROM unnest(service_ids||order_ids||invoice_ids||request_ids||ARRAY[preview_ticket_id,agreement_id]) id));
  DELETE FROM audit_events WHERE customer_id=customer_id_selected AND entity_id=ANY(
    ARRAY(SELECT id::text FROM unnest(service_ids||order_ids||invoice_ids||request_ids||ARRAY[preview_ticket_id,agreement_id]) id));
  DELETE FROM payment_requests WHERE customer_id=customer_id_selected AND id=ANY(request_ids);
  DELETE FROM payment_links WHERE customer_id=customer_id_selected AND invoice_id=ANY(invoice_ids);
  DELETE FROM billing_occurrences WHERE customer_id=customer_id_selected
    AND invoice_line_id IN (SELECT id FROM invoice_lines WHERE invoice_id=ANY(invoice_ids));
  DELETE FROM invoice_lines WHERE customer_id=customer_id_selected AND invoice_id=ANY(invoice_ids);
  DELETE FROM invoices WHERE customer_id=customer_id_selected AND id=ANY(invoice_ids);
  ALTER TABLE invoice_lines ENABLE TRIGGER invoice_line_guard;
  ALTER TABLE invoices ENABLE TRIGGER invoice_header_guard;

  DELETE FROM order_messages WHERE customer_id=customer_id_selected AND order_id=ANY(order_ids);
  DELETE FROM order_items WHERE customer_id=customer_id_selected AND order_id=ANY(order_ids);
  DELETE FROM orders WHERE customer_id=customer_id_selected AND id=ANY(order_ids);
  DELETE FROM ticket_messages WHERE customer_id=customer_id_selected AND ticket_id=preview_ticket_id;
  DELETE FROM support_tickets WHERE customer_id=customer_id_selected AND id=preview_ticket_id;
  DELETE FROM contract_services WHERE customer_id=customer_id_selected AND contract_id=agreement_id;
  DELETE FROM billing_schedules WHERE customer_id=customer_id_selected AND contract_id=agreement_id;
  DELETE FROM contracts WHERE customer_id=customer_id_selected AND id=agreement_id;
  DELETE FROM projects WHERE customer_id=customer_id_selected AND id=ANY(project_ids);
  DELETE FROM service_marketing_activities WHERE customer_id=customer_id_selected AND service_id=ANY(service_ids);
  DELETE FROM service_email WHERE customer_id=customer_id_selected AND service_id=ANY(service_ids);
  DELETE FROM service_hosting WHERE customer_id=customer_id_selected AND service_id=ANY(service_ids);
  DELETE FROM service_domains WHERE customer_id=customer_id_selected AND service_id=ANY(service_ids);
  DELETE FROM services WHERE customer_id=customer_id_selected AND id=ANY(service_ids);
  RAISE NOTICE 'Removed scoped preview records for %. Customer account and login were preserved.',target_customer;
END;
$cleanup$;
COMMIT;
