-- =====================================================================
-- Ceazers 3D admin - data capture for insights (run after 0001, 0002)
--   * clients: client_type, lead_source
--   * service categories (owner-managed list) on items and document lines
--   * quotes: lost_reason + note when declined / lost
--   * enquiries log (website form, WhatsApp, phone...) incl. turned-away work
--   * app_insights_data(): owner-only dataset for the Insights page
-- Additive and safe to re-run.
-- =====================================================================

-- ---------- reference lists ----------
create table if not exists service_categories (
  id         text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  label      text not null check (length(label) between 1 and 60),
  sort       int  not null default 100,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);
insert into service_categories (id, label, sort) values
  ('cad', 'CAD design & modelling', 10),
  ('drawings', 'Engineering drawings', 20),
  ('fdm_printing', 'FDM 3D printing', 30),
  ('resin_printing', 'Resin 3D printing', 40),
  ('prototyping', 'Prototyping', 50),
  ('product_dev', 'Product development', 60),
  ('reverse_eng', 'Reverse engineering / scanning', 70),
  ('repairs', 'Replacement & repair parts', 80),
  ('finishing', 'Post-processing & finishing', 90),
  ('consulting', 'Consulting & training', 100),
  ('delivery', 'Delivery / shipping', 110),
  ('other', 'Other', 900)
on conflict (id) do nothing;

