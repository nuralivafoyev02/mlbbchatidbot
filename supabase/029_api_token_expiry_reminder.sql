-- API kaliti muddati tugashiga 7 kun qolganda egasiga va adminlarga xabar
-- (api-token-reminders.mjs, prod Worker cron'i). Har bir muddat uchun bir
-- marta: shu ustunda qaysi expires_at uchun ogohlantirilgani saqlanadi.
-- Kalit uzaytirilsa expires_at o'zgaradi — keyingi muddat uchun yana bir marta.
--
-- Mavjud ma'lumotga tegmaydi. Qayta ishga tushirish xavfsiz.

begin;

alter table public.api_tokens add column if not exists expiry_reminded_for timestamptz;

commit;
