-- =====================================================================
-- Ceazers 3D - private admin application schema (Supabase / Postgres)
-- =====================================================================
-- Design rules
--   * Money is stored as integer cents (bigint). Quantities numeric(12,3).
--   * Rounding is half-away-from-zero (Postgres round(numeric)); the
--     browser mirror in admin/js/calc.js uses the same rule.
--   * The browser NEVER writes tables directly. Authenticated users get
--     SELECT only (filtered by RLS); every write goes through a
--     SECURITY DEFINER function (app_*) that checks membership/role and
--     enforces the business rules. anon gets nothing.
--   * Client-facing data (documents, document_lines) and internal costing
--     (line_costs, service_costs, cost_settings, materials) live in
--     separate tables so RLS can hide costing from staff entirely.
--   * Issued documents are locked; changes create revisions (quotes) or
--     require void + duplicate (invoices). Nothing issued is hard-deleted.
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+ (no extension needed)

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
do $$ begin
  create type app_role as enum ('owner', 'staff');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        app_role not null default 'staff',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists company_settings (
  id                    int primary key default 1 check (id = 1),
  name                  text not null default 'Ceazers 3D Engineering Solutions',
  legal_name            text not null default 'Ceazers 3D Engineering Solutions (Pty) Ltd',
  email                 text not null default '',
  phone                 text not null default '',
  address               text not null default '',
  vat_number            text not null default '',
  registration_number   text not null default '',
  bank_name             text not null default '',
  bank_account          text not null default '',
  bank_holder           text not null default '',
  bank_branch_code      text not null default '',
  logo_path             text,
  signature_path        text,
  signatory_label       text not null default 'Signature C3D Eng. Sol.',
  terms_days            int  not null default 7  check (terms_days between 0 and 365),
  quote_validity_days   int  not null default 30 check (quote_validity_days between 0 and 365),
  quote_prefix          text not null default 'QU' check (quote_prefix ~ '^[A-Za-z0-9-]{0,10}$'),
  quote_next            bigint not null default 1 check (quote_next > 0),
  quote_padding         int  not null default 6 check (quote_padding between 1 and 12),
  invoice_prefix        text not null default 'IN' check (invoice_prefix ~ '^[A-Za-z0-9-]{0,10}$'),
  invoice_next          bigint not null default 1 check (invoice_next > 0),
  invoice_padding       int  not null default 5 check (invoice_padding between 1 and 12),
  tax_mode              text not null default 'exclusive' check (tax_mode in ('none', 'exclusive', 'inclusive')),
  vat_rate              numeric(6,3) not null default 15 check (vat_rate >= 0 and vat_rate <= 100),
  shipping_taxable      boolean not null default true,
  default_deposit_percent numeric(6,3) not null default 50 check (default_deposit_percent between 0 and 100),
  currency_symbol       text not null default 'R',
  currency_position     text not null default 'front' check (currency_position in ('front', 'back')),
  thousand_separator    text not null default ',' check (length(thousand_separator) <= 1),
  decimal_separator     text not null default '.' check (length(decimal_separator) = 1),
  decimal_places        int  not null default 2 check (decimal_places between 0 and 2),
  date_format           text not null default 'DD/MMM/YYYY',
  email_subject         text not null default '{type} {number} from {company}',
  email_body            text not null default '',
  email_cc              text not null default '',
  email_bcc             text not null default '',
  footer_note           text not null default 'Thanks for your business!',
  quote_terms           text not null default '',
  invoice_terms         text not null default '',
  idle_timeout_minutes  int  not null default 30 check (idle_timeout_minutes between 5 and 480),
  updated_at            timestamptz not null default now()
);
insert into company_settings (id) values (1) on conflict do nothing;

-- Internal costing defaults (owner only)
create table if not exists cost_settings (
  id                        int primary key default 1 check (id = 1),
  machine_rate_cents        bigint not null default 2500  check (machine_rate_cents >= 0),  -- per print hour
  electricity_rate_cents    bigint not null default 300   check (electricity_rate_cents >= 0), -- per print hour
  labour_rate_cents         bigint not null default 15000 check (labour_rate_cents >= 0),  -- per hour
  design_rate_cents         bigint not null default 40000 check (design_rate_cents >= 0),  -- per hour
  overhead_percent          numeric(6,3) not null default 10 check (overhead_percent between 0 and 500),
  failure_allowance_percent numeric(6,3) not null default 5  check (failure_allowance_percent between 0 and 500),
  default_markup_percent    numeric(7,3) not null default 60 check (default_markup_percent between 0 and 1000),
  updated_at                timestamptz not null default now()
);
insert into cost_settings (id) values (1) on conflict do nothing;

create table if not exists materials (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique check (length(name) between 1 and 80),
  cost_per_kg_cents bigint not null check (cost_per_kg_cents >= 0),
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists clients (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(name) between 1 and 200),
  contact_person   text not null default '',
  email            text not null default '',
  phone            text not null default '',
  billing_address  text not null default '',
  shipping_address text not null default '',
  vat_number       text not null default '',
  notes            text not null default '',
  archived         boolean not null default false,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists clients_name_idx on clients (lower(name));

-- Saved services / items catalogue (client-facing fields only)
create table if not exists services (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(name) between 1 and 200),
  description      text not null default '',
  unit             text not null default 'each',
  unit_price_cents bigint not null default 0,
  taxable          boolean not null default true,
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Internal cost recipe for a service (owner only)
create table if not exists service_costs (
  service_id         uuid primary key references services (id) on delete cascade,
  material_id        uuid references materials (id),
  material_grams     numeric(12,3) not null default 0 check (material_grams >= 0),
  print_hours        numeric(10,3) not null default 0 check (print_hours >= 0),
  labour_hours       numeric(10,3) not null default 0 check (labour_hours >= 0),
  design_hours       numeric(10,3) not null default 0 check (design_hours >= 0),
  other_cost_cents   bigint not null default 0 check (other_cost_cents >= 0),
  unit_cost_cents    bigint not null default 0,
  notes              text not null default '',
  updated_at         timestamptz not null default now()
);

create table if not exists documents (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('quote', 'invoice')),
  number                text,
  status                text not null default 'draft'
                        check (status in ('draft', 'sent', 'accepted', 'declined', 'converted',
                                          'issued', 'partially_paid', 'paid', 'void')),
  title                 text not null default '',
  client_id             uuid references clients (id),
  client_snapshot       jsonb not null default '{}'::jsonb,
  company_snapshot      jsonb,
  issue_date            date not null default current_date,
  due_date              date,          -- invoices: payment due; quotes: valid until
  reference             text not null default '',
  notes                 text not null default '',   -- printed on the document
  terms                 text not null default '',   -- printed on the document
  internal_notes        text not null default '',   -- never printed
  discount_type         text not null default 'none' check (discount_type in ('none', 'percent', 'amount')),
  discount_percent      numeric(7,4) not null default 0 check (discount_percent between 0 and 100),
  discount_amount_cents bigint not null default 0 check (discount_amount_cents >= 0),
  shipping_cents        bigint not null default 0 check (shipping_cents >= 0),
  tax_mode              text not null default 'exclusive' check (tax_mode in ('none', 'exclusive', 'inclusive')),
  vat_rate              numeric(6,3) not null default 15 check (vat_rate between 0 and 100),
  shipping_taxable      boolean not null default true,
  deposit_type          text not null default 'none' check (deposit_type in ('none', 'percent', 'amount')),
  deposit_percent       numeric(7,4) not null default 0 check (deposit_percent between 0 and 100),
  deposit_amount_cents  bigint not null default 0 check (deposit_amount_cents >= 0),
  -- computed by trigger, never trusted from input
  subtotal_cents        bigint not null default 0,
  discount_cents        bigint not null default 0,
  taxable_cents         bigint not null default 0,
  vat_cents             bigint not null default 0,
  total_cents           bigint not null default 0,
  deposit_cents         bigint not null default 0,
  paid_cents            bigint not null default 0,
  balance_cents         bigint not null default 0,
  source_quote_id       uuid references documents (id),
  revision              int  not null default 1,
  locked                boolean not null default false,
  imported              boolean not null default false,
  imported_total_cents  bigint,
  issued_at             timestamptz,
  void_reason           text,
  voided_at             timestamptz,
  created_by            uuid references auth.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists documents_number_uniq on documents (kind, number) where number is not null;
create index if not exists documents_kind_date_idx on documents (kind, issue_date desc);
create index if not exists documents_client_idx on documents (client_id);

create table if not exists document_lines (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references documents (id) on delete cascade,
  position         int  not null default 0,
  service_id       uuid references services (id),
  name             text not null default '' check (length(name) <= 300),
  description      text not null default '' check (length(description) <= 2000),
  qty              numeric(12,3) not null default 1,
  unit_price_cents bigint not null default 0,
  taxable          boolean not null default true,
  line_total_cents bigint not null default 0
);
create index if not exists document_lines_doc_idx on document_lines (document_id, position);

-- Internal cost of each line (owner only, never printed)
create table if not exists line_costs (
  line_id          uuid primary key references document_lines (id) on delete cascade,
  document_id      uuid not null references documents (id) on delete cascade,
  unit_cost_cents  bigint not null default 0 check (unit_cost_cents >= 0),
  breakdown        jsonb not null default '{}'::jsonb
);
create index if not exists line_costs_doc_idx on line_costs (document_id);

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references documents (id),
  paid_on      date not null default current_date,
  amount_cents bigint not null check (amount_cents > 0),
  method       text not null default 'eft' check (method in ('eft', 'cash', 'card', 'other')),
  reference    text not null default '',
  is_deposit   boolean not null default false,
  notes        text not null default '',
  voided       boolean not null default false,
  void_reason  text,
  imported     boolean not null default false,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);
