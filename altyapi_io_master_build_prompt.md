# altyapi.io — Master Build Prompt

Sen kıdemli bir platform mimarı, staff-level TypeScript geliştiricisi ve ürün mühendisisin. Görevin `altyapi.io` adında production odaklı, multi-tenant ve AI-native bir e-ticaret altyapısını tasarlamak ve kodlamaktır.

Bu proje basit bir mağaza paneli, landing page builder veya mevcut sistemlere bağlanan MCP gateway değildir. Shopify, ikas, Ticimax, IdeaSoft ve WooCommerce sınıfında; mağaza kurma, tema yönetme, ürün satma, ödeme alma, sipariş işleme, kampanya oluşturma ve pazarlama operasyonlarını yürütme yeteneklerine sahip tam kapsamlı bir e-ticaret platformudur.

AI; ürünün kenarında duran chatbot değil, panelle aynı yetenekleri kullanan ana kontrol yüzeylerinden biridir. Kullanıcı mağazasını klasik panelden, altyapi.io içindeki AI komuta alanından veya kendi ChatGPT/Claude hesabını bağlayarak yönetebilmelidir.

## Kesin ürün kararları

- Platform tam kapsamlı bir e-ticaret altyapısıdır.
- Multi-tenant yapı kullanılacaktır.
- Her mağaza için ayrı uygulama veya deployment oluşturulmayacaktır.
- Tek storefront runtime, hostname üzerinden doğru mağazayı çözecektir.
- Supabase kullanılmayacaktır.
- Ana transaction veritabanı Aurora PostgreSQL uyumlu PostgreSQL olacaktır.
- Frontend veritabanına doğrudan erişmeyecektir.
- Cloudflare; DNS, custom domains, SSL, CDN, WAF, edge routing, R2 ve image transformations için kullanılacaktır.
- AWS; commerce servisleri, PostgreSQL, Redis/Valkey, queue, secrets ve worker katmanı için hedef ortamdır.
- Ödeme hizmeti altyapi.io tarafından sunulmayacaktır.
- Mağaza sahibi kendi PayTR veya iyzico hesabını bağlayacaktır.
- Para altyapi.io üzerinden geçmeyecektir.
- Kart numarası, CVV veya son kullanma tarihi altyapi.io sistemlerinde tutulmayacaktır.
- İlk ödeme entegrasyonları PayTR iFrame API ve iyzico Checkout Form olacaktır.
- Cevap.io ve customer-facing AI agent ilk roadmap içinde değildir.
- Müşteri hizmetleri/chatbot ihtiyaçları piyasadaki uygulamalara API ve webhook entegrasyonlarıyla bırakılacaktır.
- Ekosistemin ilk üç ürünü altyapi.io, Kârmatik ve Yanıt'tır.
- Kârmatik kârlılık, maliyet, fiyat, rakip ve pazar zekâsıdır.
- Yanıt GEO ve AI cevap motorlarındaki marka görünürlüğü katmanıdır.
- Test planı, test aşaması ve test dosyaları bu çalışmanın kapsamında değildir.

## Çalışma biçimin

Önce çalışma dizinini incele. Repo mevcutsa kullanılan paket yöneticisini, framework'leri, konvansiyonları, environment yapısını ve mevcut kodu koruyarak ilerle. Repo boşsa aşağıdaki mimariyi temel alarak projeyi sıfırdan başlat.

Karar verirken sürekli soru sorma. Ürün kararları bu promptta verilmiştir. Yalnızca güvenlik, veri kaybı veya geri döndürülmesi çok zor bir karar için gerçekten zorunluysa dur.

Kodda mock, göstermelik fonksiyon, boş handler, sahte entegrasyon, anlamsız placeholder veya çalışmayan TODO bırakma. Harici credential olmadığı için tamamlanamayan yerlerde gerçek adapter interface'i, gerçek request/response mapping'i, environment sözleşmesi ve açık konfigürasyon akışı oluştur; uydurma response döndürme.

Mikroservislerle başlama. Domain sınırları belirgin bir modular monolith ve ayrı background worker kullan. İleride servis ayrıştırılmasına izin veren package sınırları kur.

## Teknoloji tabanı

