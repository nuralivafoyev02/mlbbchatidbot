-- Balansni to'ldirish: Hamyon API (https://hamyon-api.uz) orqali.
--
-- Hamyon `POST /payment/create` javobida muayyan to'lov uchun qaysi kartaga
-- pul o'tkazish `card` sifatida qaytadi (pay_url yo'q). Egri `pay_url` o'rniga
-- shu karta raqami saqlanadi va kabinetda mijozga ko'rsatiladi.

begin;

alter table public.wallet_topups add column if not exists card text;

commit;