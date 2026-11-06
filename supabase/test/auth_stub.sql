-- Local stand-in for the parts of Supabase that 0001_admin_schema.sql relies
-- on: the auth schema (users, mfa_factors, uid(), jwt()) and the anon /
-- authenticated roles. Used ONLY by the automated tests and the localhost
-- demo backend; never run this against a real Supabase project.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text not null);
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'unverified'
);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