- TypeScript
- pnpm workspace ve Turborepo
- Next.js latest stable: merchant admin ve storefront
- Fastify: commerce API
- Drizzle ORM: schema ve migrations
- PostgreSQL: Aurora uyumlu source of truth
- Redis/Valkey: cache, rate limit, ephemeral session ve distributed lock
- Cloudflare Worker: hostname çözümleme ve edge routing
- Cloudflare for SaaS: custom hostname ve SSL
- Cloudflare R2: object storage
- Cloudflare Image Transformations: ürün görselleri
- AWS SQS hedefli provider-independent queue interface
- AWS Secrets Manager/KMS uyumlu secret abstraction
- OpenTelemetry ve Sentry uyumlu observability
- Zod: input ve environment doğrulama
- OpenAPI: commerce API dokümantasyonu
- Tailwind CSS ve erişilebilir component sistemi

## Monorepo

```text
apps/
  admin/                 # Merchant paneli
  storefront/            # Multi-tenant storefront renderer
  api/                    # Fastify commerce API
  worker/                 # Queue consumers ve background jobs
  edge-router/            # Cloudflare hostname router

packages/
  auth/
  database/
  tenancy/
  commerce-core/
  catalog/
  inventory/
  pricing/
  campaigns/
  theme-engine/
  domains/
  storage/
  payments/
  payment-paytr/
  payment-iyzico/
  marketing/
  notifications/
  events/
  ai-actions/
  connector-mcp/
  karmatik-bridge/
  yanit-bridge/
  observability/
  config/
  ui/

infra/
  terraform/

docs/
  architecture/
  api/
  integrations/
```

## Multi-tenant model

```text
Account
└── Organization
    ├── Members
    └── Stores
        ├── Domains
        ├── Channels
        ├── Catalog
        ├── Customers
        └── Orders
```

- Tenant sınırı `organization_id` ve `store_id` ile temsil edilsin.
- Repository ve service katmanlarında store context zorunlu olsun.
- Store context olmadan tenant verisine erişen genel query fonksiyonu oluşturma.
- PostgreSQL RLS ikinci savunma katmanı olarak desteklensin.
- Merchant, staff ve storefront customer kimliklerini ayır.
- Rol ve izin sistemi resource/action bazlı olsun.
- AI agent kimliği insan kullanıcısından ayrı kaydedilsin.
- Her işlem principal, organization, store, session ve correlation ID ile loglansın.

Roller:

- organization_owner
- store_admin
- catalog_manager
- order_manager
- marketing_manager
- analyst
- developer

## Domain ve yayınlama

Her mağaza varsayılan adres alsın:

```text
{store_slug}.altyapi.store
```

Custom domain akışı:

1. Kullanıcı domaini panelden ekler.
2. API formatı ve benzersizliği kontrol eder.
3. Cloudflare Custom Hostname API üzerinden hostname oluşturulur.
4. Kullanıcıya CNAME/TXT kayıtları gösterilir.
5. Worker domain durumunu takip eder.
6. SSL aktif olduğunda domain yayına alınır.
7. Canonical domain seçilir.
8. Diğer domainler canonical domaine yönlendirilir.

Durumlar:

```text
pending
awaiting_dns
validating
certificate_pending
active
failed
moved
disabled
```

Edge router `Host` header'ını normalize etsin, domain mapping üzerinden `store_id` bulsun ve storefront'a güvenli metadata ile yönlendirsin. Source of truth PostgreSQL olsun; edge KV/cache yalnızca hız katmanı olsun. Versioned invalidation uygula.

İlk ürün davranışı `www` hostname bağlamak ve apex domaini `www` adresine yönlendirmek olsun.

## Theme ve storefront engine

Her mağaza için ayrı build/deployment üretme. Tek renderer şunları kullansın:

- store configuration
- active theme version
- page route
- section tree
- navigation
- catalog projection
- localization

Modeller:

- theme
- theme_version
- page
- page_version
- section_definition
- section_instance
- navigation
- content_asset
- publication
- redirect

Section definition JSON Schema tabanlı olsun ve type, version, editable props, responsive settings, content bindings, visibility rules ve renderer taşısın.

İlk section seti:

- announcement bar
- header/footer
- hero
- image banner
- slider/carousel
- rich text
- featured collection
- product grid/showcase
- category cards
- image with text
- video
- testimonials
- logo cloud
- newsletter
- FAQ
- countdown
- popup

Editor akışı `Draft → Preview → Publish` olsun. Publish immutable `theme_version` ve `page_version` oluştursun. Canlı mağaza atomik publication pointer ile değişsin ve eski publication'a rollback mümkün olsun.

