begin;

create table if not exists public.bot_users (
  user_id bigint primary key,
  chat_id bigint,
  chat_type text,
  username text,
  first_name text,
  last_name text,
  language_code text,
  is_bot boolean,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updates_count integer not null default 0,
  last_update_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_usage_events (
  id bigserial primary key,
  user_id bigint not null references public.bot_users(user_id) on delete cascade,
  chat_id bigint,
  update_id bigint unique,
  update_type text not null,
  message_text text,
  created_at timestamptz not null default now()
);

create index if not exists bot_users_last_seen_at_idx
  on public.bot_users (last_seen_at desc);

create index if not exists bot_usage_events_created_at_idx
  on public.bot_usage_events (created_at desc);

create index if not exists bot_usage_events_user_month_idx
  on public.bot_usage_events (user_id, created_at desc);

alter table public.bot_users enable row level security;
alter table public.bot_usage_events enable row level security;

create or replace function public.track_bot_user(
  p_user_id bigint,
  p_chat_id bigint default null,
  p_chat_type text default null,
  p_username text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_language_code text default null,
  p_is_bot boolean default null,
  p_update_id bigint default null,
  p_update_type text default null,
  p_message_text text default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_updates_delta integer := 0;
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.bot_users (
    user_id,
    chat_id,
    chat_type,
    username,
    first_name,
    last_name,
    language_code,
    is_bot,
    updates_count,
    last_update_type,
    first_seen_at,
    last_seen_at,
    updated_at
  )
  values (
    p_user_id,
    p_chat_id,
    p_chat_type,
    p_username,
    p_first_name,
    p_last_name,
    p_language_code,
    p_is_bot,
    0,
    p_update_type,
    now(),
    now(),
    now()
  )
  on conflict (user_id) do update
  set
    chat_id = coalesce(excluded.chat_id, public.bot_users.chat_id),
    chat_type = coalesce(excluded.chat_type, public.bot_users.chat_type),
    username = excluded.username,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    language_code = excluded.language_code,
    is_bot = coalesce(excluded.is_bot, public.bot_users.is_bot),
    last_update_type = coalesce(excluded.last_update_type, public.bot_users.last_update_type),
    last_seen_at = now(),
    updated_at = now();

  if p_update_type is not null then
    insert into public.bot_usage_events (
      user_id,
      chat_id,
      update_id,
      update_type,
      message_text,
      created_at
    )
    values (
      p_user_id,
      p_chat_id,
      p_update_id,
      p_update_type,
      p_message_text,
      now()
    )
    on conflict (update_id) do nothing;

    get diagnostics v_updates_delta = row_count;

    if v_updates_delta > 0 then
      update public.bot_users
      set
        updates_count = updates_count + v_updates_delta,
        last_seen_at = now(),
        updated_at = now()
      where user_id = p_user_id;
    end if;
  end if;
end;
$$;

create or replace view public.bot_monthly_active_users
with (security_invoker = true)
as
select
  date_trunc('month', created_at)::date as month,
  count(distinct user_id)::integer as active_users,
  count(*)::integer as updates
from public.bot_usage_events
group by 1
order by 1 desc;

revoke all on public.bot_users from anon, authenticated;
revoke all on public.bot_usage_events from anon, authenticated;
revoke all on public.bot_monthly_active_users from anon, authenticated;
revoke all on function public.track_bot_user(
  bigint,
  bigint,
  text,
  text,
  text,
  text,
  text,
  boolean,
  bigint,
  text,
  text
) from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update on public.bot_users to service_role;
grant select, insert on public.bot_usage_events to service_role;
grant usage, select on sequence public.bot_usage_events_id_seq to service_role;
grant select on public.bot_monthly_active_users to service_role;
grant execute on function public.track_bot_user(
  bigint,
  bigint,
  text,
  text,
  text,
  text,
  text,
  boolean,
  bigint,
  text,
  text
) to service_role;

commit;
