# altyapi.io

Multi-tenant, AI-native e-ticaret altyapısı. Ürün ve mimari kararlar için
[`altyapi_io_master_build_prompt.md`](./altyapi_io_master_build_prompt.md) dosyasına bakın.

## Yapı

```text
apps/
  api/            Fastify commerce API (OpenAPI: /docs)
  worker/         Outbox publisher, queue consumer'ları, scheduler
  edge-router/    Cloudflare Worker: Host → mağaza çözümleme, yönlendirme, sürümlü HTML cache
  storefront/     Next.js çok kiracılı storefront (tek deployment, tüm mağazalar)
packages/
  config/         Typed environment şemaları (Zod)
  observability/  Logger, correlation context, tracing
  commerce-core/  Shared kernel: hatalar, ID, money (minor unit), pagination
  database/       Drizzle schema, migrations, tenant/platform transaction yardımcıları, RLS
  auth/           Kullanıcı, oturum, argon2id, rol/izin matrisi
  tenancy/        Organization, store, member servisleri ve StoreContext
  events/         Transactional outbox ve event kataloğu
  audit/          Redaksiyonlu audit log yazıcısı
  domains/        Custom domain yaşam döngüsü, Cloudflare for SaaS, edge routing
  storage/        R2 depolama, presigned upload, asset işleme, görsel preset'leri
  theme-engine/   Section registry, tema token'ları, sayfalar, Draft → Preview → Publish, rollback
  marketing/      Pazarlama iletişim izinleri, consent kayıtları (KVKK/İYS)
  catalog/        Ürün, varyant, seçenek, medya, koleksiyon (manuel/otomatik), kategori, vergi sınıfı, arama
  inventory/      Stok ledger'ı, lokasyonlar, rezervasyon, transfer
  pricing/        Fiyat listeleri, deterministik fiyat çözümleyici, maliyet geçmişi
  secrets/        KMS uyumlu envelope encryption (AWS KMS / yerel geliştirme anahtarı)
  payments/       Ödeme sağlayıcı sözleşmesi, şifreli bağlantılar, ödeme durum makinesi, olay kaydı
  payment-paytr/  PayTR iFrame API adaptörü
  payment-iyzico/ iyzico Checkout Form adaptörü
  orders/         Sipariş, durum makinesi, fulfillment, kargo adaptör sözleşmesi, iade, refund
  checkout/       Sepet, kargo, vergi, checkout orkestrasyonu, ödeme bildirimleri
  integrations/   Entegratör, pazaryeri ve besleme bağlantıları, veri sahipliği
  ekosistem/      Kârmatik ve Yanıt ile imzalı köprü (docs/ekosistem/v1.md)
```

Diğer uygulama ve paketler (admin, storefront, worker, edge-router, catalog, payments, …)
master build prompt'taki uygulama sırasına göre eklenir.

## Yerel geliştirme

Gereksinimler: Node.js 22+, pnpm 10, PostgreSQL 16, Redis/Valkey.

```bash
cp .env.example .env
docker compose up -d          # postgres + valkey (veya yerel kurulum)
pnpm install
pnpm db:migrate
pnpm --filter @altyapi/api dev
pnpm --filter @altyapi/worker dev
pnpm --filter @altyapi/storefront dev   # http://localhost:3001 (STOREFRONT_DEV_HOST mağazasını gösterir)
```

API: http://localhost:4000 — OpenAPI UI: http://localhost:4000/docs

### Veritabanı

- Şema değişikliği sonrası: `pnpm db:generate` (migrations/ altına SQL üretir), ardından `pnpm db:migrate`.
- Tenant verisine erişim yalnızca `withTenantTx(db, { organizationId, storeId }, fn)` ile yapılır.
  Platform seviyesindeki sistem akışları (`hostname` çözümleme, scheduler) `withPlatformTx` kullanır.
- RLS ikinci savunma katmanıdır. Production'da API/worker `altyapi_app` rolünü üstlenen bir
  kullanıcı ile bağlanmalıdır (migration'ları çalıştıran owner rolü RLS'i bypass eder).

### Kimlik ve yetki

