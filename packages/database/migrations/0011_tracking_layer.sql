CREATE TYPE "public"."conversion_delivery_status" AS ENUM('sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "conversion_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"event_name" text NOT NULL,
	"event_id" text NOT NULL,
	"order_id" uuid,
	"status" "conversion_delivery_status" NOT NULL,
	"http_status" integer,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_configs" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"gtm_container_id" text,
	"ga4_measurement_id" text,
	"google_ads_conversion_id" text,
	"google_ads_purchase_label" text,
	"meta_pixel_id" text,
	"tiktok_pixel_id" text,
	"meta_capi_enabled" boolean DEFAULT false NOT NULL,
	"tiktok_events_api_enabled" boolean DEFAULT false NOT NULL,
	"ga4_measurement_protocol_enabled" boolean DEFAULT false NOT NULL,
	"secrets" jsonb,
	"consent_policy_version" text DEFAULT '1' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracking_configs" ADD CONSTRAINT "tracking_configs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_deliveries_uq" ON "conversion_deliveries" USING btree ("store_id","destination","event_id");--> statement-breakpoint
CREATE INDEX "conversion_deliveries_store_idx" ON "conversion_deliveries" USING btree ("store_id","created_at");--> statement-breakpoint
ALTER TABLE "tracking_configs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tracking_configs" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "conversion_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "conversion_deliveries" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
