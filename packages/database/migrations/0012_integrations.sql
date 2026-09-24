CREATE TYPE "public"."integration_discrepancy_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."external_order_status" AS ENUM('pending_payment', 'awaiting_approval', 'processing', 'ready_to_ship', 'shipped', 'delivered', 'undelivered', 'cancelled', 'returned', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('integrator', 'marketplace', 'feed');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('active', 'paused', 'error');--> statement-breakpoint
CREATE TYPE "public"."data_ownership_domain" AS ENUM('stock', 'price', 'content', 'order_fulfillment');--> statement-breakpoint
CREATE TYPE "public"."integration_sync_run_status" AS ENUM('running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "data_ownership" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"domain" "data_ownership_domain" NOT NULL,
	"owner_connection_id" uuid,
	"external_owner_label" text,
	"updated_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_ownership_store_id_domain_pk" PRIMARY KEY("store_id","domain")
);
--> statement-breakpoint
CREATE TABLE "external_listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"sku" text,
	"barcode" text,
	"title" text,
	"stock" integer,
	"price" bigint,
	"list_price" bigint,
	"currency" char(3),
	"active" boolean,
	"variant_id" uuid,
	"external_updated_at" timestamp with time zone,
	"payload_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_number" text,
	"channel" text,
	"raw_status" text,
	"status" "external_order_status" DEFAULT 'unknown' NOT NULL,
	"currency" char(3) NOT NULL,
	"total" bigint,
	"item_count" integer DEFAULT 0 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shipping" jsonb,
	"customer" jsonb,
	"ordered_at" timestamp with time zone,
	"external_updated_at" timestamp with time zone,
	"payload_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"name" text NOT NULL,
	"status" "integration_status" DEFAULT 'active' NOT NULL,
	"credentials" jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session" jsonb,
	"cursors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"poll_interval_minutes" integer DEFAULT 15 NOT NULL,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_discrepancies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid,
	"sku" text NOT NULL,
	"field" text NOT NULL,
	"values" jsonb NOT NULL,
	"status" "integration_discrepancy_status" DEFAULT 'open' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integration_sync_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"status" "integration_sync_run_status" DEFAULT 'running' NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"has_more" boolean DEFAULT false NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "data_ownership" ADD CONSTRAINT "data_ownership_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_ownership" ADD CONSTRAINT "data_ownership_owner_connection_id_integration_connections_id_fk" FOREIGN KEY ("owner_connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_orders" ADD CONSTRAINT "external_orders_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_listings_uq" ON "external_listings" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "external_listings_sku_idx" ON "external_listings" USING btree ("store_id","sku");--> statement-breakpoint
CREATE INDEX "external_listings_barcode_idx" ON "external_listings" USING btree ("store_id","barcode");--> statement-breakpoint
CREATE INDEX "external_listings_variant_idx" ON "external_listings" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_orders_uq" ON "external_orders" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "external_orders_store_idx" ON "external_orders" USING btree ("store_id","ordered_at");--> statement-breakpoint
CREATE INDEX "external_orders_status_idx" ON "external_orders" USING btree ("store_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_name_uq" ON "integration_connections" USING btree ("store_id","provider","name");--> statement-breakpoint
CREATE INDEX "integration_connections_due_idx" ON "integration_connections" USING btree ("status","next_sync_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_discrepancies_open_uq" ON "integration_discrepancies" USING btree ("store_id","sku","field") WHERE "integration_discrepancies"."status" <> 'resolved';--> statement-breakpoint
CREATE INDEX "integration_discrepancies_store_idx" ON "integration_discrepancies" USING btree ("store_id","status","detected_at");--> statement-breakpoint
CREATE INDEX "integration_sync_runs_connection_idx" ON "integration_sync_runs" USING btree ("connection_id","started_at");--> statement-breakpoint
ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_connections" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_sync_runs" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "external_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "external_orders" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "external_listings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "external_listings" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "data_ownership" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "data_ownership" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "integration_discrepancies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_discrepancies" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
