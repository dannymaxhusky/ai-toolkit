-- ============================================================
-- Reroom — Supabase schema
-- Run this once in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1. Job / design records -------------------------------------
create table if not exists public.redesigns (
  id           uuid primary key,
  style        text not null,
  status       text not null default 'processing',  -- processing | done | error
  original_url text,
  result_url   text,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists redesigns_created_idx on public.redesigns (created_at desc);

-- RLS on. The app talks to Supabase only through Netlify functions
-- using the SERVICE ROLE key, which bypasses RLS. No public policies
-- are needed, so anon/auth users cannot read or write the table.
alter table public.redesigns enable row level security;

-- 2. Storage bucket for room photos (public read) -------------
insert into storage.buckets (id, name, public)
values ('rooms', 'rooms', true)
on conflict (id) do nothing;

-- Allow public read of generated images (so the browser can load them
-- from the public URL). Uploads are done with the service role key.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Public read rooms'
  ) then
    create policy "Public read rooms"
      on storage.objects for select
      using (bucket_id = 'rooms');
  end if;
end $$;
