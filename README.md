# ☁️ Cloud-TG — Telegram ichidagi shaxsiy bulut xotira

Telegram bot + zamonaviy Web App (mini ilova). Botga yuborilgan har qanday fayl
bulutga saqlanadi va chiroyli, tez, ko‘p tilli web ilovada ko‘rinadi.

**v3.0.0** — to‘liq qayta ishlangan UI/UX, admin panel, desktop rejim va 6 ta til.

---

## 📋 Mundarija

- [Asosiy imkoniyatlar](#-asosiy-imkoniyatlar)
- [Tezkor ishga tushirish](#-tezkor-ishga-tushirish)
- [Muhit o‘zgaruvchilari](#-muhit-ozgaruvchilari)
- [Arxitektura](#-arxitektura)
- [API](#-api)
- [Tarjimalar (i18n)](#-tarjimalar-i18n)
- [Ishlash tezligi (optimizatsiya)](#-ishlash-tezligi-optimizatsiya)
- [Xavfsizlik](#-xavfsizlik)
- [Demo rejim](#-demo-rejim)
- [Muammolarni hal qilish](#-muammolarni-hal-qilish)

---

## ✨ Asosiy imkoniyatlar

### Web ilova (`/app`)
| Bo‘lim | Nima qiladi |
|---|---|
| **Barcha fayllar** | Grid yoki ro‘yxat ko‘rinishi, saralash (sana/nom/hajm), qidiruv |
| **Rasmlar** | Galereya — rasmlar **avtomatik yuklanadi** (lazy-load, skroll qilganda) |
| **Video** | Ichki pleer: seek, tezlik (0.5x–2x), tovush, fullscreen, klaviatura boshqaruvi |
| **Audio** | Pleylistli musiqa pleer: repeat, shuffle, seek, keyingi/oldingi trek |
| **Hujjatlar / Arxivlar** | Turi bo‘yicha ikonka, PDF — ichki ko‘rish, matnli fayllar — kod sifatida |
| **Sevimlilar** | Yulduzcha bosilgan fayllar alohida joyda |
| **Savat** | O‘chirilgan fayllar 30 kun saqlanadi, tiklash yoki butunlay o‘chirish |
| **Sozlamalar** | Til, mavzu (avto/yorug‘/qorong‘i), desktop rejim, zichlik, bildirishnomalar, avto-muddat |
| **Admin panel** | Faqat adminlar uchun: statistika, foydalanuvchilar, fayllar, xabar yuborish, tizim |

### Boshqa ishlar
- **Ko‘p tanlov (multi-select)** — bir nechta faylni birdan yuborish/o‘chirish/sevimlilarga qo‘shish
- **Uzoq bosish menyusi** (mobil) va **o‘ng tugma** (desktop) — kontekst menyu
- **Rasm ko‘rish oynasi** — zoom, surish, oldinga/orqaga, yuklab olish
- **Klaviatura tugmalari** — `/` qidiruv, `Ctrl+A` barchasini tanlash, `Enter` ko‘rish, `Del` o‘chirish, `R` yangilash, `F` fullscreen
- **Desktop rejim** — keng ekranda yon menyu, ko‘p ustunli grid, sichqoncha effektlari
- **Avtomatik fullscreen** — desktopda ochilganda to‘liq ekranga o‘tadi
- **PWA** — manifest + service worker (offline shell), telefon ekraniga o‘rnatish mumkin
- **Telegram mavzusiga moslashish** — `themeParams` orqali ilova Telegram ranglarini oladi

### Bot
- Har qanday fayl (50 MB gacha) → avtomatik saqlash
- Media guruhlar (albom) → birdaniga bir nechta fayl
- `/f nomi` — faylni topib yuborish, `/d nomi` — o‘chirish
- Inline rejim: istalgan chatda `@bot so‘z` deb qidirish
- Menyu: Mening fayllarim · Qidirish · Jildlar · Muddati tugaydigan · Ulashish · Sozlamalar
- `/app` — web ilovani ochish, `/admin` — admin panel

---

## 🚀 Tezkor ishga tushirish

```bash
git clone https://github.com/ahmadjon09/Cloud-TG.git
cd Cloud-TG
npm install
cp .env.example .env      # o‘z ma’lumotlaringiz bilan to‘ldiring
npm start                 # yoki: npm run dev
```

Keyin @BotFather’da:
1. `/newbot` → token oling → `.env` ichidagi `BOT_TOKEN`
2. `/newapp` (yoki `/setmenubutton`) → Web App URL: `https://sizning-domen.com/app`
3. **Inline rejimni** yoqing: `/setinline`
4. Buyruqlar ro‘yxati avtomatik o‘rnatiladi

> Telegram **HTTPS** talab qiladi. Lokal ishlab chiqish uchun `ngrok`/`cloudflared`
> yoki `DEMO_MODE=true` bilan brauzerda oching.

---

## 🔧 Muhit o‘zgaruvchilari

`.env.example` faylida to‘liq ro‘yxat bor. Eng muhimlari:

| O‘zgaruvchi | Majburiy | Izoh |
|---|---|---|
| `BOT_TOKEN` | ✅ | @BotFather tokeni (web app autentifikatsiyasi shunga asoslangan) |
| `BASE_URL` | ✅ | Serverning ochiq HTTPS manzili (web app tugmasi + keep-alive) |
| `MONGO_URI` | ✅* | MongoDB ulanishi (*agar `DEMO_MODE=true` bo‘lmasa) |
| `ADMIN_IDS` | ➖ | Adminlarning Telegram ID lari (vergul bilan) |
| `PORT` / `HOST` | ➖ | Standart: `5000` / `0.0.0.0` |
| `DEMO_MODE` | ⚠️ | `true` → xotiradagi (memory) store. **Productionda YOQMANG** |
| `BOT_TOKEN_SUP` | ➖ | Qo‘llab-quvvatlash (support) boti uchun alohida token |
| `INIT_DATA_TTL` | ➖ | initData amal qilish muddati (soniyalarda), standart 86400 |

---

## 🏗 Arxitektura

```
src/
├── index.js                 # ishga tushirish: i18n → DB → HTTP → botlar
├── server.js                # Express 5: static, API, media, admin
├── bot.js                   # Telegraf bot (to‘liq i18n)
├── support.js               # ixtiyoriy support bot (lazy — import qilishda yiqilmaydi)
├── db.js                    # driver tanlash: mongodb | memory
├── tg.js                    # Telegram Bot API: timeout, retry, kesh
├── authWebApp.js            # initData HMAC tekshiruvi (kesh bilan)
├── models/                  # Mongoose sxemalari
├── store/
│   ├── mongo.js             # MongoDB (mongoose) implementatsiyasi
│   └── memory.js            # Demo/sinov uchun xotiradagi store
├── http/
│   ├── middleware.js        # CSP, gzip, rate limit, xatolar
│   ├── static.js            # ETag + gzip kesh + immutable URL
│   ├── pages.js             # HTML qobiq + boot payload
│   ├── mediaToken.js        # imzolangan qisqa muddatli media linklar
│   └── routes/              # api.js · media.js · admin.js
├── utils/                   # i18n, languages, fileType, cache, rateLimit
└── locales/                 # en · uz · ru · ch · es · fr (545 ta kalit)

public/
├── app.html  admin.html  offline.html  manifest.webmanifest  sw.js
├── css/   tokens.css · app.css · admin.css
└── js/    core · i18n · icons · api · ui · media · app · admin
```

**Nima uchun `store/`?** Barcha ma’lumotlar bilan ishlash bitta interfeys orqali
yuradi, shuning uchun MongoDB’siz ham (demo, test, UI ishlab chiqish) ilova to‘liq
ishlaydi. Productionda har doim MongoDB ishlatiladi.

---

## 🔌 API

Barcha `/api/*` so‘rovlari `x-telegram-init-data` sarlavhasi bilan autentifikatsiya
qilinadi (HMAC-SHA256, Telegram qoidasiga muvofiq).

| Method | Endpoint | Izoh |
|---|---|---|
| `GET` | `/api/me` | Profil, sozlamalar, statistika, `isAdmin` |
| `PATCH` | `/api/me` | Til va/yoki sozlamalarni yangilash |
| `POST` | `/api/me/detect-language` | Telegram `language_code` bo‘yicha tilni aniqlash |
| `GET` | `/api/files` | `q`, `category`, `favorite`, `trash`, `sort`, `limit`, `skip` |
| `GET` | `/api/files/counts` | Bo‘limlar bo‘yicha hisoblagichlar |
| `GET` | `/api/files/:id` | Bitta fayl |
| `PATCH` | `/api/files/:id` | Nomi, izoh, sevimli, maxfiy, muddat |
| `DELETE` | `/api/files/:id` | Savatga (`?hard=1` — butunlay) |
| `POST` | `/api/files/:id/restore` | Savatdan tiklash |
| `POST` | `/api/files/:id/send` | Telegram chatga qayta yuborish |
| `POST` | `/api/files/:id/token` | Media uchun imzolangan link (6 soat) |
| `POST` | `/api/files/bulk` | `send` · `delete` · `restore` · `hardDelete` · `favorite` |
| `GET` | `/api/media/:id/preview` | Range qo‘llab-quvvatlaydi (video seek) |
| `GET` | `/api/media/:id/thumb` | Rasmlar uchun |
| `GET` | `/api/media/:id/download` | Yuklab olish |
| `GET` | `/api/admin/*` | Faqat `ADMIN_IDS` uchun: overview, users, files, broadcast, system |

---

## 🌐 Tarjimalar (i18n)

- **6 ta til:** `en` · `uz` · `ru` · `ch` · `es` · `fr`
- **Yagona manba:** `src/locales/<lang>.json` — bot va web ilova bitta fayldan o‘qiydi
- Web ilovaga faqat kerakli qismi (`web.*`, `common.*`, `langs.*`, `expiry.*`, `support.*`) yuboriladi
- Brauzer tarjimalarni `localStorage` da keshlaydi (build versiyasi bilan)
- Til avtomatik aniqlanadi: foydalanuvchi sozlamasi → Telegram `language_code` → brauzer tili
- `data-i18n`, `data-i18n-placeholder`, `data-i18n-title` — HTML ichida statik tarjimalar
- Bot buyruqlari (`/start`, `/help`, `/app`, `/f`, `/d`) **har bir til uchun alohida** ro‘yxatdan o‘tkaziladi

Yangilangan tekshiruv: har bir tilda **545 ta kalit** — barchasi joyida,
`{placeholder}` lar va HTML teglari bir xil.

---

## ⚡ Ishlash tezligi (optimizatsiya)

- **Lazy thumbnails** — rasm tokeni faqat karta ekranga yaqinlashganda olinadi (`IntersectionObserver`)
- **Imzolangan media linklar** — har bir rasm so‘rovida ~1 KB li `initData` yuborilmaydi
- **getFile kesh** (45 daqiqa) — Telegram’ga qo‘shimcha so‘rovlar yo‘q
- **TTL kesh** — fayllar ro‘yxati, statistika, admin overview
- **Gzip/deflate** — JSON javoblar va matnli fayllar
- **Statik fayllar** — ETag + xotiradagi gzip + `?v=<build>` immutable kesh
- **Boot payload** — kerakli konfiguratsiya HTML ichiga joylangan (qo‘shimcha so‘rov yo‘q)
- **Service worker** — offline shell + kesh
- **`loading="lazy"` + `decoding="async"`** — rasmlar ekranni to‘smaydi
- **Rate limiting** — API, yozish, stream, Telegram, admin uchun alohida
- **MongoDB indekslari** — eng ko‘p ishlatiladigan so‘rovlar bo‘yicha
- **Streaming** — video/audio `pipeline` orqali, xotiraga yuklanmaydi, Range qo‘llab-quvvatlanadi

---

## 🔒 Xavfsizlik

- `initData` — HMAC-SHA256 tekshiruvi (`timingSafeEqual`), TTL va kesh bilan
- Media linklari — HMAC imzolangan, 6 soat amal qiladi, maqsadi (`preview`/`download`) tekshiriladi
- Har bir so‘rov `ownerTgUserId` bo‘yicha tekshiriladi — boshqa birovning fayliga yo‘l yo‘q
- CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`
- Path traversal himoyasi (statik fayllar)
- Admin endpointlari — `ADMIN_IDS` bo‘yicha
- Tokenlar va `initData` loglanmaydi

---

## 🧪 Demo rejim

MongoDB va bot tokensiz to‘liq UI-ni ko‘rish uchun:

```bash
DEMO_MODE=true npm start
# → http://localhost:5000/app     (namuna fayllar bilan)
# → http://localhost:5000/admin   (agar ADMIN_IDS ichida bo‘lsangiz)
```

Demo rejimda ma’lumotlar **xotirada** saqlanadi va qayta ishga tushirganda yo‘qoladi.
Productionda `DEMO_MODE` ni **hech qachon** yoqmang.

---

## 🛠 Muammolarni hal qilish

| Muammo | Yechim |
|---|---|
| `Missing env vars: BOT_TOKEN, BASE_URL` | `.env` to‘ldirilganini tekshiring |
| Web app `Not authenticated` | `BASE_URL` HTTPS bo‘lishi kerak; `INIT_DATA_TTL` ni tekshiring |
| Rasmlar ko‘rinmaydi | Web orqali olish chegarasi 20 MB; Telegram tokeni to‘g‘riligini tekshiring |
| Video o‘ynalmaydi | Brauzer kodekni qo‘llab-quvvatlamaydi yoki fayl 20 MB dan katta |
| MongoDB ulanmaydi | `MONGO_URI` yoki `DEMO_MODE=true` |
| Bot buyruqlari ko‘rinmaydi | Bot qayta ishga tushganda buyruqlar avtomatik o‘rnatiladi |

---

## 📄 Litsenziya

ISC

### Web fayllarni tekshirish

`npm test` ro‘yxat, ownership, media token, preview/download, Range va Telegramga
qayta yuborishni soxta Telegram javoblari bilan tekshiradi (haqiqiy token kerak emas).
Oddiy Telegram Bot API `getFile` orqali **20 MB gacha** fayl beradi; kattaroq
fayllar uchun **Telegramga yuborish** tugmasidan foydalaning. Bu botga fayl
saqlash/yuborish chegarasidan alohida cheklov.