create index if not exists payments_invoice_idx on payments (invoice_id);

-- Frozen copy of every issued revision (client-facing data only)
create table if not exists document_revisions (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id),
  revision    int  not null,
  snapshot    jsonb not null,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  unique (document_id, revision)
);

-- Private PDFs in Supabase Storage (bucket "documents")
create table if not exists document_files (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents (id),
  revision     int  not null,
  storage_path text not null unique check (storage_path ~ '^(quote|invoice)s/[0-9a-f-]{36}/[A-Za-z0-9._-]+\.pdf$'),
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);

create table if not exists audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  table_name text not null,
  row_id     text,
  action     text not null,
  old_data   jsonb,
  new_data   jsonb
);
create index if not exists audit_log_row_idx on audit_log (table_name, row_id);

-- ---------------------------------------------------------------------
-- Helpers: identity, membership, rounding
-- ---------------------------------------------------------------------
-- Active profile AND (aal2 session OR no verified MFA factor). Once a user
-- enrols MFA, a password-only session cannot read or write anything.
create or replace function app_is_member() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.active)
     and (coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
          or not exists (select 1 from auth.mfa_factors f
                         where f.user_id = auth.uid() and f.status::text = 'verified'));
$$;

create or replace function app_is_owner() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select app_is_member() and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'owner');
$$;

create or replace function app_require_member() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_is_member() then raise exception 'Not authorised' using errcode = '42501'; end if;
end $$;

create or replace function app_require_owner() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_is_owner() then raise exception 'Owner access required' using errcode = '42501'; end if;
end $$;

-- money helpers
create or replace function app_cents(v numeric) returns bigint
language sql immutable as $$ select round(coalesce(v, 0))::bigint $$;

create or replace function app_format_number(prefix text, n bigint, padding int) returns text
language sql immutable as $$
  select prefix || case when length(n::text) >= padding then n::text else lpad(n::text, padding, '0') end
$$;

-- ---------------------------------------------------------------------
-- Calculations (mirrored exactly by admin/js/calc.js)
-- ---------------------------------------------------------------------
create or replace function app_compute_totals(d documents) returns documents
language plpgsql stable security definer set search_path = public as $$
declare
  v_sub bigint; v_tax_lines bigint; v_disc bigint; v_tax_after bigint;
  v_base bigint; v_vat bigint; v_total bigint; v_dep bigint; v_paid bigint;
begin
  select coalesce(sum(line_total_cents), 0), coalesce(sum(line_total_cents) filter (where taxable), 0)
    into v_sub, v_tax_lines from document_lines where document_id = d.id;

  v_disc := case d.discount_type
              when 'percent' then app_cents(v_sub * d.discount_percent / 100)
              when 'amount'  then d.discount_amount_cents
              else 0 end;
  v_disc := greatest(0, least(v_disc, greatest(v_sub, 0)));

  -- discount is spread over taxable and non-taxable lines in proportion
  v_tax_after := v_tax_lines - case when v_sub <> 0 then app_cents(v_disc::numeric * v_tax_lines / v_sub) else 0 end;
  v_base := v_tax_after + case when d.shipping_taxable then d.shipping_cents else 0 end;

  if d.tax_mode = 'exclusive' then
    v_vat := app_cents(v_base * d.vat_rate / 100);
    v_total := v_sub - v_disc + d.shipping_cents + v_vat;
  elsif d.tax_mode = 'inclusive' then
    v_vat := app_cents(v_base * d.vat_rate / (100 + d.vat_rate));
    v_total := v_sub - v_disc + d.shipping_cents;
  else
    v_base := 0; v_vat := 0;
    v_total := v_sub - v_disc + d.shipping_cents;
  end if;

  v_dep := case d.deposit_type
             when 'percent' then app_cents(v_total * d.deposit_percent / 100)
             when 'amount'  then least(d.deposit_amount_cents, greatest(v_total, 0))
             else 0 end;

  select coalesce(sum(amount_cents), 0) into v_paid
    from payments where invoice_id = d.id and not voided;

  d.subtotal_cents := v_sub;
  d.discount_cents := v_disc;
  d.taxable_cents  := v_base;
  d.vat_cents      := v_vat;
  d.total_cents    := v_total;
  d.deposit_cents  := v_dep;
  d.paid_cents     := v_paid;
  d.balance_cents  := v_total - v_paid;

  -- invoice payment status is derived, never set by hand
  if d.kind = 'invoice' and d.status in ('issued', 'partially_paid', 'paid') then
    d.status := case when v_paid > 0 and v_paid >= v_total then 'paid'
                     when v_paid > 0 then 'partially_paid'
                     else 'issued' end;
  end if;
  return d;
end $$;

-- ---------------------------------------------------------------------
-- Triggers: totals, locking, line maths, audit
-- ---------------------------------------------------------------------
create or replace function trg_documents_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.number is not null and new.number is distinct from old.number then
      raise exception 'Document numbers cannot be changed';
    end if;
    if new.kind <> old.kind then raise exception 'Document type cannot be changed'; end if;
    if old.status = 'void' and new.status <> 'void' then raise exception 'Void documents cannot be reopened'; end if;
    if old.locked and not new.locked and current_setting('app.allow_unlock', true) is distinct from 'on' then
      raise exception 'Issued documents are locked';
    end if;
    if old.locked and new.locked and (
         new.client_id, new.client_snapshot, new.company_snapshot, new.issue_date, new.due_date,
         new.title, new.reference, new.notes, new.terms, new.discount_type, new.discount_percent,
         new.discount_amount_cents, new.shipping_cents, new.tax_mode, new.vat_rate, new.shipping_taxable,
         new.deposit_type, new.deposit_percent, new.deposit_amount_cents, new.revision, new.imported_total_cents)
       is distinct from (
         old.client_id, old.client_snapshot, old.company_snapshot, old.issue_date, old.due_date,
         old.title, old.reference, old.notes, old.terms, old.discount_type, old.discount_percent,
         old.discount_amount_cents, old.shipping_cents, old.tax_mode, old.vat_rate, old.shipping_taxable,
         old.deposit_type, old.deposit_percent, old.deposit_amount_cents, old.revision, old.imported_total_cents)
    then
      raise exception 'Issued documents are locked';
    end if;
  end if;
  new := app_compute_totals(new);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists documents_before on documents;
create trigger documents_before before insert or update on documents
  for each row execute function trg_documents_before();

