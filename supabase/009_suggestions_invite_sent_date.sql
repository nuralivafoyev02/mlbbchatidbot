-- 009 — Taklif guruhi taklifi: kuniga 1 marta (Toshkent vaqti bo'yicha)
-- bot_users jadvaliga suggestions_invite_sent_date (date) ustuni qo'shiladi.
-- Bot muvaffaqiyatli server check'dan keyin bu sanaga qarab taklif xabarchasini
-- kuniga bir marta yuboradi (00:00 Toshkent vaqti bilan yangi kun boshlanadi).

alter table public.bot_users
  add column if not exists suggestions_invite_sent_date date;
