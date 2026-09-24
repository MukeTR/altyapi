# altyapi.io

Multi-tenant, AI-native e-ticaret altyapısı. Ürün ve mimari kararlar için
[`altyapi_io_master_build_prompt.md`](./altyapi_io_master_build_prompt.md) dosyasına bakın.

## Yapı

```text
apps/
  api/            Fastify commerce API (OpenAPI: /docs)
  worker/         Outbox publisher, queue consumer'ları, scheduler
  edge-router/    Cloudflare Worker: Host → mağaza çözümleme ve yönlendirme
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
