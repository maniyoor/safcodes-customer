-- Run as the Safcodes schema owner in pgAdmin on the local rehearsal database.
BEGIN;
SET LOCAL search_path = safcodes, pg_catalog;
SET LOCAL TIME ZONE 'Asia/Dubai';
SET LOCAL lock_timeout = '5s';

DO $preview$
DECLARE
  target_database constant text := 'safcodes_admin_v2_rehearsal';
  target_email constant text := 'ameenmnr@gmail.com';
  target_customer constant text := 'CUS-24B9AF17A500';
  customer customers%ROWTYPE;
  customer_user uuid;
  seed text;
  domain_name text;
  reserve_domain text;
  product record;
  project_id uuid;
  agreement_id uuid;
  schedule_id uuid;
  sample_order uuid;
  sample_ticket uuid;
  sample_invoice uuid;
  sample_line uuid;
  invoice_spec record;
  agreement_start date := (date_trunc('month',current_date) - interval '1 month')::date;
  first_due date := current_date - 5;
  expiry date := current_date + 14;
BEGIN
  IF current_database() <> target_database THEN
    RAISE EXCEPTION 'Select the local rehearsal database %. Current database: %.', target_database, current_database();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_versions WHERE version='004_customer_portal') THEN
    RAISE EXCEPTION 'Apply the live customer portal migration first.';
  END IF;
  SELECT * INTO STRICT customer FROM customers c
    WHERE c.customer_no=target_customer AND c.status='active' AND c.currency='AED';
  SELECT u.id INTO STRICT customer_user FROM users u JOIN customer_members m ON m.user_id=u.id
    WHERE m.customer_id=customer.id AND lower(u.email)=target_email AND NOT u.is_staff AND u.status='active' AND m.status='active';
  seed := 'PVW-' || upper(substr(md5(customer.id::text),1,10)) || '-';
  PERFORM pg_advisory_xact_lock(hashtextextended(seed,0));

  IF EXISTS (SELECT 1 FROM services WHERE customer_id=customer.id AND service_no=seed||'DOMAIN') THEN
    RAISE NOTICE 'Preview records already exist for %.', customer.customer_no;
    RETURN;
  END IF;

  domain_name := 'safcodes-preview-' || lower(substr(md5(customer.id::text),1,10)) || '.example';
  reserve_domain := 'safcodes-renewal-' || lower(substr(md5(customer.id::text),1,10)) || '.example';

  FOR product IN SELECT * FROM (VALUES
    ('DOMAIN','domain.com',domain_name,1,expiry),
    ('DOMAIN-INVOICE','domain.com',reserve_domain,1,expiry + 7),
    ('SHARED','shared-light','Preview · Shared Hosting',1,current_date + 120),
    ('CLOUD','cloud-light','Preview · Cloud Hosting',1,current_date + 180),
    ('EMAIL','email-m365','Preview · Microsoft 365',5,current_date + 95),
    ('EMAIL-ALT','email-workspace','Preview · Google Workspace',3,current_date + 150)
  ) AS x(ref,plan_code,title,qty,ends) LOOP
    INSERT INTO services(id,customer_id,service_no,title,catalog_item_id,plan_id,quantity,status,health,billing_mode,currency,
      recurring_unit_amount,tax_inclusive,billing_cycle_months,term_start,term_end,next_due_date,
      purchased_unit_amount,discount_pct,registration_term_years,attributes)
    SELECT md5(seed||product.ref)::uuid,customer.id,seed||product.ref,product.title,p.catalog_item_id,p.id,
      product.qty,'active','healthy','annual','AED',cp.unit_amount,cp.tax_inclusive,12,
      (product.ends - interval '1 year')::date,product.ends,product.ends,cp.unit_amount,0,1,'{"preview_batch":"customer-portal-v1"}'
    FROM catalog_plans p JOIN LATERAL (
      SELECT price.unit_amount,price.tax_inclusive FROM catalog_prices price
      WHERE price.plan_id=p.id AND price.currency='AED' AND price.term_months=12
        AND price.valid_from<=current_date AND (price.valid_until IS NULL OR price.valid_until>current_date)
      ORDER BY price.valid_from DESC LIMIT 1
    ) cp ON true WHERE p.code=product.plan_code AND p.active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing active annual AED catalogue plan %.', product.plan_code; END IF;
  END LOOP;

  INSERT INTO service_domains(service_id,customer_id,fqdn,registered_on)
    SELECT s.id,s.customer_id,s.title,s.term_start FROM services s
    WHERE s.customer_id=customer.id AND s.id IN (md5(seed||'DOMAIN')::uuid,md5(seed||'DOMAIN-INVOICE')::uuid);
  INSERT INTO service_hosting(service_id,customer_id,primary_domain,domain_service_id,region)
    SELECT s.id,s.customer_id,domain_name,md5(seed||'DOMAIN')::uuid,'UAE' FROM services s
    WHERE s.customer_id=customer.id AND s.id IN (md5(seed||'SHARED')::uuid,md5(seed||'CLOUD')::uuid);
  INSERT INTO service_email(service_id,customer_id,domain_name,domain_service_id,provider_id)
    SELECT s.id,s.customer_id,domain_name,md5(seed||'DOMAIN')::uuid,p.provider_id
    FROM services s JOIN catalog_plans p ON p.id=s.plan_id
    WHERE s.customer_id=customer.id AND s.id IN (md5(seed||'EMAIL')::uuid,md5(seed||'EMAIL-ALT')::uuid);

  FOR product IN SELECT * FROM (VALUES
    ('WEBSITE','website','Preview · Company Website','contract'),
    ('MARKETING','marketing','Preview · SEO and Marketing','monthly'),
    ('STORE','store','Preview · Online Store Project','project')
  ) AS x(ref,category_code,title,billing) LOOP
    INSERT INTO services(id,customer_id,service_no,title,catalog_item_id,status,health,billing_mode,currency,
      recurring_unit_amount,billing_cycle_months,next_due_date,attributes)
    SELECT md5(seed||product.ref)::uuid,customer.id,seed||product.ref,product.title,i.id,'active','healthy',
      product.billing,'AED',CASE WHEN product.ref='MARKETING' THEN 750 ELSE 0 END,
      CASE WHEN product.ref='MARKETING' THEN 1 END,CASE WHEN product.ref='MARKETING' THEN current_date+20 END,
      '{"preview_batch":"customer-portal-v1"}'
    FROM catalog_items i WHERE i.code=product.category_code AND i.active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing catalogue item %.', product.category_code; END IF;
  END LOOP;
  project_id := md5(seed||'PROJECT')::uuid;
  INSERT INTO projects(id,customer_id,service_id,tech_stack_id,primary_domain,hosting_service_id,start_date,target_date,status,progress,phase,maintenance_included)
    VALUES(project_id,customer.id,md5(seed||'WEBSITE')::uuid,
      (SELECT id FROM technology_stacks WHERE code='nextjs'),domain_name,md5(seed||'SHARED')::uuid,
      current_date-45,current_date-10,'completed',100,'Launch complete',true);
  INSERT INTO projects(id,customer_id,service_id,tech_stack_id,start_date,target_date,status,progress,phase)
    VALUES(md5(seed||'STORE-PROJECT')::uuid,customer.id,md5(seed||'STORE')::uuid,
      (SELECT id FROM technology_stacks WHERE code='shopify'),current_date-15,current_date+30,'ongoing',45,'Catalogue setup');
  INSERT INTO service_marketing_activities(customer_id,service_id,activity_id)
    SELECT customer.id,md5(seed||'MARKETING')::uuid,id FROM marketing_activities WHERE code IN ('seo_geo','social_media');

  agreement_id := md5(seed||'AGREEMENT')::uuid;
  schedule_id := md5(seed||'SCHEDULE')::uuid;
  INSERT INTO contracts(id,customer_id,contract_no,title,contract_type,start_date,end_date,annual_value,currency,tax_inclusive,
    billing_cycle_months,first_due_date,status,scope,response_target_minutes,amc_plan_id,billing_cycle_id,project_id)
  VALUES(agreement_id,customer.id,seed||'AMC','Preview · Website Care','website_care',agreement_start,
    (agreement_start + interval '1 year')::date,6000,'AED',true,1,first_due,'active',
    'Sample agreement for routine updates, monitoring and monthly maintenance.',240,
    (SELECT id FROM amc_plans WHERE code='website_care'),(SELECT id FROM billing_cycles WHERE months=1),project_id);
  INSERT INTO contract_services(customer_id,contract_id,service_id) VALUES(customer.id,agreement_id,md5(seed||'WEBSITE')::uuid);
  INSERT INTO billing_schedules(id,customer_id,contract_id,cycle_months,anchor_date,next_period_start,next_due_date,ends_on)
    VALUES(schedule_id,customer.id,agreement_id,1,first_due,(agreement_start + interval '1 month')::date,
      (first_due + interval '1 month')::date,(agreement_start + interval '1 year')::date);

  FOR invoice_spec IN SELECT * FROM (VALUES
    ('AMC-INVOICE','service','contract_instalment','Preview · Website Care instalment',500::numeric,first_due,agreement_start,
      (agreement_start + interval '1 month')::date,agreement_id,NULL::uuid),
    ('DOMAIN-BILL','product','annual_renewal','Preview · Domain renewal',
      (SELECT recurring_unit_amount FROM services WHERE id=md5(seed||'DOMAIN-INVOICE')::uuid),expiry+7,expiry+7,
      (expiry+7 + interval '1 year')::date,NULL::uuid,md5(seed||'DOMAIN-INVOICE')::uuid)
  ) x(ref,segment,charge,description,amount,due,period_start,period_end,contract_id,service_id) LOOP
    sample_invoice := md5(seed||invoice_spec.ref)::uuid;
    sample_line := md5(seed||invoice_spec.ref||'-LINE')::uuid;
    INSERT INTO invoices(id,customer_id,invoice_no,segment,currency,billing_name)
      VALUES(sample_invoice,customer.id,seed||invoice_spec.ref,invoice_spec.segment,'AED',customer.legal_name);
    INSERT INTO invoice_lines(id,customer_id,invoice_id,line_no,charge_type,service_id,contract_id,description,quantity,
      unit_net,net_amount,tax_rate,tax_amount,period_start,period_end,pricing_snapshot)
    VALUES(sample_line,customer.id,sample_invoice,1,invoice_spec.charge,invoice_spec.service_id,invoice_spec.contract_id,
      invoice_spec.description,1,invoice_spec.amount,invoice_spec.amount,0,0,invoice_spec.period_start,invoice_spec.period_end,
      '{"preview_batch":"customer-portal-v1"}');
    UPDATE invoices SET status='issued',issued_on=least(current_date,invoice_spec.due),due_on=invoice_spec.due,finalized_at=now()
      WHERE id=sample_invoice;
    IF invoice_spec.contract_id IS NOT NULL THEN
      INSERT INTO billing_occurrences(id,customer_id,schedule_id,invoice_line_id,period_start,period_end,due_date)
        VALUES(md5(seed||'OCCURRENCE')::uuid,customer.id,schedule_id,sample_line,invoice_spec.period_start,invoice_spec.period_end,invoice_spec.due);
    END IF;
  END LOOP;

  sample_order := md5(seed||'ORDER')::uuid;
  INSERT INTO orders(id,customer_id,order_no,segment,kind,status,requested_by,brief,idempotency_key)
    VALUES(sample_order,customer.id,seed||'ORDER','service','new_service','under_review',customer_user,
      'Preview order for a new landing page.',seed||'ORDER');
  INSERT INTO order_items(customer_id,order_id,catalog_item_id,requested_quantity,requested_years,description,options)
    SELECT customer.id,sample_order,id,1,1,'Preview · Landing Page Request','{"estimate":"0.00"}' FROM catalog_items WHERE code='website';

  sample_ticket := md5(seed||'TICKET')::uuid;
  INSERT INTO support_tickets(id,customer_id,ticket_no,subject,department_code,priority,status,related_service_id,opened_by)
    VALUES(sample_ticket,customer.id,seed||'TICKET','Preview · Add a mailbox alias','technical','normal','open',md5(seed||'EMAIL')::uuid,customer_user);
  INSERT INTO ticket_messages(customer_id,ticket_id,author_id,body)
    VALUES(customer.id,sample_ticket,customer_user,'Sample ticket for previewing the support conversation.');
  RAISE NOTICE 'Added preview batch % for %. No emails, payment links, or payments were created.',seed,customer.customer_no;
END;
$preview$;
COMMIT;
