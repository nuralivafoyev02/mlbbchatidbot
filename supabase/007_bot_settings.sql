begin;

create table if not exists public.bot_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.bot_settings enable row level security;

-- Only service role can access this table directly
revoke all on public.bot_settings from anon, authenticated;
grant select, insert, update, delete on public.bot_settings to service_role;

commit;