Storefront SEO/GEO:

- server-rendered metadata
- canonical URLs
- robots.txt
- sitemap index
- Product, Offer, BreadcrumbList, Organization ve WebSite JSON-LD
- Open Graph
- 301/302 redirects
- doğru pagination/filter canonical davranışı
- hreflang
- slug geçmişi

## Storage ve medya

Binary dosyaları PostgreSQL'e yazma.

```text
storefront-public
merchant-private
imports-temporary
exports-temporary
audit-archive
```

Object key:

```text
stores/{store_id}/assets/{asset_id}/{content_hash}.{extension}
```

Upload:

1. API content type, boyut, kota ve yetkiyi doğrular.
2. Kısa ömürlü presigned URL üretir.
3. Browser doğrudan R2'ye yükler.
4. Completion endpoint metadata kaydeder.
5. Worker dosyayı işler.
6. Asset kullanılabilir duruma geçer.

Görsel preset'leri: thumbnail, card, product, zoom, hero-mobile, hero-desktop ve social. Orijinali bir kez sakla; ölçüleri Cloudflare Image Transformations ile üret. Asset silme soft-delete ile başlasın, referansı kalmayan dosyalar retention sonrası temizlensin.

## Catalog

Modeller:

- product ve product_translation
- variant, option, option_value
- collection ve collection_rule
- product_collection
- media, category, tag, vendor
- channel_listing

Alanlar:

- fiziksel/dijital ürün
- SKU/barcode
- varyant seçenekleri
- draft/active/archived
- kanal görünürlüğü
- SEO metadata
- maliyet, satış ve compare-at fiyat
- vergi sınıfı
- ağırlık/ölçüler
- özellikler
- çoklu dil
- zamanlanmış yayın

CSV/Excel/XML import background job olarak çalışsın: kolon eşleme, preview, reusable profile, chunked processing, progress ve satır bazlı hata raporu sağla.

## Inventory

Mutable tek quantity alanı yerine ledger kullan:

```text
initial_stock
manual_adjustment
order_reserved
reservation_released
order_confirmed
return_received
transfer_in
transfer_out
```

Modeller: inventory_item, inventory_location, inventory_ledger_entry, stock_reservation ve stock_transfer.

```text
available = on_hand - reserved
```

Checkout'ta süreli reservation oluştur. Başarısız/süresi dolan ödeme reservation'ı serbest bıraksın. Eş zamanlı satın almada PostgreSQL transaction ve row/version locking kullan.

## Pricing

Fiyatları ürün tablosuna sıkıştırma. price_list, money_amount, customer_group_price, channel_price ve scheduled_price modelleri kur. Para değerlerinde float kullanma; minor unit ve ISO currency kullan.

Price resolver store, channel, currency, segment, quantity ve kampanyayı dikkate alarak deterministik sonuç üretsin.

## Cart ve checkout

Modeller: cart, cart_line, cart_discount, cart_address, cart_shipping_method, cart_tax_line ve cart_total.

Akış:

1. Cart ve fiyatları doğrula.
2. Kampanyaları hesapla.
3. Stok reservation oluştur.
4. Adresleri kaydet.
5. Kargo seçeneklerini hesapla.
6. Pending order oluştur.
7. Payment session oluştur.
8. Doğrulanmış callback/webhook ile payment ve order durumunu güncelle.

Frontend dönüş URL'sini kesin ödeme sonucu kabul etme.

## Payment Integration Layer

Her mağaza sahibi kendi provider credential'ını bağlar. Credential'ları açık PostgreSQL alanında tutma; KMS uyumlu envelope encryption kullan.

```ts
interface PaymentProvider {
  createSession(input: CreatePaymentInput): Promise<PaymentSession>;
  verifyCallback(input: CallbackInput): Promise<VerifiedPaymentEvent>;
  getPayment(input: GetPaymentInput): Promise<PaymentStatus>;
  cancel(input: CancelPaymentInput): Promise<PaymentResult>;
  refund(input: RefundPaymentInput): Promise<PaymentResult>;
}
```

PayTR adapter:

- iFrame API
- merchant_id, merchant_key, merchant_salt
- test/production
- server-side token
- Bildirim URL POST
- hash doğrulama
- doğrulanmış callback sonrası kesinleştirme
- tam/kısmi refund

iyzico adapter:

