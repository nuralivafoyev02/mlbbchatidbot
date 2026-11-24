-- 1) Foydalanuvchini bloklash: admin panel → Foydalanuvchilar → foydalanuvchi →
--    "Bloklash" / "Blokdan ochish". Bloklangan foydalanuvchiga bot faqat bitta
--    matn bilan javob beradi (api/bot.js → handleBlockedUserUpdate). Beta va
--    prod bitta bazani ishlatadi — blok ikkala botda ham amal qiladi.
-- 2) Ommaviy API kaliti egasi: admin panel → Sozlamalar → Ommaviy API → kalit →
--    "Muddatni uzaytirish". Egasining Telegram ID'si saqlanadi va uzaytirilganda
--    bot unga xabar yuboradi.
--
-- Mavjud ma'lumotga tegmaydi. Qayta ishga tushirish xavfsiz.

begin;

alter table public.bot_users add column if not exists is_blocked boolean not null default false;
alter table public.bot_users add column if not exists blocked_at timestamptz;
alter table public.bot_users add column if not exists blocked_by text;

create index if not exists bot_users_blocked_idx
  on public.bot_users (user_id)
  where is_blocked;

alter table public.api_tokens add column if not exists owner_user_id bigint;

commit;

-- Tekshirish (ixtiyoriy):
--   select count(*) filter (where is_blocked) as blocked from public.bot_users;
--   select id, title, expires_at, owner_user_id from public.api_tokens order by id desc;
