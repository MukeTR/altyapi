# altyapi.io — Site türleri, sektör paketleri ve CMS

Durum: **taslak plan (rev1, 2026-09-24)**. Bu doküman iki tasarım çalışmasının birleşimidir:

- **Site dikeyleri:** 9 sektör grubunun araştırması (hukuk, sağlık, güzellik, eğitim, emlak, yeme-içme, profesyonel hizmetler, yerel hizmetler, ortak altyapı), iki alternatif mimari ve bunların puanlanmış sentezi.
- **CMS:** Sanity, Payload, Strapi, Directus, Contentful, Storyblok, Webflow, Framer, Gutenberg ve Ghost karşılaştırması; altyapi'nin mevcut içerik yeteneklerinin boşluk analizi; AI/GEO uyumlu içerik araştırması.

Amaç: altyapi.io'yu yalnızca e-ticaret altyapısı olmaktan çıkarıp **web sitesi yapan herkes** için tek platform yapmak. Kapsam e-ticaret, kurumsal/B2B katalog, statik/landing siteler ve tüm hizmet sektörleridir (avukat, PT, klinik, kuaför, özel ders, emlak, restoran, ajans…). Hepsinin ortak içerik omurgası güçlü bir CMS olacak.

> Bu doküman ana build prompt'undaki "tam kapsamlı e-ticaret altyapısı" tanımını genişletir. E-ticaret yol haritası (kampanya motoru, feed'ler, AI Action Engine) bu işler yüzünden aç bırakılmaz. Faz 1–3'te mevcut e-ticaret kiracıları bugünkü akışlarında kalır; tek istisna yasal fiyat geçmişi düzeltmesidir.

> Hukuki not: Sektör kurallarındaki madde numaralarının bir kısmı ikincil kaynaklardan derlendi (mevzuat.gov.tr ve resmigazete.gov.tr bu ortamdan erişilemedi). Ürün **"uyum desteği"** olarak konumlanır, hukuki görüş değildir. Aşağıdaki "kademeli yaptırım" modeli bu belirsizliği yönetmek için vardır.

---

## 1. Temel model: üç eksen

Kiracı kökü mevcut `stores` satırıdır; panelde **"Site"** diye gösterilir. Alan adları, edge router, RLS, `organizationId + storeId` kolonları, temalar, sayfalar, yayınlar, `draft_revisions` (geri al/yinele) ve korumalı tracking katmanı aynen kullanılır, hiçbir şey yeniden adlandırılmaz.

Bir site üç bağımsız eksenle tanımlanır:

| Eksen | Ne belirler | Nerede tutulur |
|---|---|---|
| **Site türü** (preset) | `static`, `corporate`, `service`, `ecommerce`, `hybrid`: başlangıç şablonları ve varsayılan modüller | `site_profiles.kind` |
| **Yetenek modülleri** | Hangi özelliklerin açık olduğu: content, people, forms, leads, catalog, commerce, booking, quotes, portal, listings, menus… | `site_modules` (status: enabled / disabled / locked_on / locked_off) |
| **Sektör paketi** | Tek bir birincil paket (sabitlenmiş sürüm) ve isteğe bağlı ek paketler. Paketler şablon, içerik tipi, terminoloji ve bağlı kural paketlerini getirir | `site_profiles.primary_pack` + `vertical_pack_releases` |

**Kural:** Çalışma zamanı kodu site türüne veya paket adına göre **dallanmaz**. Yalnızca `site_modules` satırlarına ve derlenmiş politika anlık görüntüsüne (`site_policy_snapshots`) bakar. Tür değiştirmek, modül eklemek ya da ek paket eklemek bir veri değişikliğidir, migration gerektirmez.

Bir özellik ancak dört kapının hepsi açıksa çalışır:

1. Platform bayrağı açık.
2. Plan hakkı (entitlement) var.
3. `site_modules.status` değeri `enabled` veya `locked_on`.
4. Politika anlık görüntüsü özelliği yasaklamıyor.

Politika en son değerlendirilir. Hiçbir kiracı rolü, ajans ya da AI politikayı aşamaz. `assertCan` yanına `assertModule(ctx, key)` eklenir. `assertCan`, kapalı bir modüle ait izinleri de reddeder.

**Onboarding tek soruyla başlar: "İşiniz ne?"** Kullanıcı yaklaşık 70 Türkçe sektör etiketinden birini seçer. Etiketler eş anlamlılar ve NACE Rev.2 koduyla eşlenir; kod, yüklenen vergi levhasından da okunabilir. Seçilen paket site türünü, modülleri, şablonları ve terminolojiyi önerir; kullanıcı onaylar veya eler.

Terminoloji bir paket katmanıdır. Veri yeniden adlandırılmaz, yalnızca panel, e-posta ve vitrin varsayılanları değişir:

- **Müşteri** yerine: Müvekkil, Danışan, Mükellef veya Üye.
- **Sipariş** yerine: Randevu, Başvuru veya Teklif.

**Örnekler:**

- **ergentekstil.com**
  - Site türü `corporate`, paket `b2b.uretici-toptan`.
  - Modüller: content, people, forms, leads (RFQ teklif sepeti), catalog (`priceVisibility=quote_only`), quotes.
  - Diller: tr, en, de, ar, ru.
  - Perakende satış ileride yalnızca `commerce` modülünü açarak eklenir.
- **Tek başına çalışan avukat**
  - Site türü `static`, paket `hukuk.avukat`.
  - Modüller: people, content (practice_area, publication), booking (AAÜT tabanının altına inmeyen ön ödeme), portal.
  - Kilitli kapalı: commerce, reviews, campaigns.
  - Kilitli açık: identity-registry, statutory-info, tracking kilidi.

### 1.1 Modül manifesti

Her modül, tipli bir `ModuleManifest` dışa aktaran bir sunucu paketidir. Manifest şunları bildirir:

- `key`, `version`, `dependsOn`
- Sahip olduğu tablolar ve izin kaynakları
- Bölüm tanımları ve şablon yerleşim anahtarları (`tpl:<key>`)
- Yerelleştirilmiş rota önekleri; her rota için önbellek sınıfı (`public` / `private`) ve sayfa sınıfı (`marketing | service | booking | intake | portal | checkout | legal`)
- zod ayar şeması ve ücretlendirilebilir satır türleri (payables)
- Outbox olayları, AI eylemleri ve risk sınıfları
- Lint çıkarıcıları, JSON-LD üreticileri, sitemap ve ekosistem sağlayıcıları
- Admin navigasyonu

`packages/site` içindeki `ModuleRegistry` manifestleri açılışta doğrular; bu, bugün `SECTION_DEFINITIONS`'ın `registry-sync.ts` ile senkronlanmasıyla aynı yaklaşımdır. Tam manifesti olmayan modül yayınlanamaz, yoksa politikayı atlar.

---

## 2. Birleştirme kararları (CMS tasarımı × dikey tasarım)

İki tasarımın çakıştığı yerlerde verilen kararlar:

