begin;

alter table public.bot_users
  add column if not exists phone_number text;

create index if not exists bot_users_phone_number_idx
  on public.bot_users (phone_number)
  where phone_number is not null;

drop function if exists public.track_bot_user(
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
);

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
  p_message_text text default null,
  p_phone_number text default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_updates_delta integer := 0;
  v_phone_number text := nullif(regexp_replace(coalesce(p_phone_number, ''), '\D', '', 'g'), '');
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
    phone_number,
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
    v_phone_number,
    0,
    p_update_type,
    now(),
    now(),
    now()
  )
  on conflict (user_id) do update
  set
    chat_id = case
      when excluded.chat_type = 'private' then excluded.chat_id
      when public.bot_users.chat_type = 'private' then public.bot_users.chat_id
      else coalesce(excluded.chat_id, public.bot_users.chat_id)
    end,
    chat_type = case
      when excluded.chat_type = 'private' then excluded.chat_type
      when public.bot_users.chat_type = 'private' then public.bot_users.chat_type
      else coalesce(excluded.chat_type, public.bot_users.chat_type)
    end,
    username = coalesce(excluded.username, public.bot_users.username),
    first_name = coalesce(excluded.first_name, public.bot_users.first_name),
    last_name = coalesce(excluded.last_name, public.bot_users.last_name),
    language_code = coalesce(excluded.language_code, public.bot_users.language_code),
    is_bot = coalesce(excluded.is_bot, public.bot_users.is_bot),
    phone_number = coalesce(excluded.phone_number, public.bot_users.phone_number),
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

create or replace function public.find_bot_user_by_phone(p_phone_number text)
returns table (
  user_id bigint,
  chat_id bigint,
  chat_type text,
  username text,
  first_name text,
  last_name text,
  phone_number text
)
language sql
stable
set search_path = public
as $$
  select
    bot_users.user_id,
    bot_users.chat_id,
    bot_users.chat_type,
    bot_users.username,
    bot_users.first_name,
    bot_users.last_name,
    bot_users.phone_number
  from public.bot_users
  where bot_users.phone_number = nullif(regexp_replace(coalesce(p_phone_number, ''), '\D', '', 'g'), '')
  order by bot_users.last_seen_at desc nulls last
  limit 1;
$$;

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
  text,
  text
) from public, anon, authenticated;

revoke all on function public.find_bot_user_by_phone(text) from public, anon, authenticated;

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
  text,
  text
) to service_role;

grant execute on function public.find_bot_user_by_phone(text) to service_role;

commit;
