-- Mini app sozlamalari: default limitlar va adminlar ro'yxati.
-- admin_settings jadvaliga 'miniapp_settings' va 'admin_ids' kalitlarini qo'shadi.

begin;

-- Mini app settings (default bind limit, default fullinfo quota)
insert into public.admin_settings (key, value, updated_at)
values ('miniapp_settings', '{"defaultBindLimit":10,"defaultFullinfoQuota":3}'::jsonb, now())
on conflict (key) do nothing;

-- Admin IDs list (for the mini app admin list management)
insert into public.admin_settings (key, value, updated_at)
values ('admin_ids', '{"ids":["5081175125","7396686285"]}'::jsonb, now())
on conflict (key) do nothing;

commit;
