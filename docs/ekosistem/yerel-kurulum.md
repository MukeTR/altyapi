# Ekosistem — üç ürünü yerelde birlikte çalıştırma

altyapi, Kârmatik ve Yanıt'ı tek makinede, **canlıya dokunmadan** birlikte çalıştırma rehberi.
Sözleşme: [`v1.md`](./v1.md). Orkestrasyon betiği: `tools/ekosistem/yerel.sh`. altyapi tohumu:
`tools/ekosistem/tohum-altyapi.ts`.

Temel kural: hiçbir süreç canlı veritabanına bağlanmaz. Kârmatik canlı Supabase'i (`udlmhjozkihasspfgzkp`)
ve Yanıt canlı Supabase'i (`vtuavcgggkykprihtjgb`) yalnız ortam dosyası yanlışsa görür; `yerel.sh` böyle bir
dosyayla servisi **başlatmaz** (bkz. §4).

## 1. Ön koşullar

| Parça | Nerede | Not |
|---|---|---|
| altyapi Postgres | docker `altyapi-postgres-1`, `localhost:5433` | `cd /Users/macos/altyapi && docker compose up -d` |
| altyapi Valkey | docker `altyapi-valkey-1`, `localhost:6379` | aynı compose |
| altyapi MinIO | docker `altyapi-minio-1`, `localhost:9000` | yoksa medya yükleme çalışmaz, servisler yine açılır |
| Kârmatik Supabase | docker `supabase_{db,kong,auth,rest,inbucket}_udlmhjozkihasspfgzkp`; kong `54331`, db `54329`, mailpit `54334` | Adı canlı ref'i taşır ama yereldir. `karmatikdev` içinde `supabase start` **çalıştırma** (başka projenin config'i, portlar `supabase_*_macos` ile çakışır). |
| Yanıt Postgres | Homebrew `postgresql@17`, `127.0.0.1:5432`, veritabanı `yanit_ekosistem` (testler `yanit_test_ekosistem`) | `5499` başka bir oturumun geçici kümesi, kullanma. |
| Node | altyapi ve Kârmatik: sistem Node'u (≥ 22.12); Yanıt: Node 22 (`/opt/homebrew/opt/node@22/bin`) | `yerel.sh` Yanıt için PATH'i kendisi ayarlar. |
| Ortam dosyaları | altyapi `.env` (`APP_ENV=local`, `DATABASE_URL` → `localhost:5433`); Kârmatik `/Users/macos/karmatikdev/.env.development.local`; Yanıt `/Users/macos/yanit-wt/ekosistem/apps/web/.env.local` | Kârmatik ve Yanıt dosyalarının içeriği: `karmatikdev/docs/EKOSISTEM-YEREL.md` ve Yanıt'ın ekosistem dalı. |

Ağaçlar ve dallar: altyapi `/Users/macos/altyapi` (`dev`), Kârmatik `/Users/macos/karmatikdev`
(`ekosistem-asama2`), Yanıt `/Users/macos/yanit-wt/ekosistem` (`ekosistem-kopru-v2`). Başka konumlar için
`KARMATIK_DIR`, `YANIT_DIR`, `UYGULAMA_DIR`, `NODE22_BIN` ortam değişkenleri.

## 2. Portlar ve eş adresleri

| Servis | Port | Sağlık ucu | Komut (`yerel.sh` başlatır) |
|---|---|---|---|
| `altyapi-api` | 4000 | `GET /readyz` | `apps/api`: `node --env-file=../../.env --import tsx src/server.ts` |
| `altyapi-worker` | 4100 (yalnız sağlık) | `GET /healthz` | `apps/worker`: `node --env-file=../../.env --import tsx src/main.ts` |
| `karmatik` | 3999 | `GET /api/public/version` | `./node_modules/.bin/vite dev --port 3999 --strictPort` |
| `yanit` | 3200 | `GET /api/health` | `pnpm --filter @yanit/web exec next dev -p 3200` (Node 22) |
| altyapi admin / vitrin | 3000 / 3001 | — | Zaten açık (dev ağacı); `yerel.sh` dokunmaz. |

