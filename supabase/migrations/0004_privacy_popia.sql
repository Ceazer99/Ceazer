-- =====================================================================
-- Ceazers 3D admin - POPIA support (run after 0001-0003). Additive.
--   * marketing opt-out per client (POPIA s69 / ECT Act s45)
--   * data subject access: export everything held about a person (s23)
--   * erasure on request (s24) with a legal-retention guard: clients with
--     quotes/invoices are kept 7 years (Companies Act s24, Tax Admin Act s29)
--   * retention: enquiries/clients that never led to work, older than
--     N months (default 24, as promised in the privacy policy) - s14
--   * audit log stays append-only EXCEPT a controlled redaction used by
--     erasure, so "deleted" personal data does not survive in the history
-- =====================================================================

alter table clients add column if not exists marketing_opt_out boolean not null default false;
alter table clients add column if not exists marketing_opt_out_at timestamptz;

-- audit log: immutable, except redaction during a lawful erasure
create or replace function trg_audit_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_setting('app.allow_redact', true) = 'on'
     and new.id = old.id and new.at = old.at and new.table_name = old.table_name and new.row_id is not distinct from old.row_id
     and new.action = old.action and new.actor is not distinct from old.actor then
    return new;
  end if;
  raise exception 'audit_log rows are immutable';
end $$;
drop trigger if exists audit_immutable on audit_log;
create trigger audit_immutable before update or delete on audit_log
  for each row execute function trg_audit_guard();

create or replace function app_redact_audit(p_ids text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('app.allow_redact', 'on', true);
  update audit_log set old_data = case when old_data is null then null else '{"redacted": true}'::jsonb end,
                       new_data = case when new_data is null then null else '{"redacted": true}'::jsonb end
   where row_id = any (p_ids);
  get diagnostics n = row_count;
  perform set_config('app.allow_redact', 'off', true);
  return n;
end $$;

-- ---------- marketing opt-out ----------
create or replace function app_set_marketing_opt_out(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r clients; v_out boolean := coalesce((p ->> 'opt_out')::boolean, true);
begin
  perform app_require_member();
  update clients set marketing_opt_out = v_out,
         marketing_opt_out_at = case when v_out then now() else null end, updated_at = now()
   where id = (p ->> 'id')::uuid returning * into r;
  if r.id is null then raise exception 'Client not found'; end if;
  return to_jsonb(r);
end $$;

-- ---------- access request: everything held about a person ----------
create or replace function app_person_export(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid := nullif(p ->> 'client_id', '')::uuid; v_email text := lower(nullif(trim(p ->> 'email'), ''));
begin
  perform app_require_owner();
  if v_client is null and v_email is null then raise exception 'Give a client or an email address'; end if;
  if v_client is not null and v_email is null then select lower(nullif(email, '')) into v_email from clients where id = v_client; end if;
  return jsonb_build_object(
    'generated_at', now(),
    'note', 'Personal information held by Ceazers 3D Engineering Solutions (Pty) Ltd (POPIA section 23 request).',
    'clients', coalesce((select jsonb_agg(to_jsonb(c) - 'created_by') from clients c
                         where c.id = v_client or (v_email is not null and lower(c.email) = v_email)), '[]'::jsonb),
    'enquiries', coalesce((select jsonb_agg(to_jsonb(e) - 'created_by') from enquiries e
                           where e.client_id = v_client or (v_email is not null and lower(e.email) = v_email)), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'number', d.number, 'status', d.status,
                             'issue_date', d.issue_date, 'client_details_on_document', d.client_snapshot, 'total_cents', d.total_cents,
                             'lines', (select jsonb_agg(jsonb_build_object('item', l.name, 'description', l.description, 'qty', l.qty,
                                        'amount_cents', l.line_total_cents) order by l.position) from document_lines l where l.document_id = d.id)))
                           from documents d join clients c on c.id = d.client_id
                           where c.id = v_client or (v_email is not null and lower(c.email) = v_email)), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('invoice', d.number, 'paid_on', y.paid_on, 'amount_cents', y.amount_cents,
                            'method', y.method, 'voided', y.voided))
                          from payments y join documents d on d.id = y.invoice_id join clients c on c.id = d.client_id
                          where c.id = v_client or (v_email is not null and lower(c.email) = v_email)), '[]'::jsonb)
  );
end $$;

