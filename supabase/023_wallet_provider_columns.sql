-- Balansni to'ldirish: Hamyon to'lovini so'rovga bog'laydigan ustunlar.
--
-- Bazadagi wallet_topups 020 ning dastlabki varianti bilan yaratilgan va
-- `provider_order` / `pay_url` ustunlari yo'q edi. Natijada Hamyon'da to'lov
-- ochilar, lekin payment_id saqlanmay kabinetda xato chiqar va to'lov
-- avtomatik tekshirilmas edi (`column wallet_topups.provider_order does not
-- exist`). Bu migratsiya qayta ishga tushirilsa ham xavfsiz.

begin;

alter table public.wallet_topups add column if not exists provider_order text;
alter table public.wallet_topups add column if not exists pay_url text;
alter table public.wallet_topups add column if not exists card text;

-- Bitta Hamyon payment_id faqat bitta so'rovga tegishli (callback qidiruvi ham shu).
create unique index if not exists wallet_topups_provider_order_uniq
  on public.wallet_topups (provider_order)
  where provider_order is not null;

commit;

-- PostgREST schema keshini yangilash (yangi ustunlar darhol ko'rinsin).
notify pgrst, 'reload schema';
