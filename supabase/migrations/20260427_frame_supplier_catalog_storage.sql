-- Storage bucket для фотографий каталога поставщика.
-- Приватный, только owner-роль может читать/писать через signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'frame-supplier-catalog',
  'frame-supplier-catalog',
  false,
  10485760,  -- 10 МБ — каталог-фото обычно 200КБ-2МБ
  array['image/png','image/jpeg','image/webp']::text[]
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS на storage.objects для этого bucket
drop policy if exists "frame_supplier_catalog_owner_select" on storage.objects;
create policy "frame_supplier_catalog_owner_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'frame-supplier-catalog'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "frame_supplier_catalog_owner_insert" on storage.objects;
create policy "frame_supplier_catalog_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'frame-supplier-catalog'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "frame_supplier_catalog_owner_update" on storage.objects;
create policy "frame_supplier_catalog_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'frame-supplier-catalog'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );

drop policy if exists "frame_supplier_catalog_owner_delete" on storage.objects;
create policy "frame_supplier_catalog_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'frame-supplier-catalog'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
  );
