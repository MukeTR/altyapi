CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"price_list_id" uuid,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"source" text NOT NULL,
	CONSTRAINT "price_history_nonneg" CHECK ("price_history"."amount_minor" >= 0),
	CONSTRAINT "price_history_period" CHECK ("price_history"."valid_to" is null or "price_history"."valid_to" > "price_history"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_history_lookup_idx" ON "price_history" USING btree ("store_id","variant_id","currency","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "price_history_open_uq" ON "price_history" USING btree ("price_list_id","variant_id") WHERE "price_history"."valid_to" is null;--> statement-breakpoint
ALTER TABLE "price_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "price_history" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
-- Backfill: one open period per current quantity-1 price of an active list, starting now.
-- What applied before is unknown, so a backfilled entry never shows a previous price while
-- its amount stays the same: its discount start is the deploy time, and no history covers
-- the lookback window before it. The next change of its amount opens a normal period (for a
-- scheduled list, a window starting a full lookback window after deploy also qualifies).
-- Idempotent: entries that already have an open period are skipped.
INSERT INTO "price_history" ("id", "organization_id", "store_id", "variant_id", "price_list_id", "currency", "amount_minor", "valid_from", "source")
SELECT gen_random_uuid(), ma.organization_id, ma.store_id, ma.variant_id, ma.price_list_id, pl.currency, ma.amount, now(), 'backfill'
  FROM "money_amounts" ma
  JOIN "price_lists" pl ON pl.id = ma.price_list_id AND pl.is_active
 WHERE ma.min_quantity = 1
   AND NOT EXISTS (
     SELECT 1 FROM "price_history" ph
      WHERE ph.price_list_id = ma.price_list_id AND ph.variant_id = ma.variant_id AND ph.valid_to IS NULL
   );