| # | Konu | Karar |
|---|---|---|
| K1 | Kayıt sürümleri | CMS'deki `content_entry_versions` yerine genel ve **değişmez** `record_versions` tablosu kullanılır (`resource_type`: content_entry, person, location, listing…; `live_from`, `live_to`, `policy_snapshot_id`, `lint_report_id`). Kayıtta `live_version_id` tutulur. "X tarihinde ne yayındaydı" sorusu yanıtlanabilir. |
| K2 | Slug geçmişi | `record_slugs` (kayıt, dil, slug, `is_current`) tablosu. Slug değişince 301 yönlendirmesi otomatik oluşur. |
| K3 | İşletme profili | CMS'deki singleton `business_profile` içerik tipi yerine tipli `business_identities` (PK storeId) ve `site_locations` tabloları. CMS'deki "İşletme profili" ekranı bu tabloları düzenler. |
| K4 | Kişiler | `person` içerik tipi yerine `people` tablosu (packages/people). Nedeni: lisanslar (`licences`) ve rezervasyon personeli aynı kişiye bağlanır, doğrulama gerekir. |
| K5 | Hizmetler | Bilgi amaçlı hizmet sayfası → `service` içerik tipi (hukukta `practice_area`). Satılabilen veya randevu alınabilen hizmet → `products.kind='service'` ve `service_profiles`. Bir içerik girdisi ürüne referans verebilir. Böylece fiyat, vergi, sipariş ve Kârmatik maliyet akışı tek ürün modelinde kalır. |
| K6 | Site politikası | CMS'deki `site_policies` tablosu yerine `site_profiles` (URL stili, çevrilmemiş dil politikası, AI crawler tercihleri, doğrulama meta'ları), `compliance_profiles` ve `site_policy_snapshots`. |
| K7 | Bölüm kısıtları | CMS'deki `forbiddenIn` yerine `SectionDefinition`'a `module`, `policyTags` ve `propTags` eklenir. Yasaklar kural paketinde `section.block_tag` olarak ifade edilir. Etiketsiz bölüm tanımı derlemeyi kırar. |
| K8 | Şablon sayfaları | `page_type` enum'una yalnızca **tek** değer eklenir: `template`. Bunun yanında `pages.template_key` kolonu gelir (ör. `entries.post.detail`, `entries.post.index`, `services.detail`, `booking.flow`). Birden fazla yeni `page_type` değeri eklenmez. |
| K9 | Rota tablosu | CMS'nin rota tablosu ile modüllerin `ModuleRouteRegistry`'si tek `render/routes.ts` dosyasında birleşir. Sabit önekler kalkar. |
| K10 | Lint | Tek motor (packages/compliance). Kategoriler: `compliance`, `quality` (GEO), `a11y`. Raporlar `compliance_lint_reports` tablosunda hash zinciriyle tutulur, bulgular kategori taşır. |
| K11 | Formlar | Tek paket: `packages/forms`. Formlar, sürümlü yasal metinler (`legal_documents`) ve ayrık rıza kayıtları. |
| K12 | Diller | `commerce-core/src/locales.ts` altında bir dil kaydı: `tr, en, de, ar, ru, fr, fa, az, nl, uk, ka`, her biri `dir` ve `ogLocale` ile. `LOCALES` ve `SUPPORTED_LOCALES` bu kayıttan türetilir. Mevcut `{tr, en}` verisi geçerli kalır. |
| K13 | Yayın yolları | Tasarım (tema, sayfa, navigasyon) bugünkü atomik yayın işaretçisiyle kalır ve geri alınabilir. Kayıtlar (içerik girdisi, kişi, lokasyon, ilan) tek tek `record_versions` ile yayınlanır. Panelde "canlı zaman çizelgesi" iki yolu tek görünümde birleştirir. Tema geri alındığında makaleler yayından kalkmaz. |

---

## 3. İçerik modeli (CMS)

### 3.1 Katmanlar

Yeni paket `packages/content`, theme-engine'in **altında** yer alır. Bağımlılıkları: database, commerce-core, storage, events, audit, auth. theme-engine de rota çözümü, bölümler ve doğrulama için content'e bağlanır.

- **Alan primitifleri** (`localized`, `richText`, `href`, `link`, `assetId`) `content/src/fields/primitives.ts` dosyasına taşınır. theme-engine bunları yeniden dışa aktarır, böylece mevcut bölüm tanımları değişmeden derlenir.
- **Tek sanitizer:** `RICH_TEXT_OPTIONS` ve `catalog/src/text.ts` içindeki `DESCRIPTION_HTML_OPTIONS` tek ortak ayara birleşir.

### 3.2 İçerik tipi türleri

| Tür | Anlamı |
|---|---|
| `collection` | Çok girdili, isteğe bağlı olarak kendi URL'si olan tip (makale, SSS, proje…) |
| `singleton` | Site başına tek girdi |
| `taxonomy` | Slug, açıklama ve SEO alanı olan terimler (kategori, etiket, hizmet kategorisi, menü bölümü, çalışma alanı) |

**Yerleşik tipler** kodda tanımlıdır (`content/src/types/*.ts`, zod), bölüm tanımlarıyla aynı yaklaşım. Bir site yerleşik tipi "kurar". `content_types` satırı yalnızca siteye özgü kısmı tutar:

- tip adı (handle) ve etiketler
- dile göre URL öneki
- gizlenen isteğe bağlı alanlar
- ek özel alanlar
- varsayılan sıralama

Yerleşik alanların şeması veritabanında tutulmaz; platform güncellemeleri böylece her siteye ulaşır.

**Özel tipler** (`FieldDef[]`) güvenli bir alan kümesiyle sınırlıdır. Ham HTML, JSON, JSON-LD, iframe, script ve yıldız puanı eklenemez. schema.org çıktısı izinli bir listeden seçilir: Thing, CreativeWork, Article, Service, Place, Event, Person, Organization, DefinedTerm.

Sınırlar:

| Sınır | Değer |
|---|---|
| Site başına özel tip | 30 (plana bağlı) |
| Tip başına alan | 60 |
| Tekrarlayıcı | 100 öğe, tek seviye iç içe |
| Girdi boyutu | 256 KB |
| richDoc | Dil başına 200 bin karakter |

### 3.3 Alan tipleri

| Grup | Alan tipleri |
|---|---|
| Metin | `text`, `textarea`, `richDoc`, `slug` (Türkçe duyarlı slugify) |
| Sayı ve para | `number` (birimli: m², dk, seans), `money` (minor unit; fiyatı yasaklayan profillerde gizlenir ya da engellenir) |
| Diğer temel tipler | `boolean`, `date`, `datetime`, `dateRange`, `duration`, `select`, `multiSelect`, `color` |
| Medya | `asset` (kullanım nesnesi: `{assetId, alt?, crop?, focal?, decorative?}`), `gallery`, `video` (izinli sağlayıcı kimliği, altyazı, transkript) |
| İlişki | `link` (LinkTarget), `reference`, `multiReference` |
| İletişim ve konum | `email`, `phone` (E.164 ve WhatsApp), `address` (mahalle, ilçe, il), `geo`, `openingHours` (özel günler ve "randevu ile") |
| Yapılandırılmış | `keyFacts`, `sources` (atıf listesi), `group`, `repeater` |
| Yalnızca yerleşik tipler | `credentials`. `verified` bayrağını yalnızca sahip ayarlayabilir; AI ve içe aktarma ayarlayamaz. |

- "Eski fiyat" veya indirim metni hiçbir zaman serbest metin olamaz; yalnızca fiyat ve kampanya motorundan, `price_history` üzerinden gelir.
- İç (`internal`) alanlar vitrine, Delivery API'ye, JSON-LD'ye ve AI istemlerine hiç girmez.

### 3.4 richDoc