Eşler adreslerini ortamdan okur; `yerel.sh` her servise şunları verir (kabuktaki değer dosyadakini ezer):

- altyapi: `EKOSISTEM_PEER_BASE_KARMATIK=http://localhost:3999/api/public`, `EKOSISTEM_PEER_BASE_YANIT=http://localhost:3200/api`
  (`APP_ENV=local` `.env`'de; localhost yalnız bu durumda kabul edilir).
- Kârmatik: `EKOSISTEM_APP_ENV=local`, `EKOSISTEM_PEER_BASE_ALTYAPI=http://localhost:4000`, `EKOSISTEM_PEER_BASE_YANIT=http://localhost:3200/api`.
  Değişken yoksa Kârmatik **üretim** adresine (`https://api.altyapi.io`, `https://yanit.io/api`) gider.
- Yanıt: `EKOSISTEM_PEER_BASE_ALTYAPI=http://localhost:4000`, `EKOSISTEM_PEER_BASE_KARMATIK=http://localhost:3999/api/public`
  (`NODE_ENV≠production` iken localhost kabul edilir).

## 3. `yerel.sh` komutları

```bash
cd /Users/macos/altyapi
tools/ekosistem/yerel.sh up                          # dördü birden; sağlık bekler
tools/ekosistem/yerel.sh up altyapi-api altyapi-worker
tools/ekosistem/yerel.sh status                      # servisler, portu tutan süreç, docker, bekçiler
tools/ekosistem/yerel.sh logs karmatik -f
tools/ekosistem/yerel.sh tohum                       # altyapi tohumu (API açık olmalı)
tools/ekosistem/yerel.sh tohum hepsi                 # altyapi + Kârmatik + Yanıt tohumları
tools/ekosistem/yerel.sh tick                        # zamanlanmış iş uçlarını bir kez çağırır
tools/ekosistem/yerel.sh test                        # uçtan uca testler (iskelet)
tools/ekosistem/yerel.sh down                        # yalnız bu betiğin başlattıklarını durdurur
```

- Her servis kendi süreç grubunda ve **temiz bir ortamla** (`env -i`) başlar: kabukta export edilmiş bir
  canlı `SUPABASE_URL` sızamaz. PID ve log'lar `tools/ekosistem/.yerel/` altında (git'e girmez).
- `down` yalnız PID dosyasındaki süreç grubunu durdurur; başka oturumların süreçlerine dokunmaz.
- Port doluysa servis atlanır ve portu tutan süreç (pid, komut, çalışma dizini) yazılır.
- `status` çıktısında `PORTU TUTAN` sütunu `yerel.sh` değilse o süreç bu betiğin değildir.

## 4. Güvenlik bekçileri (başlatmadan önce)

| Bekçi | Koşul | Sonuç |
|---|---|---|
| Kârmatik ortamı | `.env.development.local` var; `SUPABASE_URL` ve `VITE_SUPABASE_URL` 127.0.0.1/localhost; `.env`'de canlı adres taşıyan her anahtar (`supabase.co`, canlı ref'ler, `karmatik.io`, `yanit.io`, `altyapi.io`) bu dosyada yerel/boş bir değerle eziliyor | Değilse başlatılmaz. |
| Yanıt ortamı | `apps/web/.env.local` var; `DATABASE_URL` (ve varsa `DIRECT_URL`) yerel; üretilmiş Prisma istemcisinin geri düştüğü env dosyası (`schemaEnvPath`) ya da `packages/db/.env` canlıysa aynı anahtarlar `.env.local`'da eziliyor | Değilse başlatılmaz. |
| altyapi ortamı | `.env` `DATABASE_URL` yerel ve `APP_ENV=local` | Değilse başlatılmaz. |
| Worktree yarışı | `/Users/macos/altyapi-uygulama`'dan çalışan API/worker (node/tsx/pnpm/turbo) yok | Varsa `up` tümden reddedilir; süreçleri sen durdur (bkz. §9.2). |
| Docker | altyapi için postgres + valkey; Kârmatik için supabase db/kong/auth/rest | Eksikse o servis atlanır. |
| `tick` | Kârmatik ve Yanıt uçları yalnız 3999/3200'ü `yerel.sh` başlattıysa çağrılır; Yanıt `daily-run` yalnız `NEXT_PUBLIC_SITE_URL` yerelse (kendini zincirleme tetiklerken bu adrese gider, varsayılanı `https://yanit.io`) | Değilse o uç geçilir. |

