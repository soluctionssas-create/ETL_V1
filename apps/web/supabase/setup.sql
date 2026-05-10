-- Run this in Supabase SQL Editor for a quick functional demo.
create table if not exists public.todos (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.todos enable row level security;

-- Demo policies for anon/authenticated so the web app can read/write immediately.
drop policy if exists "todos_select_public" on public.todos;
create policy "todos_select_public"
on public.todos
for select
to anon, authenticated
using (true);

drop policy if exists "todos_insert_public" on public.todos;
create policy "todos_insert_public"
on public.todos
for insert
to anon, authenticated
with check (true);

drop policy if exists "todos_delete_public" on public.todos;
create policy "todos_delete_public"
on public.todos
for delete
to anon, authenticated
using (true);
