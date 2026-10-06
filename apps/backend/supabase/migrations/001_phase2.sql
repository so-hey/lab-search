create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  name text not null,
  mime_type text not null,
  parent_folder_id text,
  web_view_link text,
  modified_time timestamptz not null,
  is_indexed boolean not null default false,
  embedding_provider_id text,
  vector_store_id text,
  duplicate_of uuid references public.documents(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.search_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  source text not null check (source in ('web', 'slack')),
  query text not null,
  result_count integer not null check (result_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  source text not null check (source in ('web', 'slack')),
  search_log_id uuid not null references public.search_logs(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_id text not null,
  rank integer not null check (rank >= 1),
  score double precision not null,
  feedback text not null check (feedback in ('positive', 'negative')),
  created_at timestamptz not null default now(),
  unique (user_id, search_log_id, document_id)
);

create table if not exists public.allowed_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  role text not null default 'member',
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at before update on public.documents
for each row execute function public.set_updated_at();

create index if not exists documents_active_idx on public.documents(is_active);
create index if not exists search_logs_user_created_idx on public.search_logs(user_id, created_at desc);
create index if not exists feedback_search_log_idx on public.feedback(search_log_id);

alter table public.documents enable row level security;
alter table public.search_logs enable row level security;
alter table public.feedback enable row level security;
alter table public.allowed_users enable row level security;

-- No client-facing policies are created. These tables are accessed only by the
-- Backend with a Supabase secret/service-role key, which must never be exposed.