create or replace function trg_lines_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_locked boolean;
begin
  select locked into v_locked from documents
   where id = case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  if coalesce(v_locked, false) then raise exception 'Issued documents are locked'; end if;
  if tg_op = 'UPDATE' and new.document_id <> old.document_id then
    raise exception 'Lines cannot move between documents';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.line_total_cents := app_cents(new.qty * new.unit_price_cents);
  return new;
end $$;

drop trigger if exists lines_before on document_lines;
create trigger lines_before before insert or update or delete on document_lines
  for each row execute function trg_lines_before();

-- touch the parent so its totals are recomputed
create or replace function trg_touch_document() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  if v_id is null and tg_table_name = 'payments' then
    v_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  end if;
  update documents set updated_at = now() where id = v_id;
  return null;
end $$;

drop trigger if exists lines_after on document_lines;
create trigger lines_after after insert or update or delete on document_lines
  for each row execute function trg_touch_document();

create or replace function trg_payments_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update documents set updated_at = now()
   where id = case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  return null;
end $$;

drop trigger if exists payments_after on payments;
create trigger payments_after after insert or update or delete on payments
  for each row execute function trg_payments_touch();

-- payments are append-only apart from voiding
create or replace function trg_payments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Payments cannot be deleted; void them instead'; end if;
  if (new.invoice_id, new.paid_on, new.amount_cents, new.method, new.reference, new.is_deposit)
     is distinct from (old.invoice_id, old.paid_on, old.amount_cents, old.method, old.reference, old.is_deposit) then
    raise exception 'Recorded payments cannot be edited; void and re-record instead';
  end if;
  if old.voided and not new.voided then raise exception 'Voided payments cannot be restored'; end if;
  return new;
end $$;

drop trigger if exists payments_guard on payments;
create trigger payments_guard before update or delete on payments
  for each row execute function trg_payments_guard();

-- issued revisions and stored PDFs are immutable
create or replace function trg_immutable() returns trigger
language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end $$;

drop trigger if exists revisions_immutable on document_revisions;
create trigger revisions_immutable before update or delete on document_revisions
  for each row execute function trg_immutable();
drop trigger if exists files_immutable on document_files;
create trigger files_immutable before update or delete on document_files
  for each row execute function trg_immutable();
drop trigger if exists audit_immutable on audit_log;
create trigger audit_immutable before update or delete on audit_log
  for each row execute function trg_immutable();

create or replace function trg_audit() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare v_old jsonb; v_new jsonb; v_id text;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_id  := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'line_id', v_old ->> 'line_id',
                    v_new ->> 'service_id', v_old ->> 'service_id');
  -- skip pure totals/timestamp refreshes to keep the log readable
  if tg_op = 'UPDATE' and (v_old - 'updated_at' - 'paid_cents' - 'balance_cents' - 'status' - 'quote_next' - 'invoice_next')
                         = (v_new - 'updated_at' - 'paid_cents' - 'balance_cents' - 'status' - 'quote_next' - 'invoice_next')
     and v_old ->> 'status' is not distinct from v_new ->> 'status' then
    return null;
  end if;
  insert into audit_log (actor, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), tg_table_name, v_id, lower(tg_op), v_old, v_new);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','company_settings','cost_settings','materials','clients','services',
                           'service_costs','documents','document_lines','line_costs','payments'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I
                    for each row execute function trg_audit()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row level security: SELECT only. Writes go through app_* functions.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','company_settings','cost_settings','materials','clients','services',
                           'service_costs','documents','document_lines','line_costs','payments',
                           'document_revisions','document_files','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
  end loop;
end $$;

-- members: client-facing data
create policy company_settings_select   on company_settings   for select to authenticated using (app_is_member());
create policy clients_select            on clients            for select to authenticated using (app_is_member());
create policy services_select           on services           for select to authenticated using (app_is_member());
create policy documents_select          on documents          for select to authenticated using (app_is_member());
create policy document_lines_select     on document_lines     for select to authenticated using (app_is_member());
create policy payments_select           on payments           for select to authenticated using (app_is_member());
create policy document_revisions_select on document_revisions for select to authenticated using (app_is_member());
create policy document_files_select     on document_files     for select to authenticated using (app_is_member());
-- own profile, or everyone's for the owner
create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or app_is_owner());
-- owner only: internal costing and audit
create policy cost_settings_select on cost_settings for select to authenticated using (app_is_owner());
create policy materials_select     on materials     for select to authenticated using (app_is_owner());
create policy service_costs_select on service_costs for select to authenticated using (app_is_owner());
create policy line_costs_select    on line_costs    for select to authenticated using (app_is_owner());
create policy audit_log_select     on audit_log     for select to authenticated using (app_is_owner());

revoke all on all sequences in schema public from anon, authenticated;

-- =====================================================================
-- API functions (called via supabase.rpc(name, { p: {...} }))
-- All take a single jsonb argument "p" and return jsonb.
-- =====================================================================

