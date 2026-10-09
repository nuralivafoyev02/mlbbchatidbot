// ---------------------------------------------------------------------------
// "Admin bilan bog'lanish" — barcha tugma, havola va matnlardagi yagona manzil.
//
// Env'ga (SUPPORT_USERNAME) bog'liq EMAS: Vercel va Cloudflare'da turli qiymat
// qolib ketib, foydalanuvchilar turli odamlarga yo'naltirilgan edi (2026-10-09).
// O'zgartirish kerak bo'lsa — faqat shu yerda.
// ---------------------------------------------------------------------------

const ADMIN_CONTACT_USERNAME = "Ksava_org";

module.exports = {
  ADMIN_CONTACT_USERNAME,
  ADMIN_CONTACT_URL: `https://t.me/${ADMIN_CONTACT_USERNAME}`,
};
