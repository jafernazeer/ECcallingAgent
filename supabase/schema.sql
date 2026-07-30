create extension if not exists pgcrypto;

create table if not exists public.calls (
  id text primary key,
  vapi_call_id text,
  channel text not null default 'Voice',
  source text not null default 'Phone widget',
  caller_number text,
  started_at timestamptz,
  ended_at timestamptz,
  status text not null default 'connecting',
  workflow_status text not null default 'Open',
  agent_joined boolean not null default false,
  summary text,
  lead jsonb,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calls_workflow_status_check check (workflow_status in ('Open', 'Follow up required', 'Closed'))
);

create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  call_id text not null references public.calls(id) on delete cascade,
  speaker text not null,
  text text not null,
  is_final boolean not null default true,
  partial boolean not null default false,
  spoken_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id text primary key,
  call_id text unique references public.calls(id) on delete set null,
  name text not null default 'Caller',
  phone text not null default 'Browser call',
  email text not null default 'Not provided',
  place text not null default 'Not captured',
  requirement text not null default 'Live EC Calling Agent inquiry',
  status text not null default 'Open',
  source text not null default 'ai_call',
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_status_check check (status in ('Open', 'Follow up required', 'Closed'))
);

create index if not exists calls_started_at_idx on public.calls(started_at desc);
create index if not exists calls_workflow_status_idx on public.calls(workflow_status);
create index if not exists transcripts_call_id_spoken_at_idx on public.transcripts(call_id, spoken_at);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_last_contact_at_idx on public.leads(last_contact_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists calls_set_updated_at on public.calls;
create trigger calls_set_updated_at
before update on public.calls
for each row execute function public.set_updated_at();

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transcripts'
  ) then
    alter publication supabase_realtime add table public.transcripts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;