- Merchant/staff kullanıcıları `users`; storefront müşterileri ayrı tablo ve oturum sistemi kullanır.
- Roller: organization_owner, store_admin, catalog_manager, order_manager, marketing_manager, analyst, developer.
- Rol ataması organizasyon geneli (`store_id = null`) veya mağaza bazlı olabilir.
- İzinler `resource:action` biçimindedir (`packages/auth/src/permissions.ts`).
- Cookie ile kimliği doğrulanmış state-changing istekler yalnızca izinli origin'lerden kabul edilir.

### Domain ve yayınlama

- Her mağaza `{slug}.altyapi.store` adresini aktif ve canonical olarak alır.
- Custom domain: `POST /v1/organizations/:org/stores/:store/domains`. Girilen apex (`ornek.com`)
  için `www.ornek.com` mağazaya bağlanır, apex ise www'ye 301 yönlendirilir.
- Durumlar: `pending → awaiting_dns → validating → certificate_pending → active` (+ `failed`, `moved`, `disabled`).
  Worker, due olan domainleri Cloudflare Custom Hostname API üzerinden kontrol eder (backoff ile, 7 gün pencere).
- Canonical domain seçildiğinde diğer hostname'ler canonical'a 301 yönlenir.
- Routing değişiklikleri `stores.routing_version` artırır ve `domain.routing_changed` event'i üretir;
  worker bu projeksiyonu Workers KV'ye yazar. KV yalnızca hız katmanıdır, kaynak PostgreSQL'dir.
- Edge router, storefront'a `x-altyapi-*` metadata header'larını HMAC imzasıyla iletir.

### Event ve job altyapısı

- Servisler state değişikliğiyle aynı transaction'da `outbox_events` tablosuna yazar.
- Worker outbox'ı kuyruğa taşır (`QUEUE_DRIVER=postgres` yerel, `sqs` AWS).
- Consumer'lar `(consumer, message_id)` üzerinden idempotenttir; retry exponential backoff + jitter,
  `QUEUE_MAX_ATTEMPTS` sonrası dead-letter.

### Medya (R2)

1. `POST …/assets/uploads` — tür, boyut, kota ve yetki kontrolü; 10 dk geçerli presigned PUT URL döner.
2. Tarayıcı dosyayı doğrudan R2'ye yükler (bucket CORS kuralı gerekir, bkz. `infra/terraform`).
3. `POST …/assets/:id/complete` — nesnenin varlığı, boyutu ve content-type'ı doğrulanır.
4. Worker SHA-256'yı ve görsel ölçülerini doğrular; asset `ready` olur, uyuşmazlıkta nesne silinir.

Object key: `stores/{store_id}/assets/{asset_id}/{content_hash}.{ext}`. Görsel boyutları
Cloudflare Image Transformations ile üretilir (`thumbnail`, `card`, `product`, `zoom`, `hero-mobile`,
`hero-desktop`, `social`). Silme soft-delete'tir; 30 gün sonra referansı olmayan nesneler temizlenir.

### Tema ve sayfa motoru

- Her mağaza için ayrı build yoktur; storefront aktif publication'ı okuyarak render eder.
- Section tanımları `packages/theme-engine/src/sections/definitions.ts` içindedir (Zod props, blocks,
  izinli sayfa tipleri, content binding, renderer id). Worker açılışta bunları `section_definitions`
  tablosuna senkronlar; editör JSON Schema'yı `GET /v1/section-definitions` ile alır.
- Taslaklar (`themes.draft_*`, `pages.draft_*`) optimistic concurrency ile güncellenir (`expectedRevision`).
- Publish immutable `theme_versions` / `page_versions` ve yeni bir `publications` kaydı oluşturur;
  `storefront_state.active_publication_id` aynı transaction içinde değişir ve `stores.content_version` artar.
- Rollback eski publication'ın sürümlerini kullanan yeni bir publication oluşturur.
- Sayfa handle'ı değişince eski URL için otomatik 301 ve `slug_history` kaydı oluşur.
- Landing page'ler zamanlanabilir (`publishAt` / `unpublishAt`); worker bunları yayınlar ya da kaldırır.
- Önizleme: `POST …/storefront/preview-token`, 1 saat geçerli imzalı token.
- Tema ayarları (`PUT …/storefront/theme`) tam doküman olarak gönderilir; eksik alanlar varsayılana döner.

