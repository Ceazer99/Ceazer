-- =====================================================================
-- Ceazers 3D admin - private storage (Supabase Storage)
-- Run after 0001_admin_schema.sql.
--   documents : issued quote/invoice PDFs. Members may read and add;
--               nobody may overwrite or delete (history is permanent).
--   branding  : logo + signature images. Members read, owner writes.
-- Both buckets are PRIVATE: files are only reachable through short-lived
-- signed URLs created for a signed-in member.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admin documents read"   on storage.objects;
drop policy if exists "admin documents insert" on storage.objects;
drop policy if exists "admin branding read"    on storage.objects;
drop policy if exists "admin branding write"   on storage.objects;
drop policy if exists "admin branding update"  on storage.objects;
drop policy if exists "admin branding delete"  on storage.objects;

create policy "admin documents read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.app_is_member());

-- path must be quotes/<uuid>/<file>.pdf or invoices/<uuid>/<file>.pdf of an
-- existing, locked document
create policy "admin documents insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents' and public.app_is_member()
    and name ~ '^(quote|invoice)s/[0-9a-f-]{36}/[A-Za-z0-9._-]+\.pdf$'
    and exists (select 1 from public.documents d
                where d.id = (split_part(name, '/', 2))::uuid and d.locked
                  and d.kind || 's' = split_part(name, '/', 1))
  );
-- no update/delete policies for "documents": stored PDFs are permanent

create policy "admin branding read" on storage.objects for select to authenticated
  using (bucket_id = 'branding' and public.app_is_member());
create policy "admin branding write" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.app_is_owner() and name ~ '^(logo|signature)-[0-9]+\.(png|jpe?g|webp)$');
create policy "admin branding update" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.app_is_owner());
create policy "admin branding delete" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and public.app_is_owner());