create or replace function app_settings_json(include_costs boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(c) - 'id'
         || case when include_costs then jsonb_build_object('costing', (select to_jsonb(k) - 'id' from cost_settings k where id = 1))
                 else '{}'::jsonb end
  from company_settings c where id = 1
$$;

create or replace function app_me(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare v profiles; v_factor boolean;
begin
  select * into v from profiles where id = auth.uid();
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified') into v_factor;
  return jsonb_build_object(
    'id', auth.uid(), 'email', v.email, 'full_name', v.full_name, 'role', v.role,
    'active', coalesce(v.active, false), 'member', app_is_member(),
    'mfa_enrolled', v_factor,
    'needs_mfa', coalesce(v.active, false) and v_factor and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2');
end $$;

create or replace function app_get_settings(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_member();
  return app_settings_json(app_is_owner());
end $$;

create or replace function app_save_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb;
begin
  perform app_require_owner();
  update company_settings s set
    name = coalesce(p ->> 'name', s.name),
    legal_name = coalesce(p ->> 'legal_name', s.legal_name),
    email = coalesce(p ->> 'email', s.email),
    phone = coalesce(p ->> 'phone', s.phone),
    address = coalesce(p ->> 'address', s.address),
    vat_number = coalesce(p ->> 'vat_number', s.vat_number),
    registration_number = coalesce(p ->> 'registration_number', s.registration_number),
    bank_name = coalesce(p ->> 'bank_name', s.bank_name),
    bank_account = coalesce(p ->> 'bank_account', s.bank_account),
    bank_holder = coalesce(p ->> 'bank_holder', s.bank_holder),
    bank_branch_code = coalesce(p ->> 'bank_branch_code', s.bank_branch_code),
    logo_path = case when p ? 'logo_path' then nullif(p ->> 'logo_path', '') else s.logo_path end,
    signature_path = case when p ? 'signature_path' then nullif(p ->> 'signature_path', '') else s.signature_path end,
    signatory_label = coalesce(p ->> 'signatory_label', s.signatory_label),
    terms_days = coalesce((p ->> 'terms_days')::int, s.terms_days),
    quote_validity_days = coalesce((p ->> 'quote_validity_days')::int, s.quote_validity_days),
    quote_prefix = coalesce(p ->> 'quote_prefix', s.quote_prefix),
    quote_padding = coalesce((p ->> 'quote_padding')::int, s.quote_padding),
    invoice_prefix = coalesce(p ->> 'invoice_prefix', s.invoice_prefix),
    invoice_padding = coalesce((p ->> 'invoice_padding')::int, s.invoice_padding),
    tax_mode = coalesce(p ->> 'tax_mode', s.tax_mode),
    vat_rate = coalesce((p ->> 'vat_rate')::numeric, s.vat_rate),
    shipping_taxable = coalesce((p ->> 'shipping_taxable')::boolean, s.shipping_taxable),
    default_deposit_percent = coalesce((p ->> 'default_deposit_percent')::numeric, s.default_deposit_percent),
    currency_symbol = coalesce(p ->> 'currency_symbol', s.currency_symbol),
    currency_position = coalesce(p ->> 'currency_position', s.currency_position),
    thousand_separator = coalesce(p ->> 'thousand_separator', s.thousand_separator),
    decimal_separator = coalesce(p ->> 'decimal_separator', s.decimal_separator),
    decimal_places = coalesce((p ->> 'decimal_places')::int, s.decimal_places),
    date_format = coalesce(p ->> 'date_format', s.date_format),
    email_subject = coalesce(p ->> 'email_subject', s.email_subject),
    email_body = coalesce(p ->> 'email_body', s.email_body),
    email_cc = coalesce(p ->> 'email_cc', s.email_cc),
    email_bcc = coalesce(p ->> 'email_bcc', s.email_bcc),
    footer_note = coalesce(p ->> 'footer_note', s.footer_note),
    quote_terms = coalesce(p ->> 'quote_terms', s.quote_terms),
    invoice_terms = coalesce(p ->> 'invoice_terms', s.invoice_terms),
    idle_timeout_minutes = coalesce((p ->> 'idle_timeout_minutes')::int, s.idle_timeout_minutes),
    updated_at = now()
  where id = 1;

  if p ? 'costing' then
    c := p -> 'costing';
    update cost_settings k set
      machine_rate_cents = coalesce((c ->> 'machine_rate_cents')::bigint, k.machine_rate_cents),
      electricity_rate_cents = coalesce((c ->> 'electricity_rate_cents')::bigint, k.electricity_rate_cents),
      labour_rate_cents = coalesce((c ->> 'labour_rate_cents')::bigint, k.labour_rate_cents),
      design_rate_cents = coalesce((c ->> 'design_rate_cents')::bigint, k.design_rate_cents),
      overhead_percent = coalesce((c ->> 'overhead_percent')::numeric, k.overhead_percent),
      failure_allowance_percent = coalesce((c ->> 'failure_allowance_percent')::numeric, k.failure_allowance_percent),
      default_markup_percent = coalesce((c ->> 'default_markup_percent')::numeric, k.default_markup_percent),
      updated_at = now()
    where id = 1;
  end if;
  return app_settings_json(true);
end $$;

-- Next number: atomic (row lock on company_settings), skips numbers that
-- already exist (e.g. imported history), never reuses a number.
create or replace function app_next_number(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare v_prefix text; v_pad int; v_n bigint; v_num text;
begin
  loop
    if p_kind = 'quote' then
      update company_settings set quote_next = quote_next + 1 where id = 1
        returning quote_prefix, quote_padding, quote_next - 1 into v_prefix, v_pad, v_n;
    elsif p_kind = 'invoice' then
      update company_settings set invoice_next = invoice_next + 1 where id = 1
        returning invoice_prefix, invoice_padding, invoice_next - 1 into v_prefix, v_pad, v_n;
    else
      raise exception 'Unknown document type %', p_kind;
    end if;
    v_num := app_format_number(v_prefix, v_n, v_pad);
    exit when not exists (select 1 from documents where kind = p_kind and number = v_num);
  end loop;
  return v_num;
end $$;

create or replace function app_set_next_number(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_kind text := p ->> 'kind'; v_next bigint := (p ->> 'next')::bigint; v_num text;
begin
  perform app_require_owner();
  if v_next is null or v_next < 1 then raise exception 'Next number must be a positive whole number'; end if;
  if v_kind = 'quote' then
    select app_format_number(quote_prefix, v_next, quote_padding) into v_num from company_settings where id = 1;
  elsif v_kind = 'invoice' then
    select app_format_number(invoice_prefix, v_next, invoice_padding) into v_num from company_settings where id = 1;
  else raise exception 'Unknown document type'; end if;
  if exists (select 1 from documents where kind = v_kind and number = v_num) then
    raise exception '% is already used', v_num;
  end if;
  if v_kind = 'quote' then update company_settings set quote_next = v_next where id = 1;
  else update company_settings set invoice_next = v_next where id = 1; end if;
  return jsonb_build_object('next', v_num);
end $$;

-- ---------- materials (owner) ----------
create or replace function app_list_materials(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_owner();
  return coalesce((select jsonb_agg(to_jsonb(m) order by m.name) from materials m
                   where coalesce((p ->> 'include_archived')::boolean, false) or not m.archived), '[]'::jsonb);
end $$;

create or replace function app_save_material(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; r materials;
begin
  perform app_require_owner();
  if v_id is null then
    insert into materials (name, cost_per_kg_cents) values (trim(p ->> 'name'), (p ->> 'cost_per_kg_cents')::bigint) returning * into r;
  else
    update materials set name = coalesce(trim(p ->> 'name'), name),
      cost_per_kg_cents = coalesce((p ->> 'cost_per_kg_cents')::bigint, cost_per_kg_cents),
      archived = coalesce((p ->> 'archived')::boolean, archived), updated_at = now()
    where id = v_id returning * into r;
  end if;
  return to_jsonb(r);
end $$;

-- ---------- clients ----------
create or replace function app_list_clients(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := '%' || lower(coalesce(p ->> 'q', '')) || '%';
begin
  perform app_require_member();
  return coalesce((
    select jsonb_agg(to_jsonb(c) || jsonb_build_object(
             'open_balance_cents', coalesce((select sum(balance_cents) from documents d
                where d.client_id = c.id and d.kind = 'invoice' and d.status in ('issued', 'partially_paid')), 0))
           order by lower(c.name))
    from clients c
    where (coalesce((p ->> 'include_archived')::boolean, false) or not c.archived)
      and (lower(c.name) like v_q or lower(c.email) like v_q or lower(c.contact_person) like v_q or c.phone like v_q)
  ), '[]'::jsonb);
end $$;

create or replace function app_save_client(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; r clients;
begin
  perform app_require_member();
  if coalesce(trim(p ->> 'name'), '') = '' and v_id is null then raise exception 'Client name is required'; end if;
  if v_id is null then
    insert into clients (name, contact_person, email, phone, billing_address, shipping_address, vat_number, notes, created_by)
    values (trim(p ->> 'name'), coalesce(p ->> 'contact_person', ''), coalesce(p ->> 'email', ''), coalesce(p ->> 'phone', ''),
            coalesce(p ->> 'billing_address', ''), coalesce(p ->> 'shipping_address', ''), coalesce(p ->> 'vat_number', ''),
            coalesce(p ->> 'notes', ''), auth.uid())
    returning * into r;
  else
    update clients c set
      name = coalesce(nullif(trim(p ->> 'name'), ''), c.name),
      contact_person = coalesce(p ->> 'contact_person', c.contact_person),
      email = coalesce(p ->> 'email', c.email), phone = coalesce(p ->> 'phone', c.phone),
      billing_address = coalesce(p ->> 'billing_address', c.billing_address),
      shipping_address = coalesce(p ->> 'shipping_address', c.shipping_address),
      vat_number = coalesce(p ->> 'vat_number', c.vat_number), notes = coalesce(p ->> 'notes', c.notes),
      archived = coalesce((p ->> 'archived')::boolean, c.archived), updated_at = now()
    where id = v_id returning * into r;
    if r.id is null then raise exception 'Client not found'; end if;
  end if;
  return to_jsonb(r);
end $$;

-- ---------- services + internal costing ----------
create or replace function app_cost_of(p jsonb) returns bigint
language plpgsql stable security definer set search_path = public as $$
-- unit cost = (material + machine + electricity + labour + design + other)
--             x (1 + failure%) x (1 + overhead%)
declare k cost_settings; v_mat bigint := 0; v_kg bigint; v_direct numeric;
begin
  select * into k from cost_settings where id = 1;
  if nullif(p ->> 'material_id', '') is not null then
    select cost_per_kg_cents into v_kg from materials where id = (p ->> 'material_id')::uuid;
    v_mat := app_cents(coalesce(v_kg, 0) * coalesce((p ->> 'material_grams')::numeric, 0) / 1000);
  end if;
  v_direct := v_mat
    + coalesce((p ->> 'print_hours')::numeric, 0) * (k.machine_rate_cents + k.electricity_rate_cents)
    + coalesce((p ->> 'labour_hours')::numeric, 0) * k.labour_rate_cents
    + coalesce((p ->> 'design_hours')::numeric, 0) * k.design_rate_cents
    + coalesce((p ->> 'other_cost_cents')::numeric, 0);
  return app_cents(v_direct * (1 + k.failure_allowance_percent / 100) * (1 + k.overhead_percent / 100));
end $$;

create or replace function app_list_services(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner boolean := app_is_owner(); v_q text := '%' || lower(coalesce(p ->> 'q', '')) || '%';
begin
  perform app_require_member();
  return coalesce((
    select jsonb_agg(to_jsonb(s) || case when v_owner then jsonb_build_object('costing', (select to_jsonb(sc) from service_costs sc where sc.service_id = s.id)) else '{}'::jsonb end
           order by lower(s.name))
    from services s
    where (coalesce((p ->> 'include_archived')::boolean, false) or not s.archived)
      and (lower(s.name) like v_q or lower(s.description) like v_q)
  ), '[]'::jsonb);
end $$;

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
    insert into services (name, description, unit, unit_price_cents, taxable)
    values (trim(p ->> 'name'), coalesce(p ->> 'description', ''), coalesce(nullif(p ->> 'unit', ''), 'each'),
            coalesce((p ->> 'unit_price_cents')::bigint, 0), coalesce((p ->> 'taxable')::boolean, true))
    returning * into r;
  else
    update services s set name = coalesce(nullif(trim(p ->> 'name'), ''), s.name),
      description = coalesce(p ->> 'description', s.description), unit = coalesce(nullif(p ->> 'unit', ''), s.unit),
      unit_price_cents = coalesce((p ->> 'unit_price_cents')::bigint, s.unit_price_cents),
      taxable = coalesce((p ->> 'taxable')::boolean, s.taxable),
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

create or replace function app_estimate_cost(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cost bigint; v_markup numeric;
begin
  perform app_require_owner();
  v_cost := app_cost_of(p);
  select coalesce((p ->> 'markup_percent')::numeric, default_markup_percent) into v_markup from cost_settings where id = 1;
  return jsonb_build_object('unit_cost_cents', v_cost, 'markup_percent', v_markup,
                            'suggested_price_cents', app_cents(v_cost * (1 + v_markup / 100)));
end $$;

-- ---------- documents ----------
create or replace function app_doc_json(p_id uuid, p_with_costs boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(d)
    || jsonb_build_object(
      'lines', coalesce((select jsonb_agg(to_jsonb(l) || case when p_with_costs then jsonb_build_object(
                  'cost', (select jsonb_build_object('unit_cost_cents', lc.unit_cost_cents, 'breakdown', lc.breakdown)
                           from line_costs lc where lc.line_id = l.id)) else '{}'::jsonb end
                  order by l.position) from document_lines l where l.document_id = d.id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(to_jsonb(y) order by y.paid_on, y.created_at) from payments y where y.invoice_id = d.id), '[]'::jsonb),
      'revisions', coalesce((select jsonb_agg(jsonb_build_object('revision', r.revision, 'created_at', r.created_at) order by r.revision)
                             from document_revisions r where r.document_id = d.id), '[]'::jsonb),
      'files', coalesce((select jsonb_agg(jsonb_build_object('revision', f.revision, 'storage_path', f.storage_path, 'created_at', f.created_at) order by f.created_at)
                         from document_files f where f.document_id = d.id), '[]'::jsonb),
      'source_quote_number', (select q.number from documents q where q.id = d.source_quote_id),
      'invoice_ids', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status))
                               from documents i where i.source_quote_id = d.id), '[]'::jsonb),
      'overdue', d.kind = 'invoice' and d.status in ('issued', 'partially_paid') and d.due_date < current_date and d.balance_cents > 0,
      'expired', d.kind = 'quote' and d.status in ('draft', 'sent') and d.due_date < current_date
    )
    || case when p_with_costs then (
      select jsonb_build_object('cost_total_cents', coalesce(sum(app_cents(lc.unit_cost_cents * l.qty)), 0))
      from document_lines l left join line_costs lc on lc.line_id = l.id where l.document_id = d.id) else '{}'::jsonb end
  from documents d where d.id = p_id
$$;

create or replace function app_list_documents(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := '%' || lower(coalesce(p ->> 'q', '')) || '%'; v_status text := nullif(p ->> 'status', '');
begin
  perform app_require_member();
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.issue_date desc, x.created_at desc)
    from (
      select d.id, d.kind, d.number, d.status, d.title, d.client_id, d.client_snapshot ->> 'name' as client_name,
             d.issue_date, d.due_date, d.total_cents, d.paid_cents, d.balance_cents, d.deposit_cents,
             d.revision, d.locked, d.imported, d.created_at,
             (d.kind = 'invoice' and d.status in ('issued', 'partially_paid') and d.due_date < current_date and d.balance_cents > 0) as overdue,
             (d.kind = 'quote' and d.status in ('draft', 'sent') and d.due_date < current_date) as expired
      from documents d
      where d.kind = p ->> 'kind'
        and (v_status is null or d.status = v_status
             or (v_status = 'overdue' and d.kind = 'invoice' and d.status in ('issued', 'partially_paid') and d.due_date < current_date and d.balance_cents > 0)
             or (v_status = 'open' and d.status in ('issued', 'partially_paid')))
        and (nullif(p ->> 'client_id', '') is null or d.client_id = (p ->> 'client_id')::uuid)
        and (nullif(p ->> 'from', '') is null or d.issue_date >= (p ->> 'from')::date)
        and (nullif(p ->> 'to', '') is null or d.issue_date <= (p ->> 'to')::date)
        and (lower(coalesce(d.number, '')) like v_q or lower(d.client_snapshot ->> 'name') like v_q or lower(d.title) like v_q)
      order by d.issue_date desc, d.created_at desc
      limit least(coalesce((p ->> 'limit')::int, 200), 1000) offset coalesce((p ->> 'offset')::int, 0)
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function app_get_document(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform app_require_member();
  v := app_doc_json((p ->> 'id')::uuid, app_is_owner());
  if v is null then raise exception 'Document not found'; end if;
  return v;
end $$;

create or replace function app_client_snapshot(p_client uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'contact_person', contact_person, 'email', email, 'phone', phone,
                            'billing_address', billing_address, 'shipping_address', shipping_address, 'vat_number', vat_number)
  from clients where id = p_client
$$;

-- Create or update a DRAFT (or an unlocked quote revision). Lines are replaced.
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
            case when v_kind = 'quote' then app_next_number('quote') end,   -- invoices are numbered on issue
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
    -- staff cannot see costing, so keep existing costs for lines they did not touch
    select coalesce(jsonb_object_agg(lc.line_id::text, jsonb_build_object('u', lc.unit_cost_cents, 'b', lc.breakdown)), '{}'::jsonb)
      into v_keep from line_costs lc where lc.document_id = d.id;
    delete from document_lines where document_id = d.id;
    for ln in select * from jsonb_array_elements(p -> 'lines') loop
      v_pos := v_pos + 1;
      insert into document_lines (id, document_id, position, service_id, name, description, qty, unit_price_cents, taxable)
      values (coalesce(nullif(ln ->> 'id', '')::uuid, gen_random_uuid()), d.id, v_pos,
              nullif(ln ->> 'service_id', '')::uuid, coalesce(ln ->> 'name', ''), coalesce(ln ->> 'description', ''),
              coalesce((ln ->> 'qty')::numeric, 1), coalesce((ln ->> 'unit_price_cents')::bigint, 0),
              coalesce((ln ->> 'taxable')::boolean, true))
      returning id into v_line;
      if v_owner and ln ? 'cost' and jsonb_typeof(ln -> 'cost') = 'object' then
        insert into line_costs (line_id, document_id, unit_cost_cents, breakdown)
        values (v_line, d.id, greatest(0, coalesce((ln -> 'cost' ->> 'unit_cost_cents')::bigint, 0)),
                coalesce(ln -> 'cost' -> 'breakdown', '{}'::jsonb));
      elsif v_keep ? v_line::text then
        insert into line_costs (line_id, document_id, unit_cost_cents, breakdown)
        values (v_line, d.id, (v_keep -> v_line::text ->> 'u')::bigint, v_keep -> v_line::text -> 'b');
      elsif nullif(ln ->> 'service_id', '') is not null then
        -- new line from a saved service: carry its internal unit cost
        insert into line_costs (line_id, document_id, unit_cost_cents, breakdown)
        select v_line, d.id, sc.unit_cost_cents, jsonb_build_object('source', 'service', 'service_id', sc.service_id)
        from service_costs sc where sc.service_id = (ln ->> 'service_id')::uuid;
      end if;
    end loop;
  end if;

  return app_doc_json(d.id, v_owner);
end $$;

create or replace function app_snapshot_revision(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v jsonb;
begin
  v := app_doc_json(p_id, false) - 'payments' - 'revisions' - 'files' - 'invoice_ids' - 'internal_notes';
  insert into document_revisions (document_id, revision, snapshot, created_by)
  select p_id, d.revision, v, auth.uid() from documents d where d.id = p_id
  on conflict (document_id, revision) do nothing;
end $$;

-- Issue: number invoices, freeze company + client details, lock, snapshot.
create or replace function app_issue_document(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  perform app_require_member();
  select * into d from documents where id = (p ->> 'id')::uuid for update;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.locked or d.status <> 'draft' then raise exception 'Only drafts can be issued'; end if;
  if d.client_id is null then raise exception 'Choose a client before issuing'; end if;
  if not exists (select 1 from document_lines where document_id = d.id) then raise exception 'Add at least one line before issuing'; end if;

  update documents set
    number = coalesce(number, app_next_number(kind)),
    status = case when kind = 'quote' then 'sent' else 'issued' end,
    company_snapshot = (select to_jsonb(c) - 'id' - 'quote_next' - 'invoice_next' - 'updated_at' - 'email_body'
                          - 'email_subject' - 'email_cc' - 'email_bcc' - 'idle_timeout_minutes'
                        from company_settings c where id = 1),
    locked = true, issued_at = now()
  where id = d.id;
  perform app_snapshot_revision(d.id);
  return app_doc_json(d.id, app_is_owner());
end $$;

create or replace function app_set_quote_status(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d documents; v_new text := p ->> 'status';
begin
  perform app_require_member();
  select * into d from documents where id = (p ->> 'id')::uuid for update;
  if d.kind <> 'quote' then raise exception 'Not a quote'; end if;
  if v_new not in ('sent', 'accepted', 'declined') then raise exception 'Invalid quote status'; end if;
  if d.status not in ('sent', 'accepted', 'declined') then raise exception 'Issue the quote first'; end if;
  update documents set status = v_new where id = d.id;
  return app_doc_json(d.id, app_is_owner());
end $$;

-- Revise an issued quote: previous revision stays frozen in document_revisions.
create or replace function app_revise_quote(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  perform app_require_member();
  select * into d from documents where id = (p ->> 'id')::uuid for update;
  if d.kind <> 'quote' then raise exception 'Only quotes can be revised. Void the invoice and duplicate it instead.'; end if;
  if not d.locked or d.status not in ('sent', 'accepted', 'declined') then raise exception 'Only issued quotes can be revised'; end if;
  perform set_config('app.allow_unlock', 'on', true);
  update documents set locked = false, status = 'draft' where id = d.id;
  update documents set revision = revision + 1 where id = d.id;
  perform set_config('app.allow_unlock', 'off', true);
  return app_doc_json(d.id, app_is_owner());
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
    insert into document_lines (document_id, position, service_id, name, description, qty, unit_price_cents, taxable)
    values (v_new, l.position, l.service_id, l.name, l.description, l.qty, l.unit_price_cents, l.taxable)
    returning id into v_line;
    insert into line_costs (line_id, document_id, unit_cost_cents, breakdown)
    select v_line, v_new, lc.unit_cost_cents, lc.breakdown from line_costs lc where lc.line_id = l.id;
  end loop;
  return v_new;
end $$;

create or replace function app_convert_quote(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d documents; v_new uuid;
begin
  perform app_require_member();
  select * into d from documents where id = (p ->> 'id')::uuid for update;
  if d.kind <> 'quote' then raise exception 'Not a quote'; end if;
  if d.status not in ('sent', 'accepted') then raise exception 'Only sent or accepted quotes can be converted'; end if;
  v_new := app_copy_document(d.id, 'invoice');
  update documents set status = 'converted' where id = d.id;
  return app_doc_json(v_new, app_is_owner());
end $$;

create or replace function app_duplicate_document(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d documents; v_new uuid;
begin
  perform app_require_member();
  select * into d from documents where id = (p ->> 'id')::uuid;
  if d.id is null then raise exception 'Document not found'; end if;
  v_new := app_copy_document(d.id, coalesce(nullif(p ->> 'kind', ''), d.kind));
  update documents set source_quote_id = null where id = v_new and d.kind = 'invoice';
  return app_doc_json(v_new, app_is_owner());
end $$;

create or replace function app_void_document(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  perform app_require_member();
  if length(coalesce(trim(p ->> 'reason'), '')) < 3 then raise exception 'Give a reason for voiding'; end if;
  select * into d from documents where id = (p ->> 'id')::uuid for update;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.status = 'void' then raise exception 'Already void'; end if;
  if d.status = 'draft' and d.number is null then raise exception 'Unnumbered drafts can simply be deleted'; end if;
  if d.kind = 'invoice' and exists (select 1 from payments where invoice_id = d.id and not voided) then
    raise exception 'Void the recorded payments first';
  end if;
  update documents set status = 'void', void_reason = trim(p ->> 'reason'), voided_at = now(), locked = true where id = d.id;
  return app_doc_json(d.id, app_is_owner());
end $$;

-- Only never-issued drafts can be deleted. Numbered quote drafts are voided
-- instead so the number stays accounted for.
create or replace function app_delete_draft(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d documents;
begin
  perform app_require_member();
  select * into d from documents where id = (p ->> 'id')::uuid for update;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.status <> 'draft' or d.issued_at is not null or d.number is not null then
    raise exception 'Only unnumbered drafts can be deleted; void numbered documents instead';
  end if;
  delete from documents where id = d.id;
  return jsonb_build_object('deleted', d.id);
end $$;

create or replace function app_record_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare d documents; v_amt bigint := (p ->> 'amount_cents')::bigint;
begin
  perform app_require_member();
  select * into d from documents where id = (p ->> 'invoice_id')::uuid for update;
  if d.kind is distinct from 'invoice' then raise exception 'Payments can only be recorded against invoices'; end if;
  if d.status not in ('issued', 'partially_paid', 'paid') then raise exception 'Issue the invoice before recording payments'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Payment amount must be more than zero'; end if;
  if v_amt > d.balance_cents and not coalesce((p ->> 'allow_overpayment')::boolean, false) then
    raise exception 'Payment is more than the balance due';
  end if;
  insert into payments (invoice_id, paid_on, amount_cents, method, reference, is_deposit, notes, created_by)
  values (d.id, coalesce((p ->> 'paid_on')::date, current_date), v_amt, coalesce(nullif(p ->> 'method', ''), 'eft'),
          coalesce(p ->> 'reference', ''), coalesce((p ->> 'is_deposit')::boolean, false), coalesce(p ->> 'notes', ''), auth.uid());
  return app_doc_json(d.id, app_is_owner());
end $$;

create or replace function app_void_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_inv uuid;
begin
  perform app_require_member();
  if length(coalesce(trim(p ->> 'reason'), '')) < 3 then raise exception 'Give a reason for voiding'; end if;
  update payments set voided = true, void_reason = trim(p ->> 'reason')
   where id = (p ->> 'id')::uuid and not voided returning invoice_id into v_inv;
  if v_inv is null then raise exception 'Payment not found or already void'; end if;
  return app_doc_json(v_inv, app_is_owner());
end $$;

create or replace function app_attach_file(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare d documents;
begin
  perform app_require_member();
  select * into d from documents where id = (p ->> 'document_id')::uuid;
  if d.id is null or not d.locked then raise exception 'PDFs are stored for issued documents only'; end if;
  if (p ->> 'storage_path') not like d.kind || 's/' || d.id || '/%' then raise exception 'Invalid storage path'; end if;
  insert into document_files (document_id, revision, storage_path, created_by)
  values (d.id, d.revision, p ->> 'storage_path', auth.uid())
  on conflict (storage_path) do nothing;
  return app_doc_json(d.id, app_is_owner());
end $$;

-- ---------- reports (owner) ----------
create or replace function app_report(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from date := coalesce((p ->> 'from')::date, date_trunc('year', current_date)::date);
        v_to date := coalesce((p ->> 'to')::date, current_date);
begin
  perform app_require_owner();
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'received_by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'cents', c) order by m) from (
        select to_char(y.paid_on, 'YYYY-MM') m, sum(y.amount_cents) c from payments y
        join documents d on d.id = y.invoice_id
        where not y.voided and d.status <> 'void' and y.paid_on between v_from and v_to group by 1) t), '[]'::jsonb),
    'invoiced_by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'cents', c, 'vat_cents', v) order by m) from (
        select to_char(issue_date, 'YYYY-MM') m, sum(total_cents) c, sum(vat_cents) v from documents
        where kind = 'invoice' and status in ('issued', 'partially_paid', 'paid') and issue_date between v_from and v_to group by 1) t), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'invoiced_cents', coalesce(sum(total_cents), 0),
        'vat_cents', coalesce(sum(vat_cents), 0),
        'net_cents', coalesce(sum(total_cents - vat_cents), 0),
        'invoice_count', count(*))
      from documents where kind = 'invoice' and status in ('issued', 'partially_paid', 'paid') and issue_date between v_from and v_to),
    'received_cents', (select coalesce(sum(y.amount_cents), 0) from payments y join documents d on d.id = y.invoice_id
                       where not y.voided and d.status <> 'void' and y.paid_on between v_from and v_to),
    'outstanding', (
      select jsonb_build_object(
        'total_cents', coalesce(sum(balance_cents), 0),
        'current_cents', coalesce(sum(balance_cents) filter (where due_date >= current_date), 0),
        'd1_30_cents',  coalesce(sum(balance_cents) filter (where current_date - due_date between 1 and 30), 0),
        'd31_60_cents', coalesce(sum(balance_cents) filter (where current_date - due_date between 31 and 60), 0),
        'd61_90_cents', coalesce(sum(balance_cents) filter (where current_date - due_date between 61 and 90), 0),
        'd90p_cents',   coalesce(sum(balance_cents) filter (where current_date - due_date > 90), 0),
        'count', count(*))
      from documents where kind = 'invoice' and status in ('issued', 'partially_paid') and balance_cents > 0),
    'quotes', (
      select jsonb_build_object(
        'issued', count(*) filter (where status in ('sent', 'accepted', 'declined', 'converted')),
        'won', count(*) filter (where status in ('accepted', 'converted')),
        'declined', count(*) filter (where status = 'declined'),
        'open', count(*) filter (where status = 'sent'),
        'value_won_cents', coalesce(sum(total_cents) filter (where status in ('accepted', 'converted')), 0),
        'conversion_percent', case when count(*) filter (where status in ('sent', 'accepted', 'declined', 'converted')) = 0 then 0
          else round(100.0 * count(*) filter (where status in ('accepted', 'converted'))
                     / count(*) filter (where status in ('sent', 'accepted', 'declined', 'converted')), 1) end)
      from documents where kind = 'quote' and issue_date between v_from and v_to),
    'profit', (
      select jsonb_build_object(
        'net_revenue_cents', coalesce(sum(d.total_cents - d.vat_cents), 0),
        'cost_cents', coalesce(sum(c.cost), 0),
        'gross_profit_cents', coalesce(sum(d.total_cents - d.vat_cents), 0) - coalesce(sum(c.cost), 0),
        'invoices_without_costing', count(*) filter (where c.cost is null))
      from documents d
      left join lateral (select sum(app_cents(lc.unit_cost_cents * l.qty)) cost
                         from document_lines l join line_costs lc on lc.line_id = l.id where l.document_id = d.id) c on true
      where d.kind = 'invoice' and d.status in ('issued', 'partially_paid', 'paid') and d.issue_date between v_from and v_to),
    'top_clients', coalesce((
      select jsonb_agg(t order by t.cents desc) from (
        select client_snapshot ->> 'name' as name, sum(total_cents) cents, count(*) invoices from documents
        where kind = 'invoice' and status in ('issued', 'partially_paid', 'paid') and issue_date between v_from and v_to
        group by 1 order by 2 desc limit 10) t), '[]'::jsonb)
  );
end $$;

-- ---------- export (CSV is built in the browser from these rows) ----------
create or replace function app_export(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_type text := p ->> 'type';
begin
  perform app_require_member();
  if v_type = 'clients' then
    return coalesce((select jsonb_agg(to_jsonb(c) - 'created_by' order by c.name) from clients c), '[]'::jsonb);
  elsif v_type = 'services' then
    return coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from services s), '[]'::jsonb);
  elsif v_type in ('quotes', 'invoices') then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', d.number, 'status', d.status, 'issue_date', d.issue_date, 'due_date', d.due_date,
        'client', d.client_snapshot ->> 'name', 'client_email', d.client_snapshot ->> 'email',
        'revision', d.revision, 'line', l.position, 'item', l.name, 'description', l.description,
        'qty', l.qty, 'rate_cents', l.unit_price_cents, 'amount_cents', l.line_total_cents,
        'subtotal_cents', d.subtotal_cents, 'discount_cents', d.discount_cents, 'shipping_cents', d.shipping_cents,
        'vat_cents', d.vat_cents, 'total_cents', d.total_cents, 'deposit_cents', d.deposit_cents,
        'paid_cents', d.paid_cents, 'balance_cents', d.balance_cents, 'imported', d.imported)
        order by d.issue_date, d.number, l.position)
      from documents d left join document_lines l on l.document_id = d.id
      where d.kind = case when v_type = 'quotes' then 'quote' else 'invoice' end), '[]'::jsonb);
  elsif v_type = 'payments' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('invoice', d.number, 'client', d.client_snapshot ->> 'name', 'paid_on', y.paid_on,
        'amount_cents', y.amount_cents, 'method', y.method, 'reference', y.reference, 'is_deposit', y.is_deposit,
        'voided', y.voided, 'void_reason', y.void_reason) order by y.paid_on)
      from payments y join documents d on d.id = y.invoice_id), '[]'::jsonb);
  elsif v_type = 'costing' then
    perform app_require_owner();
    return coalesce((
      select jsonb_agg(jsonb_build_object('number', d.number, 'kind', d.kind, 'status', d.status, 'issue_date', d.issue_date,
        'client', d.client_snapshot ->> 'name', 'item', l.name, 'qty', l.qty, 'rate_cents', l.unit_price_cents,
        'unit_cost_cents', lc.unit_cost_cents, 'line_cost_cents', app_cents(lc.unit_cost_cents * l.qty),
        'line_revenue_cents', l.line_total_cents) order by d.issue_date, d.number, l.position)
      from documents d join document_lines l on l.document_id = d.id left join line_costs lc on lc.line_id = l.id), '[]'::jsonb);
  end if;
  raise exception 'Unknown export type';
end $$;

-- ---------- CSV migration (owner). Rows are parsed + mapped in the browser. ----------
create or replace function app_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_type text := p ->> 'type'; r jsonb; ln jsonb; v_created int := 0; v_skipped jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb; v_client uuid; v_doc documents; v_pos int; v_i int := 0;
  v_status text; v_n bigint; v_prefix text; v_kind text;
begin
  perform app_require_owner();
  if jsonb_typeof(p -> 'rows') <> 'array' or jsonb_array_length(p -> 'rows') > 5000 then
    raise exception 'Import at most 5000 rows at a time';
  end if;

  for r in select * from jsonb_array_elements(p -> 'rows') loop
    v_i := v_i + 1;
    begin
      if v_type = 'clients' then
        if coalesce(trim(r ->> 'name'), '') = '' then raise exception 'missing name'; end if;
        if exists (select 1 from clients where lower(name) = lower(trim(r ->> 'name'))) then
          v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'client already exists: ' || (r ->> 'name'));
          continue;
        end if;
        insert into clients (name, contact_person, email, phone, billing_address, shipping_address, vat_number, notes, created_by)
        values (trim(r ->> 'name'), coalesce(r ->> 'contact_person', ''), coalesce(r ->> 'email', ''), coalesce(r ->> 'phone', ''),
                coalesce(r ->> 'billing_address', ''), coalesce(nullif(r ->> 'shipping_address', ''), r ->> 'billing_address', ''),
                coalesce(r ->> 'vat_number', ''), coalesce(r ->> 'notes', ''), auth.uid());
        v_created := v_created + 1;

      elsif v_type = 'services' then
        if coalesce(trim(r ->> 'name'), '') = '' then raise exception 'missing name'; end if;
        if exists (select 1 from services where lower(name) = lower(trim(r ->> 'name'))) then
          v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'service already exists: ' || (r ->> 'name'));
          continue;
        end if;
        insert into services (name, description, unit_price_cents, taxable)
        values (trim(r ->> 'name'), coalesce(r ->> 'description', ''), coalesce((r ->> 'unit_price_cents')::bigint, 0),
                coalesce((r ->> 'taxable')::boolean, false));
        v_created := v_created + 1;

      elsif v_type in ('quotes', 'invoices') then
        v_kind := case when v_type = 'quotes' then 'quote' else 'invoice' end;
        if coalesce(trim(r ->> 'number'), '') = '' then raise exception 'missing document number'; end if;
        if coalesce(trim(r ->> 'client_name'), '') = '' then raise exception 'missing client'; end if;
        if exists (select 1 from documents where kind = v_kind and number = trim(r ->> 'number')) then
          v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', (r ->> 'number') || ' already exists');
          continue;
        end if;
        select id into v_client from clients where lower(name) = lower(trim(r ->> 'client_name')) limit 1;
        if v_client is null then
          insert into clients (name, email, phone, billing_address, shipping_address, created_by)
          values (trim(r ->> 'client_name'), coalesce(r ->> 'client_email', ''), coalesce(r ->> 'client_phone', ''),
                  coalesce(r ->> 'client_address', ''), coalesce(r ->> 'client_address', ''), auth.uid())
          returning id into v_client;
        end if;
        v_status := coalesce(nullif(r ->> 'status', ''), case when v_kind = 'quote' then 'sent' else 'issued' end);
        if v_kind = 'quote' and v_status not in ('sent', 'accepted', 'declined', 'converted', 'void') then v_status := 'sent'; end if;
        if v_kind = 'invoice' and v_status not in ('issued', 'partially_paid', 'paid', 'void') then v_status := 'issued'; end if;

        insert into documents (kind, number, status, title, client_id, client_snapshot, issue_date, due_date, notes,
                               discount_type, discount_amount_cents, shipping_cents, tax_mode, vat_rate,
                               imported, imported_total_cents, created_by)
        values (v_kind, trim(r ->> 'number'), case when v_status = 'void' then 'draft' else
                  case when v_kind = 'invoice' then 'issued' else v_status end end,
                case when v_kind = 'quote' then 'Quote' else 'Invoice' end,
                v_client, app_client_snapshot(v_client),
                (r ->> 'issue_date')::date, nullif(r ->> 'due_date', '')::date, coalesce(r ->> 'notes', ''),
                case when coalesce((r ->> 'discount_cents')::bigint, 0) > 0 then 'amount' else 'none' end,
                coalesce((r ->> 'discount_cents')::bigint, 0), coalesce((r ->> 'shipping_cents')::bigint, 0),
                coalesce(nullif(r ->> 'tax_mode', ''), 'none'), coalesce((r ->> 'vat_rate')::numeric, 15),
                true, nullif(r ->> 'total_cents', '')::bigint, auth.uid())
        returning * into v_doc;
        v_pos := 0;
        for ln in select * from jsonb_array_elements(coalesce(r -> 'lines', '[]'::jsonb)) loop
          v_pos := v_pos + 1;
          insert into document_lines (document_id, position, name, description, qty, unit_price_cents, taxable)
          values (v_doc.id, v_pos, coalesce(ln ->> 'name', ''), coalesce(ln ->> 'description', ''),
                  coalesce((ln ->> 'qty')::numeric, 1), coalesce((ln ->> 'unit_price_cents')::bigint, 0),
                  coalesce((ln ->> 'taxable')::boolean, true));
        end loop;
        update documents set
          company_snapshot = (select to_jsonb(c) - 'id' - 'quote_next' - 'invoice_next' - 'updated_at' from company_settings c where id = 1),
          locked = true, issued_at = coalesce(issued_at, now())
        where id = v_doc.id;
        if v_status = 'void' then
          update documents set status = 'void', void_reason = 'Imported as void', voided_at = now() where id = v_doc.id;
        end if;
        perform app_snapshot_revision(v_doc.id);
        select * into v_doc from documents where id = v_doc.id;
        if v_doc.imported_total_cents is not null and v_doc.imported_total_cents <> v_doc.total_cents then
          v_warn := v_warn || jsonb_build_object('row', v_i, 'number', v_doc.number,
            'warning', format('CSV total %s differs from recalculated total %s (kept both)', v_doc.imported_total_cents, v_doc.total_cents));
        end if;
        -- a paid/partly paid historical invoice gets a matching imported payment
        if v_kind = 'invoice' and coalesce((r ->> 'paid_cents')::bigint, 0) > 0 and v_status <> 'void' then
          insert into payments (invoice_id, paid_on, amount_cents, method, reference, imported, created_by)
          values (v_doc.id, coalesce(nullif(r ->> 'paid_on', '')::date, v_doc.issue_date),
                  least((r ->> 'paid_cents')::bigint, greatest(v_doc.total_cents, 1)), 'other', 'Imported', true, auth.uid());
        elsif v_kind = 'invoice' and v_status = 'paid' and v_doc.total_cents > 0 then
          insert into payments (invoice_id, paid_on, amount_cents, method, reference, imported, created_by)
          values (v_doc.id, coalesce(nullif(r ->> 'paid_on', '')::date, v_doc.issue_date), v_doc.total_cents, 'other', 'Imported', true, auth.uid());
        end if;
        -- keep the live counter ahead of imported history
        select case when v_kind = 'quote' then quote_prefix else invoice_prefix end into v_prefix from company_settings where id = 1;
        if v_doc.number like v_prefix || '%' and substr(v_doc.number, length(v_prefix) + 1) ~ '^[0-9]+$' then
          v_n := substr(v_doc.number, length(v_prefix) + 1)::bigint;
          if v_kind = 'quote' then update company_settings set quote_next = greatest(quote_next, v_n + 1) where id = 1;
          else update company_settings set invoice_next = greatest(invoice_next, v_n + 1) where id = 1; end if;
        end if;
        v_created := v_created + 1;
      else
        raise exception 'Unknown import type';
      end if;
    exception when others then
      if sqlerrm = 'Unknown import type' then raise; end if;
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'warnings', v_warn);
end $$;

-- ---------- team + audit (owner) ----------
create or replace function app_list_team(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_owner();
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.role, x.email) from profiles x), '[]'::jsonb);
end $$;

