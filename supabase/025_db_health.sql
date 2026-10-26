begin;

-- Kunlik holat hisoboti (health-report.mjs) uchun: DB hajmi va ulanishlar soni.
-- Free plan cheklovi 500 MB — hisobotda foizi ko'rsatiladi.
create or replace function public.get_db_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'connections', (select count(*) from pg_stat_activity where datname = current_database())
  );
$$;

revoke all on function public.get_db_health() from public, anon, authenticated;
grant execute on function public.get_db_health() to service_role;

commit;