- Checkout Form
- API key ve secret
- sandbox/production
- initialize ve token
- callback/retrieve
- webhook signature
- cancel ve tam/kısmi refund

Modeller: payment_provider_connection, payment_attempt, payment_event, payment_transaction ve refund. Event processing idempotent olsun; provider event ID, payload hash ve idempotency key saklansın.

Payment durumları:

```text
created
session_created
pending
requires_action
paid
failed
cancelled
partially_refunded
refunded
```

Order ve payment state machine'lerini ayır.

## Orders ve fulfillment

Modeller: order, order_line, order_address, order_adjustment, order_status_history, fulfillment, fulfillment_line, shipment, return_request, return_line ve refund.

Gösterilen order number ile dahili UUID'yi ayır.

```text
draft
awaiting_payment
confirmed
processing
partially_fulfilled
fulfilled
cancelled
returned
```

Kargo için shipment create, label, tracking ve cancel işlemlerini içeren adapter contract oluştur.

## Event ve background jobs

Ana transaction ile outbox event yaz. HTTP request içinde e-posta, Kârmatik hesabı, feed generation, webhook veya toplu güncelleme çalıştırma.

Event'ler:

- store.created
- domain.activated
- product.created/published
- inventory.changed
- cart.abandoned
- checkout.started
- order.created/fulfilled
- payment.paid/failed
- refund.completed
- campaign.activated
- customer.created
- theme.published
- marketing.consent_changed
- geo.visibility_changed
- profit.margin_breached

Outbox publisher queue'ya taşısın. Consumer'lar idempotent, retry/backoff ve dead-letter uyumlu olsun.

## Campaign Engine

Tipler:

- percentage/fixed discount
- free shipping
- buy X get Y
- bundle/quantity discount
- cart threshold
- product/collection
- customer segment
- first order
- coupon code
- automatic discount
- flash sale

Koşullar:

- tarih/saat
- channel/currency
- minimum cart/quantity
- product/collection/tag
- segment/first-time customer
- usage limits
- coupon
- combination/exclusion

Priority, combinability ve conflict resolution deterministik olsun.

Kârmatik için opsiyonel `profit_guard` hook'u:

```text
minimum_margin_percent
minimum_profit_amount
exclude_loss_making_products
```

Kârmatik erişilemiyorsa seçilebilir block, warn veya ignore davranışı uygula.

## Pazarlama araçları

### Banner, slider, announcement ve popup

- tarih aralığı
- cihaz hedefleme
- route hedefleme
- segment
- UTM/trafik kaynağı
- gösterim sıklığı
- exit intent
- scroll/timer trigger
- kupon bağlantısı
- impression, click, close ve conversion event'leri

Bunlar theme section/overlay olarak çalışsın ve AI actions ile üretilebilsin.

### Landing pages

- kampanyaya bağlı sayfa
- reusable sections
- ürün/koleksiyon binding
- scheduled publish/unpublish
- form/lead capture
- SEO/GEO metadata
- UTM preservation

### Customer segments

Rule engine şu alanları desteklesin:

- sipariş sayısı ve toplam harcama
- son sipariş tarihi
- ürün/koleksiyon geçmişi
- lokasyon ve etiket
- kupon kullanımı
- terk edilmiş sepet
- consent

Segment dynamic veya snapshot olabilir.

### Attribution

Consent'e uygun şekilde utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer, landing page, click IDs, affiliate/influencer code, coupon attribution, first touch ve last touch kaydet. Order'a immutable attribution snapshot yaz.

### Analytics events

- page_viewed
- product_viewed
- collection_viewed
- search_performed
- product_added_to_cart
- checkout_started
- payment_info_submitted
- order_completed
- popup_viewed/clicked
- banner_clicked
- coupon_applied
- campaign_converted
- lead_submitted

Event'ler store, anonymous/session/customer identity, consent, timestamp ve attribution taşısın.

### Pixel ve conversion adapters

- Google Tag Manager
- Google Analytics 4
- Google Ads conversion
- Meta Pixel
- Meta Conversions API
- TikTok Pixel/Events

Browser/server event'lerini aynı event ID ile deduplicate edilecek şekilde tasarla.

### Consent

Necessary, analytics, marketing ve personalization kategorileri olsun. Consent version, source ve timestamp tut. İzin verilmeden marketing script yükleme. Cookie banner theme üzerinden düzenlenebilsin.

### Product feeds