-- client types / lead sources / lost reasons are fixed lists (checked below)
alter table clients add column if not exists client_type text;
alter table clients add column if not exists lead_source text;
do $$ begin
  alter table clients add constraint clients_client_type_chk check (client_type is null or client_type in
    ('individual','student','startup','business','manufacturing','engineering','education','government',
     'healthcare','retail','agriculture','mining','automotive','other'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table clients add constraint clients_lead_source_chk check (lead_source is null or lead_source in
    ('website','referral','repeat','whatsapp','social','google','walk_in','event','email','phone','other'));
exception when duplicate_object then null; end $$;

alter table services add column if not exists category text references service_categories (id);
alter table document_lines add column if not exists category text references service_categories (id);

alter table documents add column if not exists lost_reason text;
alter table documents add column if not exists lost_note text not null default '';
do $$ begin
  alter table documents add constraint documents_lost_reason_chk check (lost_reason is null or lost_reason in
    ('price','turnaround','went_elsewhere','no_response','scope_changed','client_cancelled','not_feasible','other'));
exception when duplicate_object then null; end $$;

-- ---------- enquiries ----------
create table if not exists enquiries (
  id             uuid primary key default gen_random_uuid(),
  received_at    timestamptz not null default now(),
  source         text not null default 'website' check (source in
                   ('website','whatsapp','phone','email','walk_in','referral','social','other')),
  name           text not null default '' check (length(name) <= 200),
  email          text not null default '' check (length(email) <= 254),
  phone          text not null default '' check (length(phone) <= 40),
  company        text not null default '' check (length(company) <= 200),
  client_type    text,
  category       text references service_categories (id),
  message        text not null default '' check (length(message) <= 5000),
  status         text not null default 'new' check (status in ('new','quoted','turned_away','no_response','spam')),
  turned_away_reason text check (turned_away_reason is null or turned_away_reason in
                   ('not_offered','capacity','too_small','outside_area','not_viable','other')),
  notes          text not null default '',
  client_id      uuid references clients (id),
  quote_id       uuid references documents (id),
  created_by     uuid references auth.users (id),
  updated_at     timestamptz not null default now()
);
create index if not exists enquiries_received_idx on enquiries (received_at desc);

alter table service_categories enable row level security;
alter table enquiries enable row level security;
revoke all on service_categories, enquiries from anon, authenticated;
grant select on service_categories, enquiries to authenticated;
drop policy if exists service_categories_select on service_categories;
drop policy if exists enquiries_select on enquiries;
create policy service_categories_select on service_categories for select to authenticated using (app_is_member());
create policy enquiries_select on enquiries for select to authenticated using (app_is_member());

do $$
declare t text;
begin
  foreach t in array array['service_categories','enquiries'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function trg_audit()', t, t);
  end loop;
end $$;

-- =====================================================================
-- API functions
-- =====================================================================
create or replace function app_list_categories(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_member();
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.label) from service_categories c
                   where coalesce((p ->> 'include_archived')::boolean, false) or not c.archived), '[]'::jsonb);
end $$;

create or replace function app_save_category(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := lower(regexp_replace(coalesce(nullif(p ->> 'id', ''), p ->> 'label', ''), '[^a-zA-Z0-9]+', '_', 'g'));
        r service_categories;
begin
  perform app_require_owner();
  v_id := trim(both '_' from v_id);
  if length(coalesce(trim(p ->> 'label'), '')) = 0 and not exists (select 1 from service_categories where id = v_id) then
    raise exception 'Enter a category name';
  end if;
  insert into service_categories (id, label, sort)
  values (v_id, trim(p ->> 'label'), coalesce((p ->> 'sort')::int, 500))
  on conflict (id) do update set
    label = coalesce(nullif(trim(p ->> 'label'), ''), service_categories.label),
    sort = coalesce((p ->> 'sort')::int, service_categories.sort),
    archived = coalesce((p ->> 'archived')::boolean, service_categories.archived)
  returning * into r;
  return to_jsonb(r);
end $$;

-- clients: + client_type, lead_source
create or replace function app_save_client(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; r clients;
begin
  perform app_require_member();
  if coalesce(trim(p ->> 'name'), '') = '' and v_id is null then raise exception 'Client name is required'; end if;
  if v_id is null then
    insert into clients (name, contact_person, email, phone, billing_address, shipping_address, vat_number, notes,
                         client_type, lead_source, created_by)
    values (trim(p ->> 'name'), coalesce(p ->> 'contact_person', ''), coalesce(p ->> 'email', ''), coalesce(p ->> 'phone', ''),
            coalesce(p ->> 'billing_address', ''), coalesce(p ->> 'shipping_address', ''), coalesce(p ->> 'vat_number', ''),
            coalesce(p ->> 'notes', ''), nullif(p ->> 'client_type', ''), nullif(p ->> 'lead_source', ''), auth.uid())
    returning * into r;
  else
    update clients c set
      name = coalesce(nullif(trim(p ->> 'name'), ''), c.name),
      contact_person = coalesce(p ->> 'contact_person', c.contact_person),
      email = coalesce(p ->> 'email', c.email), phone = coalesce(p ->> 'phone', c.phone),
      billing_address = coalesce(p ->> 'billing_address', c.billing_address),
      shipping_address = coalesce(p ->> 'shipping_address', c.shipping_address),
      vat_number = coalesce(p ->> 'vat_number', c.vat_number), notes = coalesce(p ->> 'notes', c.notes),
      client_type = case when p ? 'client_type' then nullif(p ->> 'client_type', '') else c.client_type end,
      lead_source = case when p ? 'lead_source' then nullif(p ->> 'lead_source', '') else c.lead_source end,
      archived = coalesce((p ->> 'archived')::boolean, c.archived), updated_at = now()
    where id = v_id returning * into r;
    if r.id is null then raise exception 'Client not found'; end if;
  end if;
  return to_jsonb(r);
end $$;

-- services: + category
create or replace function app_save_service(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; r services; c jsonb := p -> 'costing';
begin
  perform app_require_member();
  if c is not null and jsonb_typeof(c) = 'object' and not app_is_owner() then
    raise exception 'Owner access required for costing' using errcode = '42501';
  end if;
  if v_id is null then
    if coalesce(trim(p ->> 'name'), '') = '' then raise exception 'Service name is required'; end if;
    insert into services (name, description, unit, unit_price_cents, taxable, category)
    values (trim(p ->> 'name'), coalesce(p ->> 'description', ''), coalesce(nullif(p ->> 'unit', ''), 'each'),
            coalesce((p ->> 'unit_price_cents')::bigint, 0), coalesce((p ->> 'taxable')::boolean, true),
            nullif(p ->> 'category', ''))
    returning * into r;
  else
    update services s set name = coalesce(nullif(trim(p ->> 'name'), ''), s.name),
      description = coalesce(p ->> 'description', s.description), unit = coalesce(nullif(p ->> 'unit', ''), s.unit),
      unit_price_cents = coalesce((p ->> 'unit_price_cents')::bigint, s.unit_price_cents),
      taxable = coalesce((p ->> 'taxable')::boolean, s.taxable),
      category = case when p ? 'category' then nullif(p ->> 'category', '') else s.category end,
      archived = coalesce((p ->> 'archived')::boolean, s.archived), updated_at = now()
    where id = v_id returning * into r;
    if r.id is null then raise exception 'Service not found'; end if;
  end if;
  if c is not null and jsonb_typeof(c) = 'object' then
    insert into service_costs (service_id, material_id, material_grams, print_hours, labour_hours, design_hours,
                               other_cost_cents, unit_cost_cents, notes, updated_at)
    values (r.id, nullif(c ->> 'material_id', '')::uuid, coalesce((c ->> 'material_grams')::numeric, 0),
            coalesce((c ->> 'print_hours')::numeric, 0), coalesce((c ->> 'labour_hours')::numeric, 0),
            coalesce((c ->> 'design_hours')::numeric, 0), coalesce((c ->> 'other_cost_cents')::bigint, 0),
            app_cost_of(c), coalesce(c ->> 'notes', ''), now())
    on conflict (service_id) do update set material_id = excluded.material_id, material_grams = excluded.material_grams,
      print_hours = excluded.print_hours, labour_hours = excluded.labour_hours, design_hours = excluded.design_hours,
      other_cost_cents = excluded.other_cost_cents, unit_cost_cents = excluded.unit_cost_cents,
      notes = excluded.notes, updated_at = now();
  end if;
  return to_jsonb(r) || case when app_is_owner()
    then jsonb_build_object('costing', (select to_jsonb(sc) from service_costs sc where sc.service_id = r.id)) else '{}'::jsonb end;
end $$;

-- documents: lines carry a category (explicit, else the saved item's)
create or replace function app_save_document(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid; d documents; s company_settings;
  v_owner boolean := app_is_owner(); ln jsonb; v_line uuid; v_pos int := 0; v_kind text;
  v_snapshot jsonb; v_client uuid; v_keep jsonb;
begin
  perform app_require_member();
  select * into s from company_settings where id = 1;
  v_client := nullif(p ->> 'client_id', '')::uuid;
  if v_client is not null and not exists (select 1 from clients where id = v_client) then
    raise exception 'Client not found';
  end if;

  if v_id is null then
    v_kind := p ->> 'kind';
    if v_kind not in ('quote', 'invoice') then raise exception 'Unknown document type'; end if;
    insert into documents (kind, number, status, title, client_id, issue_date, due_date, tax_mode, vat_rate,
                           shipping_taxable, terms, created_by)
    values (v_kind,
            case when v_kind = 'quote' then app_next_number('quote') end,
            'draft', case when v_kind = 'quote' then 'Quote' else 'Invoice' end, v_client,
            coalesce((p ->> 'issue_date')::date, current_date),
            coalesce((p ->> 'due_date')::date, current_date + case when v_kind = 'quote' then s.quote_validity_days else s.terms_days end),
            s.tax_mode, s.vat_rate, s.shipping_taxable,
            case when v_kind = 'quote' then s.quote_terms else s.invoice_terms end, auth.uid())
    returning * into d;
  else
    select * into d from documents where id = v_id for update;
    if d.id is null then raise exception 'Document not found'; end if;
    if d.locked then raise exception 'Issued documents are locked'; end if;
  end if;

  v_snapshot := case
    when p ? 'client_snapshot' and jsonb_typeof(p -> 'client_snapshot') = 'object'
      then coalesce(app_client_snapshot(coalesce(v_client, d.client_id)), '{}'::jsonb) || (p -> 'client_snapshot')
    when v_client is not null then app_client_snapshot(v_client)
    else d.client_snapshot end;

  update documents x set
    title = coalesce(p ->> 'title', x.title),
    client_id = coalesce(v_client, x.client_id),
    client_snapshot = coalesce(v_snapshot, '{}'::jsonb),
    issue_date = coalesce((p ->> 'issue_date')::date, x.issue_date),
    due_date = coalesce((p ->> 'due_date')::date, x.due_date),
    reference = coalesce(p ->> 'reference', x.reference),
    notes = coalesce(p ->> 'notes', x.notes),
    terms = coalesce(p ->> 'terms', x.terms),
    internal_notes = coalesce(p ->> 'internal_notes', x.internal_notes),
    discount_type = coalesce(p ->> 'discount_type', x.discount_type),
    discount_percent = coalesce((p ->> 'discount_percent')::numeric, x.discount_percent),
    discount_amount_cents = coalesce((p ->> 'discount_amount_cents')::bigint, x.discount_amount_cents),
    shipping_cents = coalesce((p ->> 'shipping_cents')::bigint, x.shipping_cents),
    tax_mode = coalesce(p ->> 'tax_mode', x.tax_mode),
    vat_rate = coalesce((p ->> 'vat_rate')::numeric, x.vat_rate),
    shipping_taxable = coalesce((p ->> 'shipping_taxable')::boolean, x.shipping_taxable),
    deposit_type = coalesce(p ->> 'deposit_type', x.deposit_type),
    deposit_percent = coalesce((p ->> 'deposit_percent')::numeric, x.deposit_percent),
    deposit_amount_cents = coalesce((p ->> 'deposit_amount_cents')::bigint, x.deposit_amount_cents)
  where id = d.id;

  if p ? 'lines' then
    if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') > 200 then
      raise exception 'Lines must be a list of at most 200 items';
    end if;
    select coalesce(jsonb_object_agg(lc.line_id::text, jsonb_build_object('u', lc.unit_cost_cents, 'b', lc.breakdown)), '{}'::jsonb)
      into v_keep from line_costs lc where lc.document_id = d.id;
    delete from document_lines where document_id = d.id;
    for ln in select * from jsonb_array_elements(p -> 'lines') loop
      v_pos := v_pos + 1;
      insert into document_lines (id, document_id, position, service_id, name, description, qty, unit_price_cents, taxable, category)
      values (coalesce(nullif(ln ->> 'id', '')::uuid, gen_random_uuid()), d.id, v_pos,
              nullif(ln ->> 'service_id', '')::uuid, coalesce(ln ->> 'name', ''), coalesce(ln ->> 'description', ''),
              coalesce((ln ->> 'qty')::numeric, 1), coalesce((ln ->> 'unit_price_cents')::bigint, 0),
              coalesce((ln ->> 'taxable')::boolean, true),
              coalesce(nullif(ln ->> 'category', ''),
                       (select category from services where id = nullif(ln ->> 'service_id', '')::uuid)))
      returning id into v_line;
      if v_owner and ln ? 'cost' and jsonb_typeof(ln -> 'cost') = 'object' then
        insert into line_costs (line_id, document_id, unit_cost_cents, breakdown)
        values (v_line, d.id, greatest(0, coalesce((ln -> 'cost' ->> 'unit_cost_cents')::bigint, 0)),
                coalesce(ln -> 'cost' -> 'breakdown', '{}'::jsonb));
      elsif v_keep ? v_line::text then
        insert into line_costs (line_id, document_id, unit_cost_cents, breakdown)
        values (v_line, d.id, (v_keep -> v_line::text ->> 'u')::bigint, v_keep -> v_line::text -> 'b');
      elsif nullif(ln ->> 'service_id', '') is not null then
        insert into line_costs (line_id, document_id, unit_cost_cents, breakdown)
        select v_line, d.id, sc.unit_cost_cents, jsonb_build_object('source', 'service', 'service_id', sc.service_id)
        from service_costs sc where sc.service_id = (ln ->> 'service_id')::uuid;
      end if;
    end loop;
  end if;

  return app_doc_json(d.id, v_owner);
end $$;

create or replace function app_copy_document(p_src uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare s documents; v_new uuid; l document_lines; v_line uuid; cs company_settings;
begin
  select * into s from documents where id = p_src;
  select * into cs from company_settings where id = 1;
  insert into documents (kind, number, status, title, client_id, client_snapshot, issue_date, due_date, reference, notes, terms,
                         discount_type, discount_percent, discount_amount_cents, shipping_cents, tax_mode, vat_rate,
                         shipping_taxable, deposit_type, deposit_percent, deposit_amount_cents, source_quote_id, created_by)
  values (p_kind, case when p_kind = 'quote' then app_next_number('quote') end, 'draft',
          case when p_kind = 'quote' then 'Quote' else 'Invoice' end,
          s.client_id, coalesce(app_client_snapshot(s.client_id), s.client_snapshot), current_date,
          current_date + case when p_kind = 'quote' then cs.quote_validity_days else cs.terms_days end,
          s.reference, s.notes, case when p_kind = s.kind then s.terms
                                     when p_kind = 'quote' then cs.quote_terms else cs.invoice_terms end,
          s.discount_type, s.discount_percent, s.discount_amount_cents, s.shipping_cents, s.tax_mode, s.vat_rate,
          s.shipping_taxable, s.deposit_type, s.deposit_percent, s.deposit_amount_cents,
          case when s.kind = 'quote' and p_kind = 'invoice' then s.id end, auth.uid())
  returning id into v_new;
  for l in select * from document_lines where document_id = s.id order by position loop
    insert into document_lines (document_id, position, service_id, name, description, qty, unit_price_cents, taxable, category)
    values (v_new, l.position, l.service_id, l.name, l.description, l.qty, l.unit_price_cents, l.taxable, l.category)
    returning id into v_line;
    insert into line_costs (line_id, document_id, unit_cost_cents, breakdown)
    select v_line, v_new, lc.unit_cost_cents, lc.breakdown from line_costs lc where lc.line_id = l.id;
  end loop;
  return v_new;
end $$;

-- quotes: declining needs a reason (that is the training signal for "why we lose")
create or replace function app_set_quote_status(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d documents; v_new text := p ->> 'status'; v_reason text := nullif(p ->> 'lost_reason', '');
begin
  perform app_require_member();
  select * into d from documents where id = (p ->> 'id')::uuid for update;
  if d.kind <> 'quote' then raise exception 'Not a quote'; end if;
  if v_new not in ('sent', 'accepted', 'declined') then raise exception 'Invalid quote status'; end if;
  if d.status not in ('sent', 'accepted', 'declined') then raise exception 'Issue the quote first'; end if;
  if v_new = 'declined' and v_reason is null then raise exception 'Choose why the quote was lost'; end if;
  update documents set status = v_new,
    lost_reason = case when v_new = 'declined' then v_reason else null end,
    lost_note = case when v_new = 'declined' then coalesce(p ->> 'lost_note', '') else '' end
  where id = d.id;
  return app_doc_json(d.id, app_is_owner());
end $$;

-- ---------- enquiries ----------
create or replace function app_list_enquiries(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_status text := nullif(p ->> 'status', ''); v_q text := '%' || lower(coalesce(p ->> 'q', '')) || '%';
begin
  perform app_require_member();
  return coalesce((
    select jsonb_agg(to_jsonb(e) || jsonb_build_object('quote_number', (select number from documents where id = e.quote_id))
           order by e.received_at desc)
    from (select * from enquiries x
          where (v_status is null or x.status = v_status)
            and (lower(x.name) like v_q or lower(x.company) like v_q or lower(x.email) like v_q or lower(x.message) like v_q)
          order by x.received_at desc limit least(coalesce((p ->> 'limit')::int, 200), 1000)) e
  ), '[]'::jsonb);
end $$;

create or replace function app_save_enquiry(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; r enquiries;
begin
  perform app_require_member();
  if v_id is null then
    insert into enquiries (received_at, source, name, email, phone, company, client_type, category, message, notes, created_by)
    values (coalesce((p ->> 'received_at')::timestamptz, now()), coalesce(nullif(p ->> 'source', ''), 'other'),
            coalesce(p ->> 'name', ''), coalesce(p ->> 'email', ''), coalesce(p ->> 'phone', ''), coalesce(p ->> 'company', ''),
            nullif(p ->> 'client_type', ''), nullif(p ->> 'category', ''), coalesce(p ->> 'message', ''),
            coalesce(p ->> 'notes', ''), auth.uid())
    returning * into r;
  else
    if (p ->> 'status') = 'turned_away' and nullif(p ->> 'turned_away_reason', '') is null then
      raise exception 'Choose why the work was turned away';
    end if;
    update enquiries e set
      status = coalesce(nullif(p ->> 'status', ''), e.status),
      turned_away_reason = case when coalesce(nullif(p ->> 'status', ''), e.status) = 'turned_away'
                                then coalesce(nullif(p ->> 'turned_away_reason', ''), e.turned_away_reason) else null end,
      category = case when p ? 'category' then nullif(p ->> 'category', '') else e.category end,
      client_type = case when p ? 'client_type' then nullif(p ->> 'client_type', '') else e.client_type end,
      notes = coalesce(p ->> 'notes', e.notes),
      client_id = coalesce(nullif(p ->> 'client_id', '')::uuid, e.client_id),
      quote_id = coalesce(nullif(p ->> 'quote_id', '')::uuid, e.quote_id),
      updated_at = now()
    where id = v_id returning * into r;
    if r.id is null then raise exception 'Enquiry not found'; end if;
  end if;
  return to_jsonb(r);
end $$;

-- Turn an enquiry into a client (matched by email, else created) ready for a quote
create or replace function app_enquiry_to_client(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare e enquiries; v_client uuid;
begin
  perform app_require_member();
  select * into e from enquiries where id = (p ->> 'id')::uuid for update;
  if e.id is null then raise exception 'Enquiry not found'; end if;
  v_client := e.client_id;
  if v_client is null and e.email <> '' then
    select id into v_client from clients where lower(email) = lower(e.email) limit 1;
  end if;
  if v_client is null then
    insert into clients (name, contact_person, email, phone, client_type, lead_source, created_by)
    values (coalesce(nullif(e.company, ''), nullif(e.name, ''), 'New client'),
            case when e.company <> '' then e.name else '' end, e.email, e.phone, e.client_type,
            case e.source when 'website' then 'website' when 'whatsapp' then 'whatsapp' when 'phone' then 'phone'
                          when 'email' then 'email' when 'walk_in' then 'walk_in' when 'referral' then 'referral'
                          when 'social' then 'social' else 'other' end,
            auth.uid())
    returning id into v_client;
  end if;
  update enquiries set client_id = v_client, updated_at = now() where id = e.id;
  return jsonb_build_object('client_id', v_client, 'enquiry_id', e.id, 'category', e.category);
end $$;

-- ---------- insights dataset (owner) ----------
-- Everything the Insights page needs, in one compact payload. The models run
-- in the owner's browser; nothing is sent to any third party.
create or replace function app_insights_data(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_owner();
  return jsonb_build_object(
    'today', current_date,
    'clients', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'client_type', client_type,
                 'lead_source', lead_source, 'created_at', created_at::date)) from clients), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', d.id, 'kind', d.kind, 'status', d.status, 'client_id', d.client_id, 'issue_date', d.issue_date,
                 'due_date', d.due_date, 'total_cents', d.total_cents, 'vat_cents', d.vat_cents, 'paid_cents', d.paid_cents,
                 'deposit_type', d.deposit_type, 'discount_cents', d.discount_cents, 'lost_reason', d.lost_reason,
                 'source_quote_id', d.source_quote_id, 'imported', d.imported,
                 'cost_cents', (select sum(app_cents(lc.unit_cost_cents * l.qty)) from document_lines l
                                join line_costs lc on lc.line_id = l.id where l.document_id = d.id),
                 'fully_paid_on', case when d.status = 'paid' then
                     (select max(y.paid_on) from payments y where y.invoice_id = d.id and not y.voided) end))
                 from documents d where d.status <> 'void'), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('document_id', l.document_id, 'category', l.category,
                 'name', l.name, 'description', l.description, 'amount_cents', l.line_total_cents))
                 from document_lines l join documents d on d.id = l.document_id where d.status <> 'void'), '[]'::jsonb),
    'enquiries', coalesce((select jsonb_agg(jsonb_build_object('received_at', received_at::date, 'source', source,
                 'client_type', client_type, 'category', category, 'status', status, 'turned_away_reason', turned_away_reason,
                 'message', left(message, 1000)))
                 from enquiries where status <> 'spam'), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label)) from service_categories), '[]'::jsonb)
  );
end $$;

-- ---------- privileges ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('app_list_categories','app_save_category','app_save_client',
             'app_save_service','app_save_document','app_copy_document','app_set_quote_status','app_list_enquiries',
             'app_save_enquiry','app_enquiry_to_client','app_insights_data') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname <> 'app_copy_document' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
