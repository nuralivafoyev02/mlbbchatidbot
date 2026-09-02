begin;

-- Add preferred_language column to bot_users table
alter table public.bot_users
  add column if not exists preferred_language text default 'uz';

-- Update the track_bot_user function to accept and store preferred_language
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
  p_preferred_language text default null
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
    updated_at,
    preferred_language
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
    now(),
    coalesce(p_preferred_language, 'uz')
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
    preferred_language = coalesce(excluded.preferred_language, public.bot_users.preferred_language),
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

-- Create RPC function to set user preferred language
create or replace function public.set_user_preferred_language(
  p_user_id bigint,
  p_language text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.bot_users (user_id, preferred_language, first_seen_at, last_seen_at, updates_count, updated_at)
  values (p_user_id, coalesce(p_language, 'uz'), now(), now(), 0, now())
  on conflict (user_id) do update
  set preferred_language = coalesce(p_language, 'uz'),
      updated_at = now();
end;
$$;

-- Create RPC function to get user preferred language
create or replace function public.get_user_preferred_language(
  p_user_id bigint
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_lang text;
begin
  select preferred_language into v_lang
  from public.bot_users
  where user_id = p_user_id;

  return coalesce(v_lang, 'uz');
end;
$$;

-- Revoke from non-service roles
revoke all on function public.track_bot_user(
  bigint, bigint, text, text, text, text, text, boolean, bigint, text, text, text
) from public, anon, authenticated;

revoke all on function public.set_user_preferred_language(bigint, text) from public, anon, authenticated;
revoke all on function public.get_user_preferred_language(bigint) from public, anon, authenticated;

-- Grant to service_role
grant execute on function public.track_bot_user(
  bigint, bigint, text, text, text, text, text, boolean, bigint, text, text, text
) to service_role;

grant execute on function public.set_user_preferred_language(bigint, text) to service_role;
grant execute on function public.get_user_preferred_language(bigint) to service_role;

commit;
