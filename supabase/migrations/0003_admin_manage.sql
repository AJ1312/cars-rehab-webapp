-- Admin board: session titles, comments on a session, and a record of deleted sessions.
alter table public.sessions add column if not exists title text;

create table if not exists public.session_comments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  author text not null,                 -- staff email
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists session_comments_session_idx on public.session_comments (session_id, created_at);

-- Ids of sessions staff deleted, so a phone that still holds one does not upload it again.
create table if not exists public.deleted_sessions (
  id uuid primary key,
  at timestamptz not null default now()
);

alter table public.session_comments enable row level security;
alter table public.deleted_sessions enable row level security;