create or replace function app_list_audit(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform app_require_owner();
  return coalesce((
    select jsonb_agg(row_to_json(a)::jsonb order by a.id desc) from (
      select l.id, l.at, l.table_name, l.row_id, l.action, coalesce(pr.email, 'system') as actor_email,
             coalesce(l.new_data ->> 'number', l.old_data ->> 'number', l.new_data ->> 'name', l.old_data ->> 'name') as label
      from audit_log l left join profiles pr on pr.id = l.actor
      where nullif(p ->> 'row_id', '') is null or l.row_id = p ->> 'row_id'
      order by l.id desc limit least(coalesce((p ->> 'limit')::int, 100), 500)) a
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Function privileges: nobody but signed-in users may call app_* API
-- functions; internal helpers are not callable at all.
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'app\_%' or p.proname like 'trg\_%') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'app_me','app_get_settings','app_save_settings','app_set_next_number','app_list_materials','app_save_material',
             'app_list_clients','app_save_client','app_list_services','app_save_service','app_estimate_cost',
             'app_list_documents','app_get_document','app_save_document','app_issue_document','app_set_quote_status',
             'app_revise_quote','app_convert_quote','app_duplicate_document','app_void_document','app_delete_draft',
             'app_record_payment','app_void_payment','app_attach_file','app_report','app_export','app_import',
             'app_list_team','app_list_audit',
             -- used inside RLS policies, must be executable by the querying role
             'app_is_member','app_is_owner') loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
