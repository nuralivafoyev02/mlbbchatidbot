begin;

-- ---------------------------------------------------------------------------
-- API tokens for the public lookup endpoint.
-- The token itself is stored hashed (SHA-256) so the raw value is never
-- persisted; only the admin sees the raw token once at creation time.
-- ---------------------------------------------------------------------------
create table if not exists public.api_tokens (
  id bigserial primary key,
  token_hash text not null unique,
  token_prefix text not null,
  title text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  usage_count bigint not null default 0,
  is_revoked boolean not null default false
);

create index if not exists api_tokens_expires_idx on public.api_tokens (expires_at);
create index if not exists api_tokens_created_idx on public.api_tokens (created_at);

alter table public.api_tokens enable row level security;

revoke all on public.api_tokens from anon, authenticated;
grant select, insert, update, delete on public.api_tokens to service_role;

-- ---------------------------------------------------------------------------
-- Admin credentials / session management.
--   admin_password  -> hashed admin password (for the admin panel)
--   admin_salt      -> random salt used in the password hash
-- ---------------------------------------------------------------------------
create table if not exists public.admin_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_settings enable row level security;

revoke all on public.admin_settings from anon, authenticated;
grant select, insert, update, delete on public.admin_settings to service_role;

commit;