## 5. Kimlik dosyası

`tools/ekosistem/.yerel/kimlikler.env` (izin 0600, git'e girmez). Her tohum yalnız kendi anahtarlarını yazar,
diğer satırlara dokunmaz:

| Anahtar | Yazan |
|---|---|
| `ALTYAPI_EMAIL`, `ALTYAPI_PASSWORD`, `ALTYAPI_ORG_ID`, `ALTYAPI_STORE_ID`, `ALTYAPI_ORG_SLUG`, `ALTYAPI_STORE_SLUG` | `tohum-altyapi.ts` |
| `KARMATIK_EMAIL`, `KARMATIK_PASSWORD`, `KARMATIK_USER_ID` | Kârmatik `scripts/ekosistem-yerel-tohum.ts` |
| `YANIT_EMAIL`, `YANIT_PASSWORD` (ve `tick` için `YANIT_CRON_SECRET`) | Yanıt `packages/db/scripts/ekosistem-yerel-tohum.ts` |

Kullanıcılar: `ekosistem-yerel@altyapi.local`, `ekosistem-yerel@karmatik.local`, `ekosistem-yerel@yanit.local`.
`YANIT_CRON_SECRET` yoksa `tick` Yanıt'ın `apps/web/.env.local` `CRON_SECRET` değerini kullanır. Kârmatik
hook'larının sırrı `.env.development.local` `CRON_SECRET`'tır (`apikey` başlığı). Tohumları aynı anda
çalıştırma: altyapi tohumu dosyayı kilitle yazar, diğerleri satır ekler.

## 6. altyapi tohumu

`yerel.sh tohum` (ya da `cd apps/api && node --env-file=../../.env --import tsx ../../tools/ekosistem/tohum-altyapi.ts`).
API'yi kendisi başlatmaz; `/readyz` yanıt vermezse durur. Yalnız `APP_ENV=local`, `DATABASE_URL` →
`localhost:5433` ve `API_URL` yerel iken çalışır. İdempotenttir: tekrar çalıştırmak hiçbir şeyi çoğaltmaz.

Kurduğu veri (PLAN fixture'ı, kurgusal):

- Kullanıcı, organizasyon ve mağaza `deneme-tekstil` (durum `active`), vergi sınıfı `kdv10` (KDV %10, fiyatlar
  KDV dahil), kargo bölgesi "Türkiye (yerel tohum)" (düz 49,90 ₺, `yurtici`).
- 3 ürün / 6 varyant yayında (barkod, SKU, fiyat, stok 50). Maliyetler **KDV dahil** (`taxIncluded: true`,
  `taxRateBps: 1000`); #6 (Örme Hırka Lacivert) maliyetsiz.
- Marka profili: açıklama, konular (`pamuklu tişört`, `keten gömlek`, `örme hırka`), rakipler Rakip Marka A
  (`https://rakip-marka-a.example`) ve B.
- Üç ödenmiş vitrin siparişi (kart, iyzico test modu):

| Sipariş | Satırlar | Özellik | Atıf |
|---|---|---|---|
| A | 2× Tişört M/Beyaz, 1× Gömlek M/Bej | — | google / cpc, gclid → `clickChannel: google` |
| B | 1× Gömlek L/Bej, 1× Hırka Gri | `DENEME10` kuponu (%10, satır başına) | instagram / paid_social, fbclid → `meta` |
| C | 2× Tişört L/Beyaz, 1× Hırka Lacivert (maliyetsiz → `totals.cost: null`) | Gönderildi; 1 tişört iade alındı ve para iadesi yapıldı (`partially_refunded`) | newsletter / email |

Yollar:

- HTTP (tacir oturumu, Bearer): kayıt/giriş, organizasyon, mağaza, vergi sınıfı, ürünler, marka profili, kargo
  bölgesi, gönderi, iade talebi ve teslim alma.
- Servis katmanı (yalnız yerel DB, aynı kullanıcının izinleriyle): (1) maliyetlerin KDV bilgisi — ürün API'si
  yalnız tutar alıyor; (2) sepet → ödeme: gerçek `checkout` kodu çalışır, iyzico bağdaştırıcısının yerine ağa
  çıkmayan yerel bir test sağlayıcısı ve tek kuponluk yerel bir indirim motoru verilir (altyapi'de kampanya
  motoru henüz yok); (3) kart ücreti — hiçbir sağlayıcı bağdaştırıcısı `payment_transactions.fee_amount`
  yazmıyor, tohum satış işlemine sabit bir fixture kuralıyla (%2,99 + 0,25 ₺) yazar; (4) para iadesi — API
  üzerinden iyzico'yu çağırırdı.
- Ödeme bağlantısı (iyzico, `test`, sahte anahtarlar) iş bitince **devre dışı** bırakılır: yerel vitrinde
  gerçek ödeme açılmaz (bilinçli). Kâr koruması bu yüzden sağlayıcıyı `unknown` gönderir.

**Hermetik test hesabı** (uçtan uca testler her koşuda yeni hesap açar): aynı fixture yeni bir kullanıcı /
organizasyon / mağazaya yüklenir; parola ortamdan gelir (argv'ye yazılmaz), `kimlikler.env`'e dokunulmaz ve son
satır makinece okunur:

```bash
cd apps/api && ALTYAPI_TOHUM_PAROLA=<≥12 karakter> node --env-file=../../.env --import tsx \
  ../../tools/ekosistem/tohum-altyapi.ts --email e2e-123@altyapi.local --slug e2e-123
# … TOHUM_SONUC {"email","userId","organizationId","organizationSlug","storeId","storeSlug"}
```

`--email` yalnız `.local` alan adlı olabilir; paylaşılan hesabın e-postası ya da `deneme-tekstil` slug'ı test hesabı
için reddedilir. Argümansız çalıştırma eskisi gibi paylaşılan fixture hesabını günceller. altyapi'de hesap/mağaza
silme ucu olmadığından test mağazaları yerel DB'de kalır (slug `e2e-…`).

Sonunda sözleşme §7.2/§7.3 dışa aktarımını (bağlı bir eşin göreceği yanıt) okuyup doğrular; beklenen sayılar fixture
listelerinden türetilir. Örnek çıktı:

```
  A #1001 confirmed/paid toplam 194960 indirim 0 iade 0 maliyet 78000 kart ücreti 5854 · İzmir · google/cpc (google)
  B #1002 confirmed/paid toplam 112972 indirim 11998 iade 0 maliyet 93000 kart ücreti 3403 · İstanbul · instagram/paid_social (meta)
  C #1003 fulfilled/partially_refunded toplam 134960 indirim 0 iade 49990 maliyet null kart ücreti 4060 · Ankara · newsletter/email
```

Kârmatik ve Yanıt tohumları kendi depolarındadır (`yerel.sh tohum karmatik|yanit|hepsi` onları aynı
bekçilerin arkasında çağırır). Kârmatik'inki: `karmatikdev/docs/EKOSISTEM-YEREL.md` §4.

## 7. Bağlantıları elle kurma

Önce `yerel.sh up` ve üç tohum. Tarayıcıda `localhost` kullan (bkz. §9.1). Kapsamlar sözleşme §3'tekilerdir;
`costs:read`, `orders:read` (altyapi verir) ve `profit:read` (Kârmatik verir) **ayrı ayrı işaretlenmeden
verilmez**. `profit:read` olmadan altyapi kârlılık ve uyarı çekmez.

**altyapi ↔ Kârmatik** (altyapi kod verir):

1. `http://localhost:3000/login` → `ALTYAPI_EMAIL` / `ALTYAPI_PASSWORD`.
2. `http://localhost:3000/o/deneme-tekstil/deneme-tekstil/apps/ekosistem` → Kârmatik → **Kod oluştur**.
   `Maliyetler (costs:read)` ve `Siparişler (orders:read)` kutularını işaretle → `ek1_a_…` kodu (10 dk).
3. `http://localhost:3999/auth` → `KARMATIK_EMAIL` / `KARMATIK_PASSWORD` → `http://localhost:3999/ekosistem`
   (Labs; dev modda açık) → altyapi → kodu gir; verilen kapsamlarda `profit:read` kutusunu işaretle
   (açık onaylıdır, kendiliğinden işaretli gelmez), mağaza seçimini yap, onayla.
4. altyapi ekosistem sayfasında bağlantı "onay bekliyor" → kimliği ve kapsamları kontrol et → **Onayla**.

Ters yön (Kârmatik kod verir): Kârmatik `/ekosistem`'de kod oluştur (`profit:read` işaretli) → altyapi
ekosistem sayfasında Kârmatik → **Kod gir** → maliyet/sipariş kutularını işaretle → **Onayla ve bağla** →
Kârmatik'te onayla. altyapi inceleme adımında Kârmatik'in vermediği açık onaylı kapsamları ayrıca yazar.

**altyapi ↔ Yanıt**: altyapi ekosistem sayfasında Yanıt → **Kod oluştur** (`ek1_a_…`) →
`http://localhost:3200/login` (`YANIT_EMAIL` / `YANIT_PASSWORD`) → `http://localhost:3200/dashboard/ecosystem`
→ kodu gir, onayla → altyapi'de **Onayla**. (Ya da Yanıt kod verir, altyapi **Kod gir**.)

**Kârmatik ↔ Yanıt**: Kârmatik `/ekosistem` → Yanıt için kod (`ek1_k_…`) → Yanıt `/dashboard/ecosystem` →
kodu gir, onayla → Kârmatik'te onayla. (Ya da Yanıt kod verir, `ek1_y_…`, Kârmatik girer.)

Bağlantıdan sonra:

- altyapi worker'ı zamanlayıcısıyla 60 sn içinde ilk çekmeyi yapar; sonra her kaynak en fazla saatte bir.
  Kârmatik'in `karmatik.profit.updated` / `karmatik.suggestion.created` dürtmeleri 30 sn içinde çekme kurar.
- Kârmatik ve Yanıt tarafında çekme/hesap zamanlanmış işlerle olur: `yerel.sh tick`.
- Durum: altyapi admin → Kârmatik / Yanıt sayfalarındaki "Veri güncelliği" kartı (izin verilmeyen kaynak
  "Bu veri için izin verilmedi" yazar).

## 8. `tick` — zamanlanmış işler

Canlıda bu uçları cron çağırır; yerelde pg_cron yoktur (Kârmatik'in `*_cron.sql` göçleri yerelde
uygulanmaz, çünkü yerel DB canlı hook adresini dürtebilir). `yerel.sh tick` sırasıyla:

| Ürün | Uç | Yetki |
|---|---|---|
| Kârmatik | `POST /api/public/hooks/ekosistem-kar` | `apikey: <CRON_SECRET>` (`src/lib/cron-auth.server.ts`) |
| Kârmatik | `POST /api/public/hooks/ekosistem-cek` | aynı |
| Kârmatik | `POST /api/public/hooks/ekosistem-bakim` | aynı |
| Yanıt | `/api/cron/daily-run` (GET; önce POST denenir, 405 gelirse GET) | `Authorization: Bearer <CRON_SECRET>` |
| Yanıt | `/api/cron/ekosistem` | aynı |
| altyapi | — | worker 60 sn'de bir kendisi çeker |

404 dönen uç "henüz yok" diye geçilir (K1/K2/Y2 birleştirilene kadar beklenen durum).

## 9. Sık sorunlar

### 9.1 `:3000`'de IPv4/IPv6 çakışması
`127.0.0.1:3000`'i başka bir `next-server` (başka bir oturumun deploy'u) tutuyor; altyapi admin IPv6'da
(`[::]:3000`). Tarayıcıda `http://localhost:3000` kullan; komut satırında `curl -6 http://localhost:3000`
ya da `http://[::1]:3000`. `127.0.0.1:3000` yanlış uygulamaya gider. altyapi API tersine yalnız IPv4'te
dinler (`API_HOST=0.0.0.0`); `localhost:4000` yine çalışır (Node ve curl IPv4'e geri düşer).

### 9.2 `altyapi-uygulama` worktree'sinin worker yarışı
İki ağaç aynı veritabanını (`5433/altyapi`) ve Redis önekini (`altyapi:`) kullanır. Kuyruk `FOR UPDATE SKIP
LOCKED` ile işlenir ve zamanlayıcı kilidi ortaktır: işi hangi worker kaparsa o çalıştırır. Worktree'nin
`.env`'inde eş adresleri boş olduğundan kaptığı ekosistem işleri `not_configured` olur: çekme 1 saat ertelenir,
dürtme ve karar teslimleri kalıcı `failed` olur, `ekosistem.pull` işleri kaybolur. Bu yüzden `yerel.sh up`
o ağaçtan çalışan API/worker varken reddeder. Seçenekler: o worker'ı durdur (en basiti); ya da yalnız onu aynı
`EKOSISTEM_*` değerleriyle çalıştır; ya da tam yalıtım (ayrı veritabanı + ayrı `REDIS_KEY_PREFIX`, farklı
`API_PORT`/`WORKER_HEALTH_PORT`).

### 9.3 Kârmatik `.env` canlı tehlikesi
`karmatikdev/.env` CANLI değerler taşır (Supabase URL + service role, Management API PAT). Vite önce `.env`'i,
üstüne `.env.development.local`'ı yükler; ikincisi yoksa ya da bir anahtarı ezmiyorsa dev sunucu canlı
veritabanına **service role ile yazar**. Kurallar: `.env.development.local` olmadan `bun run dev`/`vite dev`
çalıştırma; `.env.local` oluşturma (`vite build` onu da okur); `NODE_ENV=production bun …` çalıştırma (bun o
modda yalnız `.env`'i yükler); `supabase start` ve `supabase migration up` çalıştırma. `yerel.sh` bu dosyayı
her `up`'ta denetler.

### 9.4 Yanıt `packages/db/.env` canlı tehlikesi
Ana checkout'ta `/Users/macos/yanit/packages/db/.env` canlı Supabase'i gösterir. `packages/db` içinde
çalışan komutlar (`pnpm db:seed` — tüm kiracıları siler —, `db:migrate:deploy`, `prisma studio`) açıkça
yerel `DATABASE_URL` ve `DIRECT_URL` verilmezse **canlıya** gider. Worktree'de bu dosya yok; yine de Prisma
komutlarından önce iki değişkeni yerel adresle export et ve `prisma migrate status` çıktısında
`127.0.0.1:5432` gör. `yerel.sh`, üretilmiş Prisma istemcisinin geri düştüğü env dosyasını da denetler.

### 9.5 Diğerleri
- **Port dolu:** `yerel.sh status` portu tutan süreci gösterir. Kârmatik'in `scripts/ekosistem-e2e.ts`
  betiği 3999'u kendi `Bun.serve`'üyle açar: önce `yerel.sh down karmatik`.
- **Anahtar değişimi:** Kârmatik `EKOSISTEM_SECRET_KEY`, Yanıt `CONFIG_ENCRYPTION_KEY`/`JWT_SECRET`, altyapi
  `LOCAL_MASTER_KEY` değişirse kayıtlı bağlantı anahtarları çözülemez; bağlantıyı kaldırıp yeniden kur.
- **Worker log'unda `DELETE … peer call failed`:** eski (e2e'den kalma, kaldırılmış) bağlantıların silme
  teslimi; eş kapalıyken 72 saat boyunca yeniden denenir, zararsızdır.
- **Kâr/uyarı gelmiyor:** bağlantı kartında "Bu mağaza Kârmatik'ten okur" listesinde `profit:read` var mı bak.
  Yoksa Kârmatik'te yeni kod oluştururken işaretle.
- **Yerel vitrinde ödeme açılmıyor:** tohumun ödeme bağlantısı bilinçli olarak devre dışıdır (sahte anahtar).
- **Log'lar renkli:** altyapi günlükçüsü her zaman renklendirir; `yerel.sh logs` renk kodlarını ayıklar.

## 10. Uçtan uca test: altyapi ↔ Yanıt (`e2e-altyapi-yanit.ts`)

Gerçek süreçlere karşı (altyapi API + worker, Yanıt next dev); sahte eş yok.

```bash
tools/ekosistem/yerel.sh up altyapi-api altyapi-worker yanit
tools/ekosistem/yerel.sh test      # ya da: cd apps/api && node --env-file=../../.env --import tsx ../../tools/ekosistem/e2e-altyapi-yanit.ts
tools/ekosistem/yerel.sh down
```

- **Hermetik:** her koşu yeni bir altyapi hesabı/mağazası (`e1-…`, `tohum-altyapi.ts --email/--slug`) ve yeni bir
  Yanıt BRAND kiracısı (`ekosistem-yerel-tohum.ts --email/--kiraci`) açar; paylaşılan fixture hesaplarına dokunmaz.
  Bağlantılar senaryo içinde kaldırılır (kaldırma da sınanır), Yanıt kiracısı sonda hesap silme ucuyla silinir
  (`E2E_KORU=1` bırakır). altyapi'de silme ucu olmadığından test mağazası yerel DB'de kalır.
- **A** altyapi kod verir → Yanıt kabul/onay → altyapi onay → iki tarafta active; Yanıt'ın katalog eşitleme
  tetikleyicisiyle katalog (ürün kimliği, başlık, URL, KDV dahil fiyat min/maks, stok, ilk varyantın barkod/SKU'su,
  varyant sayısı) altyapi'nin sunduğuyla birebir; ürün yayından kaldırılıp geri alınınca §10 dürtmesiyle Yanıt'a
  yansır; worker (`ekosistem.pull-link` işi) §9.1–9.4'ü çeker, `yanit_visibility_snapshots` (7/30), `yanit_gaps`,
  `yanit_opportunities`, `yanit_citations` Yanıt'ın imzalı uçlarının o anda sunduğu değerlerle birebir; Yanıt'ın
  `max-age`'i saklanır ve sonraki çekme saatlik vadeden önce değildir; fırsattan taslak sayfa (yayınlanmaz, ikinci
  istek aynı taslağı döner); Yanıt tarafından kaldırma → altyapi `peer_deleted`, katalog bağlantısı kesilir.
- **B** Yanıt kod verir → altyapi kabul/onay → Yanıt onay → active; katalog yeniden bağlanır ve eşitlenir, worker
  çeker; altyapi'den kaldırma → worker'ın DELETE teslimiyle Yanıt'ta `revoked` (`peer`), kaldırılmış bağlantıya imzalı
  istek iki yönde `401 link_invalid`, Yanıt'taki altyapi kataloğu `DISCONNECTED` ve boş.
- **C** yanlış `Ekosistem-Product` (iki yönde `401 signature_invalid`), nonce tekrarı (iki yönde `401 replay`),
  bekleyen bağlantıda veri ucu (`pending` ve `awaiting_approval`, iki yönde `409 link_pending`).
- Beklentiler sabit sayı değildir: Yanıt'ın imzalı uçlarının sunduğu değerden ya da Yanıt tohumunun fixture'dan
  hesaplayıp yazdığı "beklenen" satırlarından türetilir. Yanıt'a yalnız HTTP gider; tek istisna, hiçbir uçta olmayan
  katalog tanımlayıcıları (`CatalogProduct.identifiers`) için yerel Yanıt DB'sine salt okunur psql sorgusu.
- Hız sınırları gevşetilmez: koşu başına her yönde 1 claim ve 1 Yanıt girişi (IP başına 10/15 dk).