Google Merchant, Meta Catalog ve genişletilebilir TikTok feed contract oluştur. Feed; ürün, variant, image, availability, price, brand, GTIN/MPN ve landing URL içersin. Büyük katalogda background generation ve versioned snapshot kullan.

### Abandoned cart

Cart activity ve iletişim bilgisine göre abandoned state üret. E-posta, SMS ve WhatsApp için provider adapter kullan; platform tek sağlayıcı dayatmasın.

### Influencer ve affiliate

Partner, campaign, tracking code, custom link, coupon binding, click, attributed order, commission rule ve commission ledger modelleri kur. İlk sürümde ödeme dağıtma; attribution ve komisyon raporu üret.

## Kârmatik bridge

Kârmatik'e ürün/varyant, maliyet, sipariş satırı, indirim, kargo, payment fee, iade, reklam referansı, channel price ve stok/satış hızı gönder.

Kârmatik'ten net kâr, margin, güvenli indirim sınırı, zarar uyarısı, rakip fiyatı, pazar fırsatı, kampanya uygunluğu ve fiyat önerisi al.

Database paylaşma; versioned API/event contract kullan. Bağlantı kesildiğinde commerce akışını bozmayan circuit breaker uygula.

## Yanıt bridge

Yanıt'a brand identity, public ürün/koleksiyonlar, canonical URLs, public içerik, structured data durumu, target topics ve competitors gönder.

Yanıt'tan visibility score, answer share, competitor visibility, missing query, cited source, content opportunity ve visibility change al.

Recommendation'ı AI Action Engine içinde kullanıcı onaylı kategori metni, FAQ, karşılaştırma sayfası, ürün içeriği veya landing page taslağına dönüştür.

## AI Action Engine

AI repository/database çağırmasın. Panel AI, ChatGPT ve Claude aynı typed Action Registry'yi kullansın.

```text
Natural language
→ Intent
→ Typed action plan
→ Authorization
→ Business rule/profit guard
→ Diff
→ Approval
→ Execution
→ Read-back verification
→ Audit
```

İlk actions:

- store.get_summary/update_settings
- page.create_draft/update_draft/publish
- banner.create_draft
- slider.create_draft
- popup.create_draft
- campaign.create_draft/activate
- catalog.search_products/update_product
- inventory.get_levels/adjust
- pricing.get_prices/update_prices
- orders.search/get
- analytics.get_performance
- karmatik.get_profit_summary/get_competitor_insights
- yanit.get_visibility_summary/create_content_opportunity

Risk sınıfları R0 read-only health, R1 read, R2 draft, R3 publish/campaign/price/stock, R4 cancel/refund/bulk ve R5 credential/domain/payment/role olsun. R3+ structured diff ve explicit approval gerektirsin. Approval action plan hash'ine bağlansın.

## ChatGPT ve Claude connector

Customer chatbot oluşturma. Connector mağaza sahibinin kendi AI hesabı içindir.

Remote MCP server:

- OAuth 2.1/OIDC
- organization/store selection
- granular scopes
- read/write ayrımı
- short-lived tokens ve revoke
- agent session
- rate limit
- approvals
- audit history

Scope'lar:

```text
store:read
catalog:read
catalog:write
orders:read
orders:write
campaigns:read
campaigns:write
analytics:read
karmatik:read
yanit:read
domains:manage
payments:manage
```

Riskli action çağrısında altyapi.io approval URL'si dön; onay sonrası işlem kaldığı yerden yürüsün.

## Admin frontend

Görsel yaklaşım Stripe, Cloudflare ve Linear çizgisinde sade ve güven veren olsun.

Navigasyon:

- Overview
- Orders
- Products
- Inventory
- Customers
- Storefront
- Content
- Campaigns
- Marketing
- Analytics
- Kârmatik
- Yanıt
- AI Actions
- Apps & Integrations
- Settings

Overview: revenue/orders/conversion, Kârmatik net profit/margin, stock risks, campaigns, Yanıt visibility, AI actions ve recommendations.

Storefront editor: solda page/section tree, ortada responsive preview, sağda properties; device modes, undo/redo, preview URL, publish ve AI input.

Campaign builder: type, targets, segment, benefit, schedule, limits, combination, profit guard ve bağlı landing/banner/slider/popup.

Marketing dashboard: sources, UTM performance, campaign revenue, coupons, influencer/affiliate attribution, abandoned cart, pixel/feed health ve consent.

