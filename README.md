# altyapi.io

Multi-tenant, AI-native e-ticaret altyapısı. Ürün ve mimari kararlar için
[`altyapi_io_master_build_prompt.md`](./altyapi_io_master_build_prompt.md) dosyasına bakın.

## Yapı

```text
apps/
  api/            Fastify commerce API (OpenAPI: /docs)
packages/
  config/         Typed environment şemaları (Zod)
  observability/  Logger, correlation context, tracing
  commerce-core/  Shared kernel: hatalar, ID, money (minor unit), pagination
  database/       Drizzle schema, migrations, tenant/platform transaction yardımcıları, RLS
  auth/           Kullanıcı, oturum, argon2id, rol/izin matrisi
  tenancy/        Organization, store, member servisleri ve StoreContext
  events/         Transactional outbox ve event kataloğu
  audit/          Redaksiyonlu audit log yazıcısı
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
