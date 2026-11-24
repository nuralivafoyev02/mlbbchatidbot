-- Yangi foydalanuvchining boshlang'ich limitlari admin paneldan olinsin.
--
-- Muammo: admin panel → Sozlamalar → "Yangi foydalanuvchi limitlari"
-- (admin_settings.miniapp_settings: defaultFullinfoQuota / defaultResetPwQuota)
-- faqat saqlanardi, hech qayerda qo'llanmasdi. track_bot_user yangi qatorni
-- ustunning standart qiymati bilan yozardi (5 / 3) — shuning uchun hammaning
-- limiti 1 ga tushirilgandan keyin ham yangi kelganlar 5 / 3 olardi.
--
-- Yechim: bot_users ga INSERT oldidan trigger — limitlarni admin sozlamasidan
-- qo'yadi (sozlama yo'q yoki noto'g'ri bo'lsa — 1). Faqat yangi qatorga
-- ta'sir qiladi; mavjud foydalanuvchilar o'zgarmaydi. Beta va prod bitta
-- bazani ishlatgani uchun ikkala bot uchun ham ishlaydi. Qayta ishga
-- tushirish xavfsiz.

begin;

-- Zaxira: trigger biror sababdan ishlamasa ham standart qiymat 1 bo'lsin.
alter table public.bot_users alter column full_info_quota set default 1;
alter table public.bot_users alter column reset_pw_quota set default 1;

create or replace function public.bot_users_apply_default_quotas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_full_info integer;
  v_reset_pw integer;
begin
  select value into v_settings
  from public.admin_settings
  where key = 'miniapp_settings';

  begin
    v_full_info := (v_settings ->> 'defaultFullinfoQuota')::integer;
  exception when others then
    v_full_info := null;
  end;
  begin
    v_reset_pw := (v_settings ->> 'defaultResetPwQuota')::integer;
  exception when others then
    v_reset_pw := null;
  end;

  new.full_info_quota := greatest(coalesce(v_full_info, 1), 0);
  new.reset_pw_quota := greatest(coalesce(v_reset_pw, 1), 0);
  return new;
end;
$$;

drop trigger if exists bot_users_default_quotas on public.bot_users;
create trigger bot_users_default_quotas
  before insert on public.bot_users
  for each row
  execute function public.bot_users_apply_default_quotas();

revoke all on function public.bot_users_apply_default_quotas() from public, anon, authenticated;

commit;

-- Tekshirish (ixtiyoriy):
--   select column_name, column_default from information_schema.columns
--   where table_name = 'bot_users' and column_name in ('full_info_quota', 'reset_pw_quota');
--   select tgname from pg_trigger where tgname = 'bot_users_default_quotas';