### Katalog, stok ve fiyat

- Ürün tek bir aggregate olarak kaydedilir: çeviriler (locale bazlı handle), seçenekler, varyantlar,
  medya, etiketler, koleksiyonlar ve kanal görünürlüğü. Yayınlanmış ürünün handle'ı değişince 301 oluşur.
- Otomatik koleksiyon kuralları SQL'e çevrilir; worker ürün, fiyat ve stok olaylarında üyeliği günceller.
- Arama PostgreSQL `tsvector` ile yapılır; Türkçe karakterler normalize edilir, SKU/barkod ayrıca indekslenir.
- Stok ledger'a yazılır (`initial_stock`, `manual_adjustment`, `order_reserved`, `reservation_released`,
  `order_confirmed`, `return_received`, `transfer_in`, `transfer_out`); `inventory_levels` ledger'ın
  aynı transaction'da güncellenen projeksiyonudur. `available = on_hand - reserved`.
- Rezervasyonlarda satırlar sabit sırayla kilitlenir; süresi dolan rezervasyonları worker serbest bırakır.
- Fiyatlar tamsayı minor unit ve ISO para birimiyle `money_amounts` tablosunda tutulur. Uygulanabilir
  listeler `priority → tür → id` sırasıyla seçilir (kanal, müşteri grubu ve zaman penceresi kısıtları).
  Kampanya indirimleri fiyat çözümleyicide değil, sepet üzerinde kampanya motorunda uygulanır.

### Ürün içe aktarma (CSV / Excel / XML)

1. Dosya `purpose: "import"` ile yüklenir (`imports-temporary` bucket).
2. `POST …/imports` iş oluşturur; worker örnek satırları okur, kolonları bulur ve TR/EN başlık
   eşanlamlılarıyla otomatik eşleme önerir (`GET /v1/import-fields`).
3. `PUT …/imports/:id/mapping` eşlemeyi kaydeder (istenirse profil olarak), önizleme ve satır hatalarını döner.
4. `POST …/imports/:id/start` işlemeyi başlatır. Worker dosyayı `import_rows` tablosuna aktarır,
   sonra ürün gruplarını 45 sn'lik parçalar halinde işler ve kaldığı yerden devam eder.
5. Mevcut ürünler SKU / external ref / handle ile eşleşip güncellenir; stok mutlak değere ledger ile çekilir.
6. Hatalı satırlar `import_row_errors`'a yazılır, bitişte `exports-temporary`'ye hata CSV'si üretilir.

Fiyatlar `1.299,90`, `1,299.90`, `129,9`, `₺129,90` biçimlerinde kabul edilir (float kullanılmaz).
XML için `xmlItemPath` (ör. `Urunler.Urun`) ve varyantlar için `xmlVariantPath` verilir.
Görsel URL'leri yalnızca https ve genel IP adreslerinden indirilir (SSRF koruması, bağlantı anında IP doğrulama).

Yerel geliştirmede R2 yerine MinIO kullanılabilir: `docker compose up -d minio` ve `R2_ENDPOINT=http://localhost:9000`.

### Storefront

- Tek Next.js uygulaması tüm mağazaları sunar. Edge router `x-altyapi-*` başlıklarını HMAC ile imzalar;
  `proxy.ts` imzayı doğrular ve iç `x-sf-*` başlıklarını her istekte yeniden kurar (istemci enjekte edemez).
- Storefront veritabanına bağlanmaz. Veriyi API'deki Storefront API'den (`/storefront/v1/site`, `/route`,
  `/sitemap`) iç anahtarla (`STOREFRONT_API_SECRET`) alır. Route çözümleme; sayfa section'larını, bağlı ürün,
  koleksiyon ve listeleme verisini, SEO alanlarını, hreflang alternatiflerini ve breadcrumb'ı tek yanıtta döner.
- URL'ler: `/`, `/products/:handle`, `/collections/:handle` (+ `all`), `/pages/:handle`, `/search`, `/cart`;
  varsayılan olmayan diller `/en/...` önekiyle sunulur. Eski handle'lar 301 ile yönlenir.