Tüm yeni zengin metin alanlarının tek biçimidir. Dil başına ProseMirror/Tiptap uyumlu bir JSON AST'dir ve zod ile düğüm izin listesine göre doğrulanır.

**Düğümler:**

- paragraph, heading (h2–h4, Türkçe slug'lı çapa)
- bulletList, orderedList
- blockquote, table (başlık satırı zorunlu)
- image (alt metin veya `decorative`)
- callout
- statistic (kaynak zorunlu)
- quote
- faqGroup
- cta
- entryEmbed, productEmbed
- embed (youtube, vimeo, google_maps, spotify; yalnızca kimlik, asla URL veya iframe)

**İşaretler:** bold, italic, underline, strike, code, citation, link (LinkTarget).

**LinkTarget:**

- `url` (https, mailto, tel)
- `page`, `entry`, `product`, `collection` (kimlikle)
- `anchor`
- `whatsapp`, `tel`

Yayın anında `deriveEntry()` şunları üretir:

- İç bağlantıları token olarak tutan sanitize edilmiş HTML
- Markdown ve düz metin
- Başlık ağacı
- Soru-cevap çiftleri (faqGroup'lardan ve soru biçimli H2'lerden)
- Referanslar, kelime sayısı, okuma süresi

Yapıştırılan veya içe aktarılan HTML önce sanitize edilir, sonra şemaya duyarlı `htmlToDoc` ile dönüştürülür.

### 3.5 GEO alan seti

URL'si olan her tipe otomatik eklenir:

- `summary` ("Kısa cevap", 40–80 kelime): meta açıklama yedeği, llms.txt satırı ve ekosistem özeti olarak da kullanılır
- `keyFacts`
- `faq`
- `sources`
- `authors` (kişi referansı)
- `reviewedBy` ve `lastReviewedAt`
- `significantUpdate`

### 3.6 Referanslar ve yerelleştirme

**Referanslar.** `content_references` tablosu her kayıtta taslak satırları, her yayında canlı satırları yeniden yazar (`setAssetReferences` ile aynı desen). Kullanım alanları:

- Ters listeler (hizmet → o hizmeti veren avukatlar)
- "Kullanıldığı yerler" paneli
- Silme koruması
- Yayın bağımlılık kontrolü ("Bu içerik taslaktaki 2 SSS kaydına bağlı: birlikte yayınla?")
- İç bağlantı çözümü
- Önbellek temizleme hedefleri

**Yerelleştirme.** Varsayılan olarak alan düzeyindedir (mevcut `LocalizedText`), slug'lar dile göre tutulur.

- `published_locales` yayın anında hesaplanır: zorunlu alanları dolu olan diller.
- `translation_state` her alan ve dil için `{sourceHash, status: machine | reviewed | manual}` tutar. Kaynak metin değişince çeviri "güncel değil" olarak işaretlenir.
- Düzenlenen sektörlerde (hukuk, sağlık) durumu `machine` olan diller yayınlanmaz.
- Çevrilmemiş dil politikası iki seçeneklidir:
  - `hide` (varsayılan): 404 döner, hreflang üretilmez.
  - `fallback_noindex`: varsayılan dil içeriği noindex ile gösterilir.
- ar ve fa için `dir="rtl"`. Vitrin mantıksal CSS'e geçer (ms, me, ps, pe, text-start).

### 3.7 Neler içerik girdisi değildir

- **Sayfalar ve landing'ler** sayfa olarak kalır: yerleşim öncelikli, kampanyaya bağlı, yayın anlık görüntüsünde tutulur.
- **Ürünler** (B2B katalog dahil) `packages/catalog`'da kalır. Eklenenler:
  - `products.kind`: `physical | service | package | membership | gift_card`
  - `sales_mode`: `cart | quote | catalog_only`
  - `priceVisibility`, `minOrderQty`, `leadTimeDays`, `gtipCode`
  
  Feed'ler, pazaryeri bağlayıcıları ve stok fiziksel olmayan türleri **atlar**.
- **Formlar** kendi tablolarındadır, çünkü gönderimler KVKK saklama süresine tabi kişisel veri içerir.
- **Navigasyon** `navigations` tablosunda kalır; iki yeni bağlantı türü eklenir: `entry` ve `entry_index`.

---

## 4. Yerleşik içerik tipleri ve sektör kullanımı

| Tip | Kullanan sektörler | Notlar |
|---|---|---|
| `post` + `post_category`, `tag` | herkes (blog, haber, makale, sirküler) | Hukukta `publication`: mevzuat ve karar referansı, zorunlu "genel bilgilendirmedir" notu, satış CTA'sı yok |
| `service` + `service_category` | kurumsal, hizmet | Hukukta `practice_area`: slug'lar kilitli, "uzmanlık anlamına gelmez" çerçevesi |
| `faq_item` | herkes | faq@2 ve FAQPage JSON-LD |
| `project` / `case_study` | ajans, inşaat, B2B | Hukuk ve sağlıkta yasak (dava sonucu ve müvekkil adı verilemez) |
| `testimonial` | ticari rejim | Hukuk ve sağlıkta politika gereği kapalı. 2026 kuralları: yalnızca doğrulanmış alım yorumu, en az 1 yıl görünür |
| `certificate`, `document` | B2B (ISO, OEKO-TEX), herkes | Geçerlilik tarihi; kamuya açık PDF'ler |
| `job_posting` | herkes | CV'ler vault'ta tutulur |
| `event`, `course` | eğitim, etkinlik, fitness | Satış yapılacaksa ürün veya oturum ile bağlanır |
| `price_plan` | ticari rejim | Politika fiyatı gizliyorsa kapalı |
| `menu_section` + `menu_item` | restoran | Detaylı menü modülü Faz 9'da |
| `listing` | emlak, galeri | EİDS ve yetki belgesi doğrulaması Faz 9'da |
| `before_after` | güzellik, fitness | Açık rıza (`media_consents`) zorunlu; sağlıkta Ek-1 onamı |
| `partner` | kurumsal | Müşteri logoları `client_reference` etiketi taşır; hukukta kapalı |
| `glossary_term` | herkes | DefinedTerm |
| `legal_document` | herkes | KVKK aydınlatma, çerez, mesafeli satış; sürümlü |
| `announcement` | hukuk (RYY m.7 tek seferlik duyuru), herkes | `lockKey` ile tek seferlik |

---

## 5. Rotalar ve oluşturma (rendering)

**Rota çözüm sırası** (`theme-engine/src/render/routes.ts`):

1. Dil öneki ayıklanır (dil kaydına göre).
2. Sistem rotaları: `/`, `/search`, `/cart` ve `/products/*` (yalnızca commerce modülü açıksa, aksi hâlde 404), `/collections/*`, feed'ler, `/llms.txt`, `.md` alternatifleri.
3. Modül ve içerik tipi önekleri, en uzun eşleşme önce, dile göre yerelleştirilmiş:
   - `/hizmetler` ve `/en/services`
   - hukuk paketinde `/calisma-alanlari`
   - `/{önek}` → index şablonu
   - `/{önek}/{slug}` → girdi (canlı slug, sonra `live_version_id`)
   - `/{önek}/kategori/{terim}` → taksonomi arşivi
4. Kök düzeyinde sayfalar (`site_profiles.page_url_style = 'root'` ise).
5. `/pages/{handle}` (kök stilde 301 ile yönlendirilir).
6. Yönlendirmeler: önce tam eşleşme, sonra en uzun önek; 410 Gone desteği.
7. 404 döner ve `not_found_hits` tablosuna yazılır.

Her rota bir **önbellek sınıfı** ve bir **sayfa sınıfı** döndürür. Tracking katmanı sayfa sınıfını okur: `booking`, `intake`, `portal` ve sağlık sayfalarında pazarlama script'leri hiç yüklenmez, sunucu olaylarından hizmet ve durum bilgisi çıkarılır.

**Şablonlar.** Bir girdi `page(type='template', template_key='entries.<tip>.detail')` ile oluşturulur. Zorunlu tekil bölüm `entry-main`'dir; tipe göre oluşturucu seçer, özel tipler için genel alan oluşturucusu kullanılır. Kullanıcı şablonları normal editörde tasarlar. Tip kurulunca varsayılan şablon **taslak** olarak oluşturulur.

**Yeni bölümler:**

- entry-main, entry-index-main, entry-list, entry-related, entry-toc
- business-facts, opening-hours, locations-map
- statutory-info (künye), identity-registry
- form@1, faq@2, rich-text@2, image-with-text@2, video@2
- stats (kaynak zorunlu), steps, cta-band
- gallery, document-list, pricing, before-after
- shared-section@1

Politikanın zorunlu kıldığı sistem bölümleri (statutory-info, identity-registry, emergency-notice, licence-badge), bugün `requiredIn`'in header ve footer'ı koruduğu şekilde korunur.

**Anlamsal HTML:**

- Her sayfada tek H1. Bugün yalnızca ana sayfa hero'su H1'dir (`content.tsx`); bu düzeltilir.
- `article`, `time`, `address`, `dl` ve `figure` öğeleri.
- Görünür "Son güncelleme", inceleyen kişi ve kaynak listesi.
- Görsellerde odak noktalı kırpma, `srcset`, `width` ve `height`.

**JSON-LD.** Sunucuda tek bir `@graph` üretilir. İçeriği:

- `#organization` ve `#website`, `business_identities` üzerinden
- sayfa düğümü: WebPage, ProfilePage, CollectionPage veya MedicalWebPage
- BreadcrumbList
- tip eşleyicisinden `mainEntity`
- index sayfalarında ItemList
- tek, birleşik bir FAQPage

Uyum filtreleri en son çalışır; örneğin hukukta AggregateRating, Review ve Offer düşer. **Parite lint'i:** grafikteki her metin değeri görünür sayfada da bulunmalıdır.

**Sitemap, RSS, llms.txt:**

- Tip başına sitemap dosyaları (≤5000 URL). `lastmod` gerçek değişiklik tarihidir; index dosyasının `lastmod`'u çocuklarının en büyüğüdür, `now()` değildir.
- Yazılar için RSS.
- `/llms.txt`: marka, tek satırlık açıklama, NAP ve saatler, tip başına `.md` bağlantıları.
- `.md` alternatifleri `rel=canonical` ve `X-Robots-Tag: noindex` ile sunulur.

**robots.txt.** Arama ve cevap botları ile kullanıcı adına çalışan ajanlar serbesttir. Eğitim botları kiracının tercihine bağlıdır; varsayılan kapalıdır. `Content-Signal` satırı eklenir. IndexNow pingleri worker'dan gönderilir.

**Önbellek.**

- Girdi yayınlandığında veya yayından kalktığında `contentVersion` artar.
- `storefront.publication_switched` (yayın ve geri alma) ile `redirect.changed` olayları edge içerik sürümü tetikleyicisine eklenir. Bugünkü açık kapanır: geri alma ve yönlendirme değişikliği şu an edge önbelleğini yenilemiyor.

**Önizleme.** Taslak verisini okur. Düzenleme işaretçileri (`data-alt-src`) yalnızca önizlemede üretilir, canlı HTML'e asla girmez.

---

## 6. Uyum motoru (packages/compliance)

**İki ayrı paket türü:**

- **Dikey paketler** ürün yapılandırmasıdır: modüller, şablonlar, içerik tipleri, terminoloji. Site bir sürüme sabitlenir (ör. `hukuk.avukat@1.4.0`); yükseltme açık bir `vertical_migrations` çalıştırmasıdır (fark ve ön-lint ile).
- **Kural paketleri** mevzuattır ve yasal yürürlük tarihine göre sürümlenir: `tbb-ryy@2026-05-02`, `saglik-tanitim@2025-11-12`, `ticari-reklam@2026-08-01`. Platform yeni sürümü etkilenen tüm sitelere bir uyum süresiyle (`graceDays`) iter. Kiracı eski yasal sürümde kalamaz.

**Kural temsili.** zod ayrımlı birleşim (discriminated union). Her kuralın alanları:

- `id`, `kind`, `params`
- `severity`, `enforcement` (block | require_ack | warn | monitor)
- `basis` (law | platform_policy)
- `scope`: rejim, sayfa sınıfı, dil, varlık tipi, meslek
- `unlessLicence`
- `sources`: kanun, madde, RG tarihi ve sayısı, `verification`

**Kural türleri:**

| Grup | Türler |
|---|---|
| Modül ve bölüm | `module.forbid`, `module.require`, `module.config`, `section.block_tag`, `section.block_type`, `section.require`, `prop.constraint` |
| Metin ve SEO | `copy.lexicon` (Türkçe kök, bağlam penceresi), `copy.pattern`, `slug.pattern`, `seo.keywords_whitelist`, `seo.title_template`, `schema.block` |
| Kimlik ve fiyat | `identity.require`, `entity.cardinality`, `entity.unique_event`, `price.display` (public, checkout_only, hidden), `fee.floor` |
| Tracking | `tracking.block_provider`, `tracking.scope`, `tracking.window`, `tracking.strip_context`, `audience.geo_block` |
| Rıza ve veri | `consent.separate`, `consent.purpose_required`, `data.class` (özel nitelikli veri → vault) |
| Medya ve mesaj | `media.consent_required`, `media.ai_label`, `messaging.commercial_block`, `messaging.template_lock` |
| Diğer | `review.rules`, `locale.exclude`, `approval.required`, `ai.refuse_intent` |

**Kademeli yaptırım:**

- Yalnızca yetenek kaldıran platform politikası kuralları **ilk günden bloklar**: reklam pikselini kapatmak, testimonial'ı kapatmak, tek ofis sınırı, fiyatı gizlemek. Bu kurallar bir siteyi uyumsuz hâle getiremez.
- İçeriği yargılayan yasal kurallar (kelime listeleri, desenler, slug'lar) doğrulama düzeyine göre ilerler:
  - `unverified` iken `warn`
  - `snippet_verified` olunca `require_ack`
  - hukuk danışmanı `counsel_approved` işaretleyince `block`

**Derleme.** `compileSnapshot(storeId)` aşağıdakileri birleştirir:

1. Platform baz paketi
2. Birincil paket
3. Ek paketler
4. Hizmet başına rejimler
5. Doğrulanmış lisanslar

Birleştirme **en katı kural kazanır** ilkesiyle yapılır:

- Yasaklar birleşir, izinler kesişir.
- Tabanlarda en büyük, sınırlarda en küçük değer alınır.
- Tracking sağlayıcıları kesişir.

Sonuç, kural başına kaynak bilgisiyle birlikte değişmez bir `site_policy_snapshots` satırıdır. Panel, hangi paketin hangi maddesinin bir pikseli kapattığını tam olarak gösterebilir.

**Uygulama noktaları.** Hepsi panel, ajans, içe aktarıcı, Yanıt taslakları, MCP ve AI'ın kullandığı **aynı servis fonksiyonlarında** çalışır:

- **Modül kapısı:** `enableModule`, `assertModule`.
- **Yazma anı:**
  - `validatePageContent(input, placement, policy)`, taslak dahil
  - `saveTrackingConfig`: `denied_by_policy`
  - form, bildirim ve ürün kaydetme
- **Yayın anı:**
  - `publishCore` ve `publishRecord` lint çalıştırır
  - `rollbackTo` hedef yayını **güncel** anlık görüntüye göre lint'ler
  - zamanlanmış yayın, engelli öğeyi bekletir ve bildirim gönderir
- **Oluşturma anı:** `loadSite` ve `resolveRoute` anlık görüntüyü yeniden uygular:
  - engelli bölümleri düşürür
  - zorunlu bölümleri enjekte eder
  - JSON-LD'yi filtreler
  - `render_suppressions` kayıtlarını uygular
- **Veri katmanı:** özel nitelikli alanlar yalnızca vault'a yazılır; outbox, analitik, e-posta gövdesi, log, AI bağlamı ve ekosisteme asla girmez.
- **AI:** Action Engine'e politika ön kontrolü eklenir. Onay hash'i lint raporu hash'ini kapsar. Bulguları `block` olan R3 yayın eylemleri çalıştırılamaz.

**Lint:**

- Türkçe büyük/küçük harf katlama (İ/i, I/ı) ve diakritik duyarsız varyantlar.
- Ek duyarlı kök bulma: "uzman" kelimesi "uzmanlığımızla" içinde de yakalanır.
- Gizleme çözme: "e n i y i", "%100", "1 numara".
- Bağlam izin listeleri: alıntılanan mahkeme kararı, kilitli çerçeve metinler.
- Her bulgu şunları taşır: kural kimliği, kaynak ("RYY m.8"), doğrulama düzeyi, JSON yolu, alıntı, düzeltme önerisi.
- Sonuçlar `(contentHash, snapshotHash)` ile önbelleklenir.

**Kanıt.**

- `compliance_lint_reports` yalnızca eklemeli (append-only) ve site başına hash zincirlidir.
- Katı modda yayın başına HTML anlık görüntüsü kilitli bir bucket'ta tutulur.
- **"Uyum dosyası"** ZIP dışa aktarımı: hangi tarihte ne yayındaydı, lint raporları, kaynaklar, rıza metni sürümleri, onaylar, bastırmalar.
- Varsayılan saklama süresi 10 yıl.

**İstisnalar.**

- `require_ack` bulgusu sahip veya uyum sorumlusu tarafından gerekçe yazılarak onaylanabilir.
- `block` bulgusu yalnızca platform uyum yöneticisi tarafından aşılabilir: iki kişilik onay, yazılı gerekçe ve bitiş tarihi gerekir.
- Acil kapatma düğmesi (kill switch) dakikalar içinde `render_suppressions` yazar.

**Her sitenin baz kuralları:**

- 6563 m.3 künye.
- KVKK m.10 aydınlatma; her form kendi aydınlatma sürümüne bağlanır.
- Açık rıza ayrı alınır.
- Çerez bandında eşit ağırlıklı "Reddet" butonu; rızadan önce pazarlama script'i yüklenmez.
- Ticari elektronik ileti yalnızca rıza ve İYS kontrolüyle gönderilir.
- Ticari Reklam Yönetmeliği:
  - "önceki fiyat" elle yazılmaz, `price_history`'den hesaplanır
  - doğrulanmış yorum
  - AI kullanımı beyanı

  Geriye bakış gün sayısı kural parametresidir ve doğrulama bekler.

---

## 7. Sektör paketleri (özet)

| Paket | Site türü | Ana modüller | Önemli korumalar |
|---|---|---|---|
| `platform.baseline` (`genel.hizmet` yedeği) | her tür | content, forms | Baz kurallar |
| `statik.kisisel-landing` | static | content, forms | — |
| `kurumsal.genel` (ajans, danışmanlık, inşaat, lojistik, holding, enerji) | corporate | content, people, leads | Çevre iddiasına kanıt |
| `saas-teknoloji` | corporate | content, leads, price_plan | — |
| `b2b.uretici-toptan` (ergentekstil) | corporate | catalog (quote_only), leads/RFQ, quotes, certificate | Sertifika geçerlilik tarihi; Offer JSON-LD'si bastırılır |
| `eticaret.perakende` (moda, gıda, kozmetik, takviye, elektronik…) | ecommerce | bugünkü e-ticaret | Takviye ve kozmetik sağlık beyanı lint'i |
| `yerel-hizmetler` | service | booking, leads | — |
| `guzellik.kuafor-salon` (8 alt profil) | service | booking (kapora), before_after | Medikal işlem kodları yasak; önce-sonra için rıza |
| `fitness.pt-salon-studyo` | service | booking, membership, group_sessions | Dönüşüm fotoğrafına rıza; sağlık beyanı yasak |
| `saglik.hekim-dis`, `saglik.smhb`, `saglik.turizm` | service | people (doğrulanmış), booking | Tanıtım Yönetmeliği: piksel yok, fiyat yalnızca ödeme adımında, onam, TR bölgesinde vault |
| `hukuk.avukat`, `hukuk.arabulucu`, `hukuk.noter` | static / corporate | people, content (practice_area, publication), booking (ön ödeme ≥ AAÜT), portal | TBB RYY: reklam pikseli, testimonial, kampanya, dizin yok; tek ofis; künye ve sicil bloğu zorunlu |
| `mali.smmm-ymm` | corporate | people, content (sirküler, vergi takvimi), portal | TÜRMOB HRRY |
| `fikri-mulkiyet.patent-marka-vekili` | corporate | leads, quotes (hizmet ve resmi harç) | Yönetmelik m.19 dürüstlük kuralları |
| `egitim` (özel ders, dil okulu, kurs, sürücü kursu, online) | service | booking, course, group_sessions | MEB izin bilgisi |
| `gayrimenkul.emlak` | corporate | listings | EİDS doğrulaması; yetki sözleşmesi |
| `otomotiv.galeri-servis`, `turizm.konaklama-acente`, `restoran.yeme-icme`, `etkinlik-organizasyon`, `dernek-vakif` | çeşitli | listings, menus, group_sessions, donations | Sektöre özel |
| `kisitli-ve-haric` | — | — | Onboarding'de reddedilir (ör. avukat olmayan "hukuki danışmanlık" şirketleri) |

**Sektörler arası dizin yapılmaz.** "Avukat, doktor ya da PT bul" türünden bir pazar yeri RYY ve sağlık Tanıtım kurallarını ihlal eder; kişi dizini site içinde kalır.

Mesleğe özgü unvan ve kelimeler (avukat, mali müşavir, noter, Dr., Uzm., diyetisyen, klinik psikolog, fizyoterapist) yalnızca **lisans doğrulandıktan sonra** açılır. Böylece kimse kurallardan kaçmak için daha gevşek bir sektör seçemez.

---

## 8. Ekosistem bağlantısı (Yanıt ve Kârmatik)

Ekosistem v1'in el sıkışma, imza ve kapsam modeli **değişmez**. v1.1 yalnızca eklemeli olur; eşler bilinmeyen enum değerlerini tolere eder.

- **Varlık bilgisi.** `geo` paketi politika filtresinden geçmiş tek bir `entity_fact_snapshots` grafiği üretir. Kaynakları: kimlik, lokasyonlar, doğrulanmış kişiler, hizmetler, saatler. Bu graf JSON-LD, llms.txt ve `GET /ekosistem/v1/brand` için kullanılır.
- **İçerik akışı.** `entry`, `service`, `person`, `location` ve `listing` türleri eklenir. Sipariş akışına `lineKind` ve `sourceType` eklenir.
- **Paket manifestleri** `ekosistem { yanitSector, seedQuestions, monitorOnlyQuestions, karmatikMode }` taşır. Bir paket seçildiğinde kardeş ürünler de kendiliğinden yapılandırılır.
- **Yanıt:**
  - Düzenlenen sektörlerde **doğruluk modunda** çalışır: AI cevaplarının baro veya oda, sicil, adres ve çalışma alanlarını doğru söyleyip söylemediğini ölçer. Uydurulmuş "uzman" veya "en iyi" iddiasını bulgu olarak işaretler.
  - "En iyi boşanma avukatı" türünden sorular yalnızca izlenir, bunlar için içerik **üretilmez**.
  - Fırsatlar yalnızca taslak olur ve paket lint'inden geçmeden onaylanamaz.
- **Kârmatik:**
  - `full` (e-ticaret, B2B): mevcut akışlar; B2B teklifte `profit/quote` marj koruması.
  - `services`: hizmet başına katkı marjı, doluluk, no-show oranı, paket kırılımı.
  - `practice` (hukuk, mali, sağlık): yalnızca zaman ve maliyet raporu; fiyat ve indirim önerisi yok, tarife tabanı kazanır.
  - `off` (noter, dernek, statik).
- **Asla köprüden geçmeyenler:** vault sınıfları, form ve lead içerikleri, sağlık etiketli her şey.

---

## 9. Veri modeli (yeni ve değişen tablolar)

Tüm kiracı tabloları `organization_id` ve `store_id` taşır, RLS ile korunur (`app_tenant_visible`). Platform tabloları kiracı kolonu taşımaz.

**Site ve politika:**

| Durum | Tablolar |
|---|---|
| Kiracı | `site_profiles` (PK store_id), `site_modules`, `vertical_migrations`, `compliance_profiles`, `site_policy_snapshots` (değişmez) |
| Uyum kayıtları | `compliance_lint_reports` (yalnızca eklemeli, hash zincirli), `compliance_findings`, `compliance_actions`, `render_suppressions`, `compliance_evidence`, `compliance_exports` |
| Platform | `vertical_pack_releases`, `rule_pack_releases`, `tariff_tables` + `tariff_lines` |

**Kimlik ve kişiler:** `business_identities` (PK store_id), `site_locations`, `people`, `licences`.

**İçerik:**

- `content_types` (store_id boşsa platform tanımı)
- `content_entries`
- `record_versions` (değişmez)
- `record_slugs`
- `content_references`
- `content_search`
- `releases` + `release_items`
- `review_requests`, `content_comments`, `content_suggestions`
- `preview_links`
- `asset_folders`

**Formlar ve veri:**

- `form_definitions` + `form_submissions`
- `legal_documents` + `legal_document_versions`
- `consent_records` (değişir)
- `sensitive_records` + `sensitive_access_log` (vault)
- `dsar_requests` + `retention_runs`
- `media_consents`

**Hizmet ve ticaret:**

- `lead_pipelines`, `leads`, `lead_items`, `lead_activities`
- `quotes` + `quote_lines`
- `carts.purpose` (quote)
- `products.kind`
- `service_profiles`, `service_assignments`
- `booking_resources`, `availability_rules`, `availability_exceptions`, `calendar_connections`
- `tr_calendar_days` (platform)
- `booking_policies`, `bookings`, `booking_segments`
- `group_sessions`, `session_enrollments`, `waitlist_entries`, `queue_tickets`
- `order_lines.line_kind`, `source_type`, `source_id`
- `price_history`
- `entitlement_terms`, `entitlements`, `entitlement_ledger`
- `subscriptions`, `payment_method_tokens` (yalnızca sağlayıcı referansı, marka ve son 4 hane; son kullanma tarihi **tutulmaz**)
- `e_documents`
- `reviews`, `review_invitations`
- `message_templates`, `message_deliveries`
- `portal_spaces`, `portal_documents`, `portal_requests`, `portal_messages`, `customer_mfa_factors`
- `trade_accounts`

**Dikey tablolar:**

- `listing_types`, `listings`, `listing_verifications`
- `menus`, `menu_item_profiles`
- `course_lessons`
- `donation_campaigns`, `donation_receipts`

**GEO ve içe aktarma:** `entity_fact_snapshots`, `yanit_accuracy_findings`, `site_import_runs`, `not_found_hits`.

**Değişen mevcut tablolar:**

- `stores`: `modules_version`, `policy_version`
- `pages`: `template_key`, `page_type` + `template`
- `section_definitions`: `module`, `policy_tags`
- `publications`: `policy_snapshot_id`, `lint_report_id`
- `redirects`: `match_type` (exact | prefix), 410
- `role_assignments`: yeni roller content_editor, author, reviewer, compliance_officer

---

## 10. Admin CMS deneyimi (apps/admin)

- **Kabuk.** Next.js; Linear ve Stripe tarzı navigasyon, ⌘K komut paleti.
- **İçerik listeleri.** Tablo ve pano görünümü, kayıtlı filtreler, toplu işlemler, dil tamamlanma oranı, lint skoru.
- **Girdi editörü:**
  - Tiptap tabanlı richDoc: slash menüsü, sürükle bırak tutamakları, markdown kısayolları, temiz yapıştırma.
  - JSON Schema'dan üretilen alan formları.
  - **SEO ve GEO denetçisi:** SERP, WhatsApp ve OG önizlemesi, JSON-LD ağacı.
  - Çeviri sekmesi.
  - Geçmiş zaman çizelgesi ve fark görünümü (mevcut `draft_revisions` geri al/yinele).
  - Yayın öncesi kontrol listesi.
- **Canlı önizleme.** Bölünmüş ekran, postMessage yamaları; paylaşılabilir önizleme bağlantıları.
- **Görsel sayfa editörü.** Bölüm kütüphanesi ve sektör preset'leri. Yasaklı bölümler paletde görünür ama **devre dışıdır**; yanında kaynak ve sade Türkçe gerekçe yazar.
- **Medya kütüphanesi.** Klasörler, etiketler, arama, odak noktası, kullanım başına alt metin, "kullanıldığı yerler", kimliği koruyarak değiştirme, AI alt metin önerisi.
- **Formlar.** Form oluşturucu ve gönderim kutusu.
- **Onboarding.** "İşiniz ne?" ile başlar, İşletme profili sihirbazıyla devam eder, paket onay ekranıyla biter.
- **AI.** Yalnızca taslak üretir; kaynak rozeti gösterir. `[[DOĞRULA]]` yer tutucuları yayını engeller. Kotalar uygulanır. Özel nitelikli veri AI'a asla gönderilmez.

---

## 11. Fazlar

Faz sınırları kesindir. Faz 9'a Faz 1–6'nın benimsendiği görülmeden başlanmaz.

### Faz 0 — Temel ve düzeltmeler

- **Dil kaydı:** `commerce-core/src/locales.ts`. `LOCALES` ve `SUPPORTED_LOCALES` buradan türetilir, `assertStoreLocales` eklenir, `<html lang dir>` doğru üretilir, mantıksal CSS'e geçilir.
- **Paket taşıma:** Alan primitifleri `packages/content`'e taşınır ve theme-engine'den yeniden dışa aktarılır. Tek sanitizer.
- **Düzeltmeler:**
  - `live.ts` sayfayı yayınlanmış sürümün handle'ı ile çözer.
  - `switchPointer`, `storefront.publication_switched` olayını yayar; yönlendirme değişikliği `redirect.changed` yayar; ikisi de edge içerik sürümüne bağlanır.
  - OG görseli `seo.imageAssetId`'den gelir.
  - Her sayfada tek H1.
  - hreflang yalnızca içeriği olan dillerde; sitemap `lastmod` gerçek tarih.
- **`price_history`:** "Önceki fiyat" hesaplaması mevcut e-ticaret kiracıları için; yasal zorunluluk.

### Faz 1 — Site ve içerik çekirdeği *(ilk teslim)*

- **`packages/site`:**
  - `site_profiles`, `site_modules`, `ModuleRegistry`
  - preset'ler: static, corporate, ecommerce
  - `assertModule`; StoreSnapshot'a `modules` ve `policyVersion` eklenir
- **`business_identities`, `site_locations`:** statutory-info, business-facts, opening-hours ve locations-map bölümleri.
- **theme-engine:**
  - Tüm bölümlere `module`, `policyTags` ve `propTags`.
  - `template` sayfa tipi ve `tpl:` yerleşimleri.
  - `validatePageContent(input, placement, policy)`.
  - Rota tablosu (`routes.ts`).
  - `bootstrapStorefront(preset)`: commerce modülü yoksa `/cart` ve `/products` 404 döner.
- **`packages/content`:**
  - FieldDef'ten zod ve JSON Schema'ya derleyici; tip kaydı.
  - richDoc şeması ve oluşturucuları (HTML, Markdown, düz metin, başlık ağacı, soru-cevap); `htmlToDoc`.
  - Tablolar: `content_types`, `content_entries`, `record_versions`, `record_slugs`, `content_references`.
  - Girdi servisi: `expectedRevision` ile oluştur ve güncelle; yayınla, yayından kaldır, zamanla, arşivle, çoğalt.
  - `draft_revisions` üzerinde `entry` kaynağı; geri al ve yinele çalışır.
  - Slug değişince 301.
- **İlk yerleşik tipler:** `post` (+ kategori ve etiket), `service`, `faq_item`, `legal_document`, `document`.
- **Bölümler:** entry-main, entry-index-main, entry-list, faq@2, rich-text@2.
- **Admin API:** `/v1/content/*` ve `/v1/site/*`; worker zamanlama döngüsü girdileri de kapsar.
- **Ne teslim edilir:** Statik ve kurumsal siteler; blog, hizmet sayfaları, SSS ve yasal sayfalar; çok dilli (tr, en, de, ar, ru…).

### Faz 2 — Uyum çekirdeği, formlar, GEO

- **`packages/compliance` v1:**
  - Kural paketleri: `baseline-tr`, `kvkk-core`, `ticari-reklam`, `mesafeli-satis`.
  - Anlık görüntü derleme; Türkçe lint motoru.
  - Hash zincirli raporlar.
  - `publishCore`, `rollbackTo` ve zamanlanmış yayına kapılar.
- **`packages/forms`:**
  - Form tanımları ve gönderimler; `legal_documents` sürümleri.
  - Ayrık rıza; Turnstile, honeypot, hız sınırı.
  - Saklama süresi worker'ı; DSAR kutusu.
- **Vault v1:** Veritabanı içinde, zarf şifrelemeli (`@altyapi/secrets`).
- **`packages/verticals` v1:** Manifest şeması ve senkronizasyon; "İşiniz ne?" onboarding'i; `platform.baseline`, `statik.kisisel-landing` ve `eticaret.perakende` paketleri (bugünkü varsayılanlar bu paketin şablon oluşturucusu olur).
- **`geo` v1:**
  - `@graph` oluşturucu ve tip eşleyicileri; parite lint'i.
  - Tip başına sitemap, RSS, llms.txt, `.md` alternatifleri.
  - robots.txt AI crawler politikası; IndexNow.
- **Bölümler:** form@1, cta-band, stats, steps, gallery, document-list.

### Faz 3 — Kurumsal ve B2B (ergentekstil'e hazır)

- **`packages/people`:** `people` tablosu, `licences` (şimdilik yalnızca ISO ve OEKO-TEX gibi sertifikalar doğrulanır), team-grid ve person-profile bölümleri.
- **`packages/leads`:**
  - Pipeline, lead, aktivite.
  - `carts.purpose='quote'` ile RFQ teklif sepeti. Terk edilmiş sepet işi, kupon, kargo hesabı ve checkout bu sepeti **açıkça** dışlar.
  - Satış kutusu e-posta bildirimleri.
- **Katalog:** `priceVisibility`, `minOrderQty`, `leadTimeDays`; Offer JSON-LD'si bastırılır; product-main'de "Teklif iste".
- **Tipler:** `project`/`case_study`, `certificate`, `job_posting` (CV'ler vault'ta), `partner`.
- **Paketler:** `kurumsal.genel`, `b2b.uretici-toptan`, `saas-teknoloji`.
- **`site-import` v1:**
  - Sitemap taraması; 301'ler `redirects` ve `record_slugs`'a.
  - Sayfa ve girdi taslakları.
  - Yayın öncesi uyum raporu.
- **Ekosistem v1.1:** İçerik türleri ve marka bilgileri Yanıt'a gider.

### Faz 4 — Admin CMS uygulaması *(Faz 1 ile paralel başlar)*

Bölüm 10'daki kabuk, editörler, önizleme, medya kütüphanesi ve form oluşturucu.

### Faz 5 — Hizmet: randevu, ödeme ve teklif

- **Hizmet ürünleri:**
  - `products.kind='service'` (`package` ve `gift_card` değerleri de ayrılır), `service_profiles`.
  - Uygunluk kuralları; `tr_calendar_days`.
  - `bookings` ve `booking_segments` (btree_gist EXCLUDE kısıtıyla çakışma engeli); TTL'li tutmalar.
  - İptal ve no-show politikaları; magic-link ile randevu yönetimi.
- **Payables:**
  - `orders.source`: booking, quote, pay_link.
  - Satır türleri; sağlayıcı yetenek bayrakları (PayTR, iyzico).
  - Kapora ve ön ödeme.
- **Teklifler:** PDF, kabul bağlantısı, ödeme siparişine dönüşüm. Kârmatik `profit/quote` marj koruması uygulanır.
- **`packages/notifications`:**
  - SMS (Netgsm, İleti Merkezi, Verimor), e-posta, WhatsApp şablonları.
  - İYS kontrolü; hatırlatmalar; EVET/İPTAL yanıtları.
  - Google ve Microsoft takvim senkronizasyonu.
- **Paketler:** `guzellik.kuafor-salon` (çekirdek), `yerel-hizmetler`, `egitim` (özel ders).

### Faz 6 — Düzenlenen meslekler

- **Lisans doğrulama:** Platform personeliyle doğrulama kuyruğu ve sicil bağlantıları; `compliance_profiles.strictMode`.
- **Kural paketleri:** `tbb-ryy`, `ak-1136`, `turmob-hrry`, `huak-m10`, `noterlik-yon`, `vekil-yon-m19`. Hukuk danışmanı onayıyla `warn` → `block`.
- **Bölümler ve tipler:**
  - identity-registry bölümü.
  - `practice_area` (kilitli slug'lar), `publication`, `announcement`, `sirkuler`, `vergi_takvimi`.
- **Ücret ve kayıtlar:**
  - Tarife tabanları (AAÜT, SMMM tarifesi).
  - `conflict_parties`; başvuru formunda özel nitelikli veri koruması.
- **Tracking ve portal:**
  - Tracking kilidi, çerezsiz analitik varsayılanı.
  - Portal v1: müvekkil ve mükellef alanı, MFA.
  - e-SMM ve e-Arşiv.
- **Kanıt ve kontrol:**
  - HTML kanıt anlık görüntüleri; uyum dosyası.
  - Acil kapatma düğmesi; kural değişince drift taraması; iki kişilik onay.
  - AI politika ön kontrolü.
  - Yanıt doğruluk modu.
- **Paketler:** `hukuk.avukat`, `hukuk.arabulucu`, `mali.smmm-ymm`, `hukuk.noter`, `fikri-mulkiyet.patent-marka-vekili`.

### Faz 7 — CMS iş akışı, AI, arama, içe aktarma

- **İş akışı:**
  - Sabitlenmiş revizyonlarla sürümler (`releases`); perspektif önizlemesi, takvim.
  - `review_requests` ve zorunlu onay; içerik rolleri.
  - Varlık göstergesi ve yumuşak kilit; revizyon sıkıştırma işi.
- **AI eylemleri:**
  - Action Registry'de CMS eylemleri: yalnızca taslak, `[[DOĞRULA]]`, yakın kopya tespiti.
  - Toplu alt metin ve koleksiyon çevirisi.
- **Çeviri:** Güncel olmayan çeviri tespiti ve sözlük kalite kontrolü.
- **Yanıt entegrasyonu:** Yanıt öneri kutusu; önce-sonra ölçümü.
- **Arama:** `content_search`, vitrin ve admin araması.
- **Toplu veri:**
  - Toplu tablo düzenleme.
  - CSV, XLSX, WordPress (WXR ve REST), URL taraması ve JSON içe aktarıcılar.
  - 404 izleyici.

### Faz 8 — Üyelik, paket, ders, yorum; 8b sağlık

- **Faz 8:**
  - Haklar defteri (entitlements); hediye kartları (e-ticaret dahil); seans paketleri.
  - Sağlayıcı token'ı ile üyelik; online fesih eşitliği.
  - Grup dersleri, bekleme listesi, sıra fişi.
  - 2026 kurallarına uygun yorumlar; `media_consents`.
  - Paketler: `fitness.pt-salon-studyo`, güzelliğin tamamı, `etkinlik-organizasyon`.
- **Faz 8b:**
  - TR bölgesinde vault arka ucu. Herhangi bir sağlık paketi canlıya çıkmadan önce **şarttır**.
  - Ek-1 onam akışı (SMS-OTP); hekim onaylı yayın.
  - Sağlık sayfa sınıfında tracking kapsamı; MedicalWebPage JSON-LD.
  - Bağlı sağlık turizmi sitesi.
  - Paketler: `saglik.*`.

### Faz 9 — İlanlar, konaklama, eğitim derinliği, dernek, bayi; headless

- İlanlar (EİDS), menüler ve QR masa menüsü, kurslar ve biletli etkinlikler, bağış kampanyaları.
- `trade_accounts` bayi portalı. ergentekstil ihtiyaç duyarsa Faz 3'ten hemen sonra öne alınabilir.
- Otel ve portal bağlayıcıları.
- **Content Delivery API** (`/content/v1`, publishable ve secret token'lar).
- **Giden webhook'lar:** HMAC imzalı, yeniden denemeli, teslim logu.
- Yorumlar ve @bahsetmeler.
- Uzun yazılar için Yjs ile eşzamanlı düzenleme.
- Dinamik prop bağlama (`$bind`).

---

## 12. Riskler

- **Hukuki doğruluk.** Madde numaralarının bir kısmı ikincil kaynaktan geldi. Kademeli yaptırım zararı sınırlar, ama düzenlenen paketlerin ne zaman yayına alınabileceğini hukuk danışmanının zamanı belirler.
- **Kapsam patlaması.** Yaklaşık 20 yeni paket ve 60 yeni tablo var. Faz kapıları kesindir ve her modül tam manifestiyle gelir.
- **Hizmetin ürün olarak modellenmesi.** Feed'ler, pazaryeri bağlayıcıları, stok, arama ve Kârmatik katalog akışı `kind` değerine göre filtrelenmelidir. Atlanan bir filtre, bir "hizmeti" Trendyol'a gönderebilir.
- **Teklif sepetinin sızması.** `carts.purpose='quote'` terk edilmiş sepet işine, kupona, kargo hesabına ya da checkout'a sızabilir. Her yol için açık bir koruma gerekir.
- **İki yayın yolu.** Kafa karıştırabilir. Çözüm: tek "canlı zaman çizelgesi" sorgusu ve panelde net metinler.
- **Veri yerleşimi.** Tüm kiracı kişisel verisi KVKK m.9 kapsamında yurt dışı aktarımdır. Sağlık ve katı hukuk paketleri TR bölgesinde bir vault gerektirir; bu yeni bir hosting ilişkisi demektir.
- **Türkçe lint'te yanlış pozitifler.** Bağlam izin listeleri, `require_ack` katmanı ve "yanlış pozitif bildir" butonu gerekir.
- **Kural değişimi.** Yeni bir kural sürümünden sonraki drift taraması canlı içeriği toplu olarak gizleyebilir. Uyum süresi, bildirim ve kademeli yayın (önce canary siteler) zorunludur.
- **Sıcak yol maliyeti.** Anlık görüntü `(storeId, policyVersion, modulesVersion)` ile önbelleklenir; bastırma kayıtları küçük bir kümede tutulur.
- **Ajans direnci.** Uyum raporu ajans için bir satış aracıdır; gizli bir atlatma yolu yoktur.

---

## 13. Açık kararlar (kurucu onayı gerekir)

1. **Ana spec değişikliği.** Platformun "web sitesi yapan herkes" olarak genelleştirilmesi bu dokümanla kayda geçer. Build prompt'unun e-ticaret fazları paralel sürer.
2. **ergentekstil.com taşıma.** Canlı site ve reposuna dokunulmaz. Faz 3 bittiğinde `site-import` ile bir önizleme kopyası çıkarılır; taşıma ayrıca onaylanır.
3. **Hukuk danışmanı.** Düzenlenen paketlerdeki içerik kurallarını `block` seviyesine çıkarmak için danışman onayı gerekir. Faz 6 öncesinde bütçe ve takvim belirlenmeli.
4. **TR bölgesi hosting.** Sağlık paketleri (Faz 8b) için Türkiye'de barındırılan bir vault arka ucu gerekir.
5. **Yanıt soru havuzu.** `hukuk-danismanlik` sektörü avukat, arabulucu, mali müşavir, noter ve marka-patent olarak bölünmeli; perakende, güzellik, fitness, yeme-içme, yerel hizmet, otomotiv ve dernek sektörleri eklenmeli.