Domain settings: default subdomain, custom domain, DNS instructions, validation/SSL state, canonical domain, retry ve redirects.

Payment settings: provider cards, credential entry, sandbox/production, webhook instructions, connection status ve supported operations.

## Storefront frontend

- edge cache
- responsive images
- semantic HTML ve accessibility
- localized money/date
- server-rendered catalog
- optimistic cart UX
- checkout'ta kesin server validation
- consent enforcement
- marketing events
- theme tokens

Public HTML/catalog cache'lenebilir. Cart, customer, order ve payment public cache'e girmez. Publish sonrası cache version değişsin. Ürün/fiyat değişimi tag/version ile invalidate edilsin. Inventory source of truth cache olmasın.

## Audit ve observability

Her request/job/event correlation_id, organization_id, store_id, principal_id, agent_id, request_id, event_id ve action_id taşısın.

Audit: credential, role, domain, payment config, price/stock, campaign, page/theme publish, cancel/refund ve AI approval değişikliklerini kapsasın. Secret, kart verisi, access token ve hassas kişisel veri loglanmasın.

## Environment

Typed environment schema ve `.env.example` oluştur. Gruplar:

- app URLs
- PostgreSQL
- Redis/Valkey
- queue
- Cloudflare account/zone/R2/custom hostnames
- AWS region/KMS/secrets
- AI providers
- Kârmatik
- Yanıt
- observability

Store-level payment credential'larını global env içine koyma; encrypted connection kaydında tut.

## Uygulama sırası

1. Monorepo ve config
2. PostgreSQL schema/migrations/tenancy
3. Auth, organization, stores, roles
4. Domain lifecycle ve edge router
5. R2 storage
6. Theme/section/page/publication engine
7. Multi-tenant storefront
8. Catalog/import
9. Inventory/reservation
10. Pricing
11. Cart/checkout
12. Payment abstraction
13. PayTR adapter
14. iyzico adapter
15. Orders/fulfillment/refunds
16. Outbox/queue/workers
17. Campaign Engine
18. Banner/slider/popup/landing pages
19. Segments/attribution/analytics
20. Pixels/feeds/consent/abandoned cart
21. Influencer/affiliate
22. Kârmatik bridge
23. Yanıt bridge
24. AI actions/approvals
25. ChatGPT/Claude MCP connector
26. Admin ekranları
27. Storefront cache/performance
28. Terraform/OpenTofu
29. Teknik dokümantasyon

## Kod kuralları

- Domain logic'i component veya route handler içine gömme.
- Provider payload'larını core domain'e sızdırma.
- Para için float kullanma.
- Zamanları UTC sakla.
- Public ve dahili ID ayrımını koru.
- İşlemleri idempotent tasarla.
- Secret loglama.
- Queue consumer'larını tekrar teslimata dayanıklı yap.
- Payment redirect sonucuna güvenme.
- Cache'i source of truth yapma.
- Frontend'den database erişimi oluşturma.
- Store context olmadan tenant query çalıştırma.
- Platform kodunu adapter package'larında izole et.
- UI'da loading, empty ve error state'lerini eksiksiz ele al.
- Türkçe/İngilizce localization altyapısını baştan kur.

## Beklenen teslim

- Çalışan monorepo
- Merchant admin
- Multi-tenant storefront
- Organization/store/role sistemi
- Custom domain/SSL lifecycle
- Theme ve section editor altyapısı
- Catalog, inventory, pricing
- Cart/checkout
- PayTR ve iyzico adapter'ları
- Orders/refunds
- R2 medya
- Campaign Engine
- Banner, slider, popup ve landing pages
- Segments ve attribution
- Pixels/conversion adapters
- Product feeds
- Consent ve abandoned cart
- Influencer/affiliate attribution
- Kârmatik ve Yanıt bridges
- AI Action Registry
- ChatGPT/Claude remote MCP connector
- Audit ve observability
- Environment örnekleri
- Database migrations
- Local development ve deployment dokümantasyonu

İş sonunda kısa teslim özeti ver:

- oluşturulan uygulamalar/package'lar,
- tamamlanan özellikler,
- environment değişkenleri,
- harici servis ayarları,
- local çalıştırma komutları,
- production deployment adımları,
- credential olmadığı için kullanıcının tamamlayacağı bağlantılar.

Şimdi çalışma dizinini incele, mevcut yapıyı koruyarak mimariyi oluştur ve uygulamaya başla.