- SEO/GEO: sunucu tarafı metadata, canonical (filtre/sıralama hariç, `?page=N` korunur), hreflang + x-default,
  `robots.txt`, sitemap index + parçalı sitemap'ler, Product/Offer, BreadcrumbList, ItemList, FAQPage,
  Organization ve WebSite JSON-LD, Open Graph.
- Cache: Storefront API yanıtları içerik sürümünü içeren URL'lerle önbelleklenir. Edge router HTML'i
  `content_version` içeren anahtarla Cloudflare cache'inde tutar; yayınlama anahtarı değiştirir.
  Sepet, hesap, ödeme, arama ve önizleme sayfaları paylaşılan cache'e girmez.
- Önizleme: `?preview_token=…` ile açılır (httpOnly cookie), `?exit_preview=1` ile kapanır; önizleme hiç önbelleklenmez.
- Hedefleme (cihaz, rota, UTM, referrer, segment) istemci tarafında değerlendirilir; zamanlama sunucu tarafındadır.

### Sepet, checkout ve ödeme

- Sepet tarayıcıda bir token ile tutulur (DB'de yalnızca SHA-256). Fiyat, stok, kampanya, kargo ve KDV her
  hesaplamada sunucuda yeniden okunur; istemciden gelen fiyat kullanılmaz.
- Checkout: sepet doğrulanır → `awaiting_payment` sipariş (mağaza bazlı sıra numarası) → 30 dk stok
  rezervasyonu → ödeme denemesi → sağlayıcı oturumu (PayTR iFrame / iyzico Checkout Form).
  Değişmemiş bir sepette tekrar checkout aynı oturumu döner; sepet değişirse bekleyen sipariş iptal edilir.
- Ödeme sonucu yalnızca doğrulanmış sağlayıcı bildirimiyle kesinleşir (dönüş URL'si sonuç kabul edilmez):
  - PayTR: `POST /payments/v1/paytr/notify/:connectionId` — HMAC doğrulaması, cevap `OK`.
    Bu URL mağaza sahibinin PayTR panelindeki "Bildirim URL" alanına girilir (ödeme ayarlarında gösterilir).
  - iyzico: `POST /payments/v1/iyzico/callback/:attemptId` (tarayıcı) ve
    `POST /payments/v1/iyzico/webhook/:connectionId` (X-IYZ-SIGNATURE-V3); sonuç her zaman sunucudan
    sunucuya retrieve çağrısıyla alınır.
- Olaylar `payment_events` tablosuna sağlayıcı olay kimliği ve payload hash'iyle bir kez yazılır; doğrulanmamış
  payload'lar ayrı anahtarla saklanır ve gerçek olayı engelleyemez.
- Sipariş ve ödeme durum makineleri ayrıdır. Başarılı ödeme: sipariş `confirmed`, rezervasyon → `order_confirmed`
  ledger kaydı, sepet `completed`. İptal edilen siparişe gelen ödeme `payment_after_cancel` etiketiyle işaretlenir.
- Worker: bildirimi gelmeyen denemeler için sağlayıcıdan durum sorgular; 45 dk ödenmeyen siparişleri
  mutabakattan sonra iptal edip stoğu serbest bırakır.
- İade: satır/kargo/ek tutar bazında, idempotency anahtarıyla; önce kayıt, sonra sağlayıcı çağrısı, sonra sonuç.
  PayTR tutar bazlı, iyzico kalem (paymentTransactionId) bazlı iade eder.
- Sağlayıcı kimlik bilgileri bağlanırken sağlayıcıyla doğrulanır, AES-256-GCM ile şifrelenir; veri anahtarı
  KMS (üretim) veya `LOCAL_MASTER_KEY` (yalnızca geliştirme) ile sarılır. Kart verisi platformda tutulmaz.
- Kargo: bölge (ülke/il) + ücret tipleri (sabit, ağırlık, sepet tutarı, ücretsiz kargo eşiği). Taşıyıcı
  adaptör sözleşmesi (`createShipment`, `getLabel`, `track`, `cancel`) ve TR kargo firmaları için takip linkleri.

### Tasarım sınırları ve geri alma

- Mağaza sahibi, ekibi ve AI yalnızca storefront tasarımını ve içeriğini (tema token'ları, section'lar, sayfalar,
  menüler, yönlendirmeler) değiştirebilir. Backend, admin paneli ve checkout akışı tema/editör ile değiştirilemez.
- Korunan katmanlar tasarımın parçası değildir: pixel ve analytics kodları, consent (çerez izni) davranışı, checkout,
  sepet ve hesap sayfaları. Tema yayınlama veya rollback bunlara dokunmaz.
- Section içeriğinde kod çalıştırılamaz: zengin metin allow-list ile temizlenir; herhangi bir prop'ta
  `<script>`, `<iframe>`, `javascript:`, HTML event attribute vb. bulunursa kayıt reddedilir. "Özel kod" section'ı yoktur.
- Sistem section'ları kilitlidir (`requiredIn`): header ve footer global alanda; `product-main`, `collection-main`,
  `cart-main`, `search-main` ve `not-found-main` kendi şablonlarında zorunludur, silinemez ve kapatılamaz.
- `/checkout`, `/cart`, `/account`, `/api`, `robots.txt`, `sitemap*` gibi sistem yolları yönlendirilemez.
- Geri alma: tema, sayfa ve menü taslaklarının her kaydı `draft_revisions` tablosunda revizyon olarak tutulur
  (kim/hangi AI ajanı/ne zaman). `…/storefront/history/:resource/:id` altında `undo`, `redo` ve `restore`
  uç noktaları bulunur; revizyonlar ağaç yapısındadır (geri alınıp düzenlenen dal kaybolmaz, restore ile dönülebilir).
  Yayındaki site yalnızca publish ile değişir; yayınlanmış sürümler için ayrıca publication rollback vardır.

### Tracking, pixel ve çerez izni (korunan katman)

- Pixel/analytics yapılandırması `tracking_configs` tablosundadır; tema, sayfa ve section'lardan tamamen ayrıdır.
  Tasarım kaydı, publish, rollback veya undo/redo bu katmana dokunamaz. Yazma yetkisi yalnızca `tracking:manage`
  (organization_owner, store_admin, marketing_manager) izninde; AI ajanları hangi yetkiye sahip olursa olsun değiştiremez.
- Admin API: `GET/PUT /v1/organizations/:orgId/stores/:storeId/tracking` (iyimser kilit: `expectedVersion`),
  `GET …/tracking/deliveries` (sunucu taraflı dönüşüm gönderim geçmişi). Kimlikler format doğrulamasından geçer
  (GTM-, G-, AW-, Meta pixel ID, TikTok pixel kodu); sunucu anahtarları (Meta CAPI token, TikTok access token,
  GA4 API secret) KMS ile şifrelenir, API'den asla geri okunmaz ve denetim kaydına yazılmaz.
- `renewConsent: true` politika sürümünü artırır; tüm ziyaretçilere izin yeniden sorulur.
- Storefront: çerez banner'ı ve tracking katmanı layout'ta, section'ların dışında render edilir. Script'ler yalnızca
  izinden sonra yüklenir: GA4 → analitik izni; Meta, TikTok, Google Ads → pazarlama izni; GTM → herhangi biri
  (Google Consent Mode v2 sinyalleriyle). İzin geri çekilirse sayfa yeniden yüklenir. Seçimler `consent_records`
  tablosuna kanıt olarak (metin, politika sürümü, IP hash'i) yazılır. Önizlemede tracking çalışmaz.
- Sunucu taraflı dönüşümler: `order.confirmed` olayında worker Meta Conversions API, TikTok Events API ve GA4
  Measurement Protocol'e satın alma gönderir. Tarayıcı pixel'i ile aynı `event_id` (`purchase:{orderId}`)
  kullanıldığı için platformlar satın almayı bir kez sayar. E-posta/telefon SHA-256 ile hash'lenir; pazarlama izni
  yoksa Meta/TikTok'a, analitik izni veya GA client id yoksa GA4'e gönderilmez. Her hedef `conversion_deliveries`
  tablosunda bir kez kaydedilir; geçici hatalar (5xx/429) kuyrukta yeniden denenir.
- Env: `META_GRAPH_API_VERSION` (varsayılan `v24.0`).

### Entegratör ve pazaryeri bağlantıları

Araştırma dosyasındaki bulgulara göre kuruldu: incelenen entegratörlerin hiçbirinde webhook yok, bu yüzden tüm
bağlantılar periyodik sorgu (polling) ile çalışır; API'nin izin verdiği yerde imleçle artımlı okunur.

- **Üç erişim yolu**: entegratör API'si (okuma + yazma), pazaryerine doğrudan bağlantı (yalnızca okuma),
  entegratörün XML/CSV/Excel dışa aktarımı (yalnızca okuma).
- **Hazır bağlayıcılar** (`packages/integrations`):
  - StockMount — resmi kılavuz v1.6: DoLogin/ApiCode (00006'da yeniden giriş), mağaza × durum bazında `GetSales`
    (LastModificationTime ile artımlı), `GetProducts` (100/sayfa), ürün koduyla stok/fiyat yazma.
  - Dopigo — panel girişiyle token, sipariş ve ürün listeleri (endpoint başına 2 istek/sn). Yazma kapalı:
    stok/fiyat alanları Dopigo tarafından teyit edilene kadar değişiklik Dopigo panelinde yapılır.
  - Trendyol — siparişler `orders/stream` (son değişiklik tarihi, 14 günlük pencereler), stok/fiyat
    `inventory-and-price`. Hepsiburada — resmi OpenAPI: açık/iptal kalemler, kargolandı/teslim edildi paketleri,
    ilanlar. Pazaryerleri yalnızca okunur.
  - XML/CSV/Excel beslemesi — ürün içe aktarma ayrıştırıcılarıyla; URL şifreli saklanır, SSRF korumalı indirilir.
- **Doküman bekleyenler**: Entegra (Postman dokümanı bu ortamdan erişilemedi), n11 REST, Sopyo, PraPazar. Listelenir
  ama bağlanamaz; tahminle uç nokta yazılmadı. Bu müşteriler pazaryeri veya besleme bağlayıcısını kullanır.
- **Veri sahipliği**: stok, fiyat, içerik ve sipariş karşılama için sahip sistem seçilir (`…/integrations/ownership`).
  Okuma her kaynaktan yapılır; yazma yalnızca sahip üzerinden: altyapi ise altyapi'de, yazma destekleyen entegratör
  ise entegratör API'siyle (ardından altyapi'ye yansıtılır), pazaryeri/besleme/ERP ise hiçbir şey yazılmaz ve
  "değişikliği X üzerinde yapın" önerisi döner. Pazaryeri fiyat sahibi olamaz (komisyonlu fiyat).
- **Uyumsuzluk sinyalleri**: SKU (sonra barkod) eşleşmesiyle stok ve fiyat karşılaştırılır; farklılık düzeltilmez,
  sahip değeri işaretlenerek `…/integrations/discrepancies` altında gösterilir. Stok sahibi bir bağlantıysa
  altyapi stoğu ona göre güncellenir.
- **Durum normalizasyonu**: her kanalın ham durumu saklanır ve ortak yaşam döngüsüne çevrilir
  (`pending_payment … delivered, cancelled, returned`).
- **KVKK**: dış siparişlerde TCKN, vergi no, telefon, e-posta ve açık adres saklanmaz; yalnızca ad, il, ilçe.
- **Güvenlik**: kimlik bilgileri ve oturum token'ları KMS zarf şifrelemesiyle saklanır, API'den dönmez, denetim
  kaydına yazılmaz. Kimlik hatasında bağlantı `error` durumuna geçer ve sorgu durur.
- **Çalışma**: worker her 15 sn'de vadesi gelen bağlantıları kiralar (SKIP LOCKED) ve `integration.sync` işi
  kuyruğa atar; sayfa bütçesi dolarsa imleçten devam eder; Redis tabanlı bağlantı başına hız sınırı uygulanır.
- İzin: `integrations:read` / `integrations:manage`; stok/fiyat yazımı ayrıca `inventory:write` / `pricing:write`.

### Ekosistem köprüsü (Kârmatik ve Yanıt)

Sözleşme: [`docs/ekosistem/v1.md`](./docs/ekosistem/v1.md). Veritabanı paylaşılmaz; her ürün veriyi karşı tarafın
imzalı `/ekosistem/v1` uçlarından çeker, değişiklikleri hızlı fark etmek için dürtme (push) alır. Kod `packages/ekosistem`
altındadır; API `apps/api/src/modules/ekosistem*.ts`, worker `apps/worker/src/handlers/ekosistem.ts`.

- **İmza ve açılış denetimi**: HMAC-SHA256 (§5); API ve worker açılışta sözleşmenin test vektörlerini (V1–V5, para
  vektörleri) çalıştırır, tutmazsa süreç başlamaz. Eş adresleri yalnız ortam haritasından okunur (https; `http` ve
  localhost yalnız `APP_ENV=local`). Yönlendirme izlenmez, 10 sn zaman aşımı (`profit/quote` 1,5 sn), yanıt ≤ 5 MB,
  bağlantı başına devre kesici (art arda 5 hata → 60 sn).
- **Bağlantı** (§4): mağaza kod üretir (`POST …/ekosistem/codes`) ya da eşin kodunu girer (`POST …/ekosistem/links/accept`,
  ardından `…/links/:id/confirm`); kodu üreten taraf eş kanıtından sonra `…/links/:id/approve` ile onaylar. Kaldırma
  (`DELETE …/links/:id`) yerelde hemen geçerlidir, eşe `DELETE` 72 saat üstel geri çekilmeyle iletilir. Gizli anahtar
  `packages/secrets` zarf şifrelemesiyle saklanır, API'den dönmez. İzin: `karmatik:manage` / `yanit:manage`.
  `grants` verilmezse §3 varsayılanları `costs:read` ve `orders:read` olmadan verilir; bu ikisi yalnız istekte tek tek
  listelenirse verilir. Anahtar yenilemeyi (`POST /links/:id/rotate`) yalnız mevcut anahtarla imzalı istek başlatır;
  24 saat geçerli eski anahtar yalnız aynı nonce'lu tekrar denemede kabul edilir.
- **Sunulan uçlar** (§7): `brand`, `catalog/products`, `orders`, `content` (+ `links/*`, `events`); kapsam denetimli,
  ham gövde imzalı, bağlantı başına hız sınırı. Marka profili: `GET/PUT …/ekosistem/brand-profile`.
- **Tüketim** (§7.5): worker her dakika vadesi gelen etkin bağlantıları kiralar (SKIP LOCKED) ve `ekosistem.pull-link`
  işi kuyruğa atar. Her kaynak eşin verdiği kapsam varken ve en fazla saatte bir (ya da `Cache-Control: max-age`)
  çekilir: Kârmatik `profit/variants`, `pricing/suggestions`, `competitors/prices`, `alerts`; Yanıt
  `visibility/summary` (7 ve 30 gün), `visibility/gaps`, `opportunities`, `citations`. Artımlı uçlar `since = asOf − 10 dk`
  ve imleçle, her sayfa imleciyle birlikte kaydedilerek çekilir; mezar taşları siler; anlık görüntü uçları saklanan
  kümeyi değiştirir. Eş kalemleri yerel varyantlara `sourceRef → barkod → SKU` sırasıyla eşlenir (belirsiz eşleşme
  boş kalır). `409 link_pending` 10 dk sonra, geçici hatalar 5 dk sonra yeniden denenir; en az 10'ar dk arayla 3
  `link_invalid` bağlantıyı `revoked_by_peer` yapar. Kârmatik dürtmeleri (`karmatik.profit.updated`,
  `karmatik.suggestion.created`) ilgili kaynağı 30 sn birleştirilerek hemen çektirir.
- **İç olaylar**: bir kârlılık satırı yeni zarar ederse ya da güvenli indirimi 0'a inerse `profit.margin_breached`;
  Yanıt görünürlüğü önceki anlık görüntüye göre ≥ 1500 bps değişirse `geo.visibility_changed` (outbox).
- **Giden dürtmeler** (§10): ürün, sipariş (yalnız sunulan vitrin siparişleri), iade, sayfa/tema yayını ve marka
  profili değişiklikleri, ilgili okuma kapsamı olan her etkin bağlantı için `ekosistem_deliveries` satırı açar;
  aynı (tür, ref) 30 sn birleştirilir, imzalı ve nonce'lu gönderilir, en fazla 5 deneme (≤ 1 saat geri çekilme),
  bağlantı başına 120/dk. Devre kesici açıkken deneme harcanmaz.
- **Kârmatik ekranları** (`karmatik:read`): `GET …/ekosistem/karmatik/overview` (sayımlar, zarar eden ve ince marjlı
  varyantlar, açık uyarılar, tazelik, devre kesici durumu, kâr koruması politikası), `…/karmatik/variants`,
  `…/karmatik/suggestions`, `…/karmatik/alerts`, `…/karmatik/competitors`.
- **Fiyat önerisi kararı**: `POST …/karmatik/suggestions/:ref/apply` (yalnız bağlı web mağazasının `channel=web`
  önerileri; ek olarak `pricing:write`) fiyatı veri sahipliğine uyan fiyat yazımıyla uygular (sahip başka bir sistemse
  hiçbir şey yazılmaz ve öneri döner), ardından Kârmatik'e idempotent `decision` gönderir; `…/dismiss` reddeder.
  Politika `block` iken uygulanacak fiyat sunucuda da kâr korumasından geçer: taban altı fiyat `campaigns:approve` ve
  `justification` ister, kontrol yapılamazsa `confirmUnchecked: true` gerekir.
  Gönderilemeyen kararlar worker tarafından geri çekilmeyle yeniden denenir.
- **Kâr koruması** (`POST …/karmatik/profit-check`, yönetici eylemi yardımcısı): önerilen indirimli birim fiyatlar
  önce saklanan taban fiyatla, yoksa `profit:quote` ile (1500 ms) karşılaştırılır. Mağaza politikası
  `GET/PUT …/ekosistem/settings` → `profitGuard: block | warn | ignore` (varsayılan `warn`, `stores.settings.ekosistem`).
  `block` kaydı reddettirir (`campaigns:approve` yetkili kullanıcı gerekçe yazarak geçer, denetim kaydı düşer);
  kontrol yapılamazsa `block` bile yalnız uyarır ve onay ister. Müşteri akışlarında asla çağrılmaz. Teklif isteği
  maliyeti yalnız mağaza Kârmatik'e `costs:read`, SKU/barkodu yalnız `catalog:read` verdiyse taşır.
- **Yanıt ekranları** (`yanit:read`): `…/yanit/overview` (7/30 günlük özetler ve değişimler), `…/yanit/gaps`,
  `…/yanit/opportunities`, `…/yanit/citations`. `POST …/yanit/opportunities/:ref/draft` (`content:write`) fırsattan
  tema motoru üzerinden SSS / zengin metin bölümlü **taslak** sayfa oluşturur (kod koruması dahil, revizyon kaynağı
  `yanit`); asla yayınlanmaz. `…/dismiss` fırsatı yerelde kapatır.
- **Veri silme** (§4.4): kaldırmada Kârmatik kârlılık ve uyarı verisi hemen silinir; diğer okuma modelleri en geç
  30 gün içinde silinir. Eş bir kapsamı geri alırsa o kapsamla çekilen veri silinir.
- **Eksikler**: bağlantı oluşturma/kaldırma/kapsam değişikliği `ekosistem.link_changed` outbox olayı ve denetim kaydı
  olarak yazılır, ancak depoda e-posta gönderici olmadığından sahibe e-posta (§4.1) henüz gitmez. Genel fiyat ve
  kampanya kayıt uçları kâr korumasını sunucuda uygulamaz (yalnız öneri uygulama ve `profit-check` yardımcısı).
  Vitrin, Yanıt sensörüyle `PRODUCT_VIEW` (§9.5) göndermez: sensörün site anahtarı v1 bağlantısında taşınmaz.
- **Env**: `EKOSISTEM_PUBLIC_BASE` (varsayılan `API_URL`), `EKOSISTEM_PEER_BASE_KARMATIK`, `EKOSISTEM_PEER_BASE_YANIT`,
  `EKOSISTEM_TRUSTED_PROXY_HOPS` (varsayılan 1).
