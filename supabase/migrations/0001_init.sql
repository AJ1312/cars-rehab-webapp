-- CARS Rehab: database schema.
-- Every table has row-level security ON with NO policies: the browser can never read or write
-- directly. All access goes through the Next.js server using the service-role key.

create extension if not exists pgcrypto;

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  role text not null check (role in ('admin','researcher','therapist')),
  password_hash text not null,
  totp_secret text,
  totp_enabled boolean not null default false,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  token_hash text unique,               -- sha-256 of the device token; null until enrolled
  enrol_code_hash text unique,          -- sha-256 of the one-time enrolment code
  enrol_expires_at timestamptz,
  model text,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  enrolled_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.sessions (
  id uuid primary key,                  -- generated on the phone: makes uploads idempotent
  participant_code text not null,
  session_no int not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  mode text not null,
  level int not null,
  grp text,
  therapist text,
  complete boolean not null default false,
  cal_pass boolean,
  cal_override boolean,
  device_id uuid references public.devices(id),
  device_label text,
  flags text[] not null default '{}',
  record jsonb not null,                -- full session record (no kinematics)
  summary jsonb not null,               -- server-recomputed summaries
  kin_path text,
  kin_rows int not null default 0,
  received_at timestamptz not null default now(),
  app_version text
);
create index if not exists sessions_participant_idx on public.sessions (participant_code, session_no);
create index if not exists sessions_started_idx on public.sessions (started_at desc);
create index if not exists sessions_flags_idx on public.sessions using gin (flags);

create table if not exists public.audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,                  -- staff email, device label or "system"
  action text not null,
  target text,
  detail jsonb,
  ip text
);
create index if not exists audit_at_idx on public.audit (at desc);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.staff enable row level security;
alter table public.devices enable row level security;
alter table public.sessions enable row level security;
alter table public.audit enable row level security;
alter table public.settings enable row level security;

-- Private bucket for the 20 Hz movement files.
insert into storage.buckets (id, name, public) values ('kinematics', 'kinematics', false)
on conflict (id) do nothing;