-- ---------- erasure ----------
-- internal: erase one client that has no numbered documents
create or replace function app__erase_client(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids text[]; v_docs uuid[]; v_lines text[]; v_enq text[];
begin
  if exists (select 1 from documents where client_id = p_id and number is not null) then
    raise exception 'This client has quotes or invoices, which must be kept for 7 years (Companies Act s24, Tax Administration Act s29). Turn on marketing opt-out and note the request instead.';
  end if;
  select array_agg(id) into v_docs from documents where client_id = p_id;
  select array_agg(id::text) into v_lines from document_lines where document_id = any (coalesce(v_docs, '{}'));
  select array_agg(id::text) into v_enq from enquiries where client_id = p_id;
  delete from enquiries where client_id = p_id;
  delete from documents where id = any (coalesce(v_docs, '{}'));   -- unnumbered drafts only (checked above)
  delete from clients where id = p_id;
  v_ids := array[p_id::text] || coalesce(v_enq, '{}') || coalesce((select array_agg(x::text) from unnest(v_docs) x), '{}') || coalesce(v_lines, '{}');
  return jsonb_build_object('client', p_id, 'enquiries', coalesce(array_length(v_enq, 1), 0),
                            'drafts', coalesce(array_length(v_docs, 1), 0), 'audit_rows_redacted', app_redact_audit(v_ids));
end $$;

create or replace function app_erase_client(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform app_require_owner();
  if length(coalesce(trim(p ->> 'reason'), '')) < 3 then raise exception 'Record why (e.g. "deletion request by email 7 Nov 2026")'; end if;
  return app__erase_client((p ->> 'id')::uuid);
end $$;

create or replace function app_erase_enquiry(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e enquiries;
begin
  perform app_require_owner();
  select * into e from enquiries where id = (p ->> 'id')::uuid;
  if e.id is null then raise exception 'Enquiry not found'; end if;
  delete from enquiries where id = e.id;
  return jsonb_build_object('enquiry', e.id, 'audit_rows_redacted', app_redact_audit(array[e.id::text]));
end $$;

-- ---------- retention (privacy policy: 24 months for enquiries that led nowhere) ----------
create or replace function app__retention_candidates(p_months int) returns table (kind text, id uuid)
language sql stable security definer set search_path = public as $$
  select 'enquiry', e.id from enquiries e
   where e.received_at < now() - make_interval(months => p_months)
     and e.client_id is null and e.quote_id is null
  union all
  select 'client', c.id from clients c
   where c.created_at < now() - make_interval(months => p_months)
     and not exists (select 1 from documents d where d.client_id = c.id)
     and not exists (select 1 from enquiries e where e.client_id = c.id and e.received_at >= now() - make_interval(months => p_months))
$$;

create or replace function app_retention_preview(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_m int := greatest(coalesce((p ->> 'months')::int, 24), 6);
begin
  perform app_require_owner();
  return jsonb_build_object('months', v_m,
    'enquiries', (select count(*) from app__retention_candidates(v_m) where kind = 'enquiry'),
    'clients', (select count(*) from app__retention_candidates(v_m) where kind = 'client'),
    'financial_records_older_than_7_years', (select count(*) from documents where number is not null and issue_date < current_date - interval '7 years'));
end $$;

create or replace function app_apply_retention(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m int := greatest(coalesce((p ->> 'months')::int, 24), 6); r record; v_e int := 0; v_c int := 0; v_ids text[] := '{}';
begin
  perform app_require_owner();
  if coalesce((p ->> 'confirm')::boolean, false) is not true then raise exception 'Confirm to delete'; end if;
  for r in select * from app__retention_candidates(v_m) loop
    if r.kind = 'enquiry' then
      delete from enquiries where id = r.id; v_ids := v_ids || r.id::text; v_e := v_e + 1;
    else
      perform app__erase_client(r.id); v_c := v_c + 1;
    end if;
  end loop;
  perform app_redact_audit(v_ids);
  return jsonb_build_object('months', v_m, 'enquiries_deleted', v_e, 'clients_deleted', v_c);
end $$;

-- ---------- privileges ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('trg_audit_guard','app_redact_audit','app_set_marketing_opt_out',
             'app_person_export','app__erase_client','app_erase_client','app_erase_enquiry','app__retention_candidates',
             'app_retention_preview','app_apply_retention') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('app_set_marketing_opt_out','app_person_export','app_erase_client','app_erase_enquiry',
                     'app_retention_preview','app_apply_retention') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
