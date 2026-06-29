begin;

create or replace function public.check_bind_limit_only(
  p_user_id bigint,
  p_limit integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_today date := (current_timestamp at time zone 'Asia/Tashkent')::date;
  v_user record;
  v_checks integer;
begin
  select * into v_user from public.bot_users where user_id = p_user_id;
  
  if not found then
    return jsonb_build_object('allowed', true, 'remaining', p_limit);
  end if;

  if v_user.last_bind_info_check_date is distinct from v_today then
    v_checks := 0;
  else
    v_checks := coalesce(v_user.bind_info_checks_today, 0);
  end if;

  if v_checks >= p_limit then
    return jsonb_build_object('allowed', false, 'remaining', 0);
  end if;

  return jsonb_build_object('allowed', true, 'remaining', p_limit - v_checks);
end;
$$;

revoke all on function public.check_bind_limit_only(bigint, integer) from public, anon, authenticated;
grant execute on function public.check_bind_limit_only(bigint, integer) to service_role;

commit;
