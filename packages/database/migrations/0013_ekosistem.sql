CREATE TYPE "public"."ekosistem_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ekosistem_link_role" AS ENUM('issuer', 'acceptor');--> statement-breakpoint
CREATE TYPE "public"."ekosistem_link_status" AS ENUM('pending', 'awaiting_approval', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."ekosistem_peer_product" AS ENUM('karmatik', 'yanit');--> statement-breakpoint
CREATE TYPE "public"."ekosistem_tombstone_resource" AS ENUM('product', 'order', 'content');--> statement-breakpoint
CREATE TYPE "public"."karmatik_suggestion_local_status" AS ENUM('new', 'applied', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."yanit_opportunity_local_status" AS ENUM('new', 'drafted', 'dismissed');--> statement-breakpoint
CREATE TABLE "ekosistem_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"peer_product" "ekosistem_peer_product" NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"claim_nonce_hash" text,
	"link_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ekosistem_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ref" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"status" "ekosistem_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ekosistem_event_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ref" text,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ekosistem_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"peer_product" "ekosistem_peer_product" NOT NULL,
	"role" "ekosistem_link_role" NOT NULL,
	"status" "ekosistem_link_status" DEFAULT 'pending' NOT NULL,
	"secret" jsonb NOT NULL,
	"previous_secret" jsonb,
	"previous_secret_valid_until" timestamp with time zone,
	"rotate_nonce_hash" text,
	"rotated_at" timestamp with time zone,
	"granted_scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"peer_scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"peer_account" jsonb NOT NULL,
	"claim_nonce_hash" text,
	"pending_expires_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"revoke_delivery" jsonb,
	"cursors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_pull_at" timestamp with time zone,
	"last_error" text,
	"consecutive_link_invalid" integer DEFAULT 0 NOT NULL,
	"last_link_invalid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ekosistem_tombstones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"resource" "ekosistem_tombstone_resource" NOT NULL,
	"ref" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "karmatik_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"channel" text NOT NULL,
	"store_label" text,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"barcode" text,
	"source_ref" text,
	"variant_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"currency" char(3),
	"impact_monthly" bigint,
	"peer_created_at" timestamp with time zone NOT NULL,
	"peer_updated_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "karmatik_competitor_prices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"source_ref" text,
	"barcode" text,
	"variant_id" uuid,
	"source" text NOT NULL,
	"seller" text,
	"currency" char(3) NOT NULL,
	"price" bigint NOT NULL,
	"url" text,
	"in_stock" boolean,
	"observed_at" timestamp with time zone NOT NULL,
	"peer_updated_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "karmatik_price_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"source_ref" text,
	"variant_id" uuid,
	"channel" text NOT NULL,
	"barcode" text,
	"currency" char(3) NOT NULL,
	"current_price" bigint NOT NULL,
	"suggested_price" bigint NOT NULL,
	"reason" text NOT NULL,
	"competitor_min_price" bigint,
	"confidence_bps" integer,
	"peer_status" text NOT NULL,
	"peer_created_at" timestamp with time zone NOT NULL,
	"peer_updated_at" timestamp with time zone NOT NULL,
	"local_status" "karmatik_suggestion_local_status" DEFAULT 'new' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_id" uuid,
	"decision_applied_price" bigint,
	"decision_delivery_status" "ekosistem_delivery_status",
	"decision_attempts" integer DEFAULT 0 NOT NULL,
	"decision_next_attempt_at" timestamp with time zone,
	"decision_last_error" text,
	"decision_delivered_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "karmatik_profit_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"source_ref" text,
	"variant_id" uuid,
	"channel" text,
	"store_label" text,
	"barcode" text,
	"sku" text,
	"currency" char(3),
	"price" bigint,
	"net_profit" bigint,
	"margin_bps" integer,
	"floor_price" bigint,
	"floor_basis" text,
	"min_margin_bps" integer,
	"safe_discount_bps" integer,
	"break_even_price" bigint,
	"loss_making" boolean,
	"basis" text,
	"missing" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"summary_only" boolean DEFAULT false NOT NULL,
	"peer_updated_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_brand_profiles" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"description" text,
	"topics" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"social_profiles" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yanit_citations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"window_days" integer NOT NULL,
	"domain" text NOT NULL,
	"count" integer NOT NULL,
	"share_bps" integer,
	"sample_urls" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yanit_gaps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"query" text NOT NULL,
	"providers" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"competitors_mentioned" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"priority" integer NOT NULL,
	"intent" text,
	"last_run_at" timestamp with time zone,
	"as_of" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yanit_opportunities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"kind" text NOT NULL,
	"source_kind" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"query" text,
	"target_url" text,
	"impact" text NOT NULL,
	"peer_status" text NOT NULL,
	"peer_created_at" timestamp with time zone NOT NULL,
	"peer_updated_at" timestamp with time zone NOT NULL,
	"local_status" "yanit_opportunity_local_status" DEFAULT 'new' NOT NULL,
	"draft_page_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yanit_visibility_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"window_days" integer NOT NULL,
	"valid_runs" integer NOT NULL,
	"runs_with_brand" integer NOT NULL,
	"visibility_bps" integer,
	"share_of_voice_bps" integer,
	"previous_bps" integer,
	"delta_bps" integer,
	"last_measured_at" timestamp with time zone,
	"as_of" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_lines" ALTER COLUMN "tax_rate_bps" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "order_lines" ALTER COLUMN "tax_rate_bps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "variant_costs" ADD COLUMN "tax_included" boolean;--> statement-breakpoint
ALTER TABLE "variant_costs" ADD COLUMN "tax_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "ekosistem_codes" ADD CONSTRAINT "ekosistem_codes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ekosistem_codes" ADD CONSTRAINT "ekosistem_codes_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ekosistem_deliveries" ADD CONSTRAINT "ekosistem_deliveries_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ekosistem_event_receipts" ADD CONSTRAINT "ekosistem_event_receipts_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ekosistem_links" ADD CONSTRAINT "ekosistem_links_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ekosistem_tombstones" ADD CONSTRAINT "ekosistem_tombstones_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "karmatik_alerts" ADD CONSTRAINT "karmatik_alerts_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "karmatik_competitor_prices" ADD CONSTRAINT "karmatik_competitor_prices_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "karmatik_price_suggestions" ADD CONSTRAINT "karmatik_price_suggestions_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "karmatik_profit_snapshots" ADD CONSTRAINT "karmatik_profit_snapshots_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_brand_profiles" ADD CONSTRAINT "store_brand_profiles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yanit_citations" ADD CONSTRAINT "yanit_citations_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yanit_gaps" ADD CONSTRAINT "yanit_gaps_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yanit_opportunities" ADD CONSTRAINT "yanit_opportunities_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yanit_opportunities" ADD CONSTRAINT "yanit_opportunities_draft_page_id_pages_id_fk" FOREIGN KEY ("draft_page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yanit_visibility_snapshots" ADD CONSTRAINT "yanit_visibility_snapshots_link_id_ekosistem_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."ekosistem_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ekosistem_codes_hash_uq" ON "ekosistem_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "ekosistem_codes_store_idx" ON "ekosistem_codes" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ekosistem_deliveries_uq" ON "ekosistem_deliveries" USING btree ("link_id","event_id");--> statement-breakpoint
CREATE INDEX "ekosistem_deliveries_due_idx" ON "ekosistem_deliveries" USING btree ("next_attempt_at") WHERE "ekosistem_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "ekosistem_event_receipts_uq" ON "ekosistem_event_receipts" USING btree ("link_id","event_id");--> statement-breakpoint
CREATE INDEX "ekosistem_event_receipts_pending_idx" ON "ekosistem_event_receipts" USING btree ("link_id","type","ref") WHERE "ekosistem_event_receipts"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "ekosistem_event_receipts_received_idx" ON "ekosistem_event_receipts" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ekosistem_links_store_peer_uq" ON "ekosistem_links" USING btree ("store_id","peer_product") WHERE "ekosistem_links"."status" <> 'revoked';--> statement-breakpoint
CREATE INDEX "ekosistem_links_pending_idx" ON "ekosistem_links" USING btree ("pending_expires_at") WHERE "ekosistem_links"."status" in ('pending', 'awaiting_approval');--> statement-breakpoint
CREATE INDEX "ekosistem_links_active_idx" ON "ekosistem_links" USING btree ("status","last_pull_at");--> statement-breakpoint
CREATE INDEX "ekosistem_links_store_idx" ON "ekosistem_links" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ekosistem_tombstones_uq" ON "ekosistem_tombstones" USING btree ("store_id","resource","ref");--> statement-breakpoint
CREATE INDEX "ekosistem_tombstones_since_idx" ON "ekosistem_tombstones" USING btree ("store_id","resource","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "karmatik_alerts_uq" ON "karmatik_alerts" USING btree ("link_id","ref");--> statement-breakpoint
CREATE INDEX "karmatik_alerts_store_idx" ON "karmatik_alerts" USING btree ("store_id","resolved_at","peer_updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "karmatik_competitor_prices_uq" ON "karmatik_competitor_prices" USING btree ("link_id","ref");--> statement-breakpoint
CREATE INDEX "karmatik_competitor_prices_variant_idx" ON "karmatik_competitor_prices" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "karmatik_price_suggestions_uq" ON "karmatik_price_suggestions" USING btree ("link_id","ref");--> statement-breakpoint
CREATE INDEX "karmatik_price_suggestions_store_idx" ON "karmatik_price_suggestions" USING btree ("store_id","local_status","peer_updated_at");--> statement-breakpoint
CREATE INDEX "karmatik_price_suggestions_decision_due_idx" ON "karmatik_price_suggestions" USING btree ("decision_next_attempt_at") WHERE "karmatik_price_suggestions"."decision_delivery_status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "karmatik_profit_snapshots_uq" ON "karmatik_profit_snapshots" USING btree ("link_id","ref");--> statement-breakpoint
CREATE INDEX "karmatik_profit_snapshots_variant_idx" ON "karmatik_profit_snapshots" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "karmatik_profit_snapshots_source_idx" ON "karmatik_profit_snapshots" USING btree ("store_id","source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "yanit_citations_uq" ON "yanit_citations" USING btree ("link_id","window_days","domain");--> statement-breakpoint
CREATE INDEX "yanit_citations_store_idx" ON "yanit_citations" USING btree ("store_id","window_days","count");--> statement-breakpoint
CREATE UNIQUE INDEX "yanit_gaps_uq" ON "yanit_gaps" USING btree ("link_id","ref");--> statement-breakpoint
CREATE INDEX "yanit_gaps_store_idx" ON "yanit_gaps" USING btree ("store_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "yanit_opportunities_uq" ON "yanit_opportunities" USING btree ("link_id","ref");--> statement-breakpoint
CREATE INDEX "yanit_opportunities_store_idx" ON "yanit_opportunities" USING btree ("store_id","local_status","peer_updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "yanit_visibility_snapshots_uq" ON "yanit_visibility_snapshots" USING btree ("link_id","window_days","as_of");--> statement-breakpoint
CREATE INDEX "yanit_visibility_snapshots_store_idx" ON "yanit_visibility_snapshots" USING btree ("store_id","window_days","as_of");--> statement-breakpoint
ALTER TABLE "ekosistem_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ekosistem_links" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "ekosistem_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ekosistem_codes" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "ekosistem_event_receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ekosistem_event_receipts" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "ekosistem_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ekosistem_deliveries" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "ekosistem_tombstones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ekosistem_tombstones" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "store_brand_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "store_brand_profiles" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "karmatik_profit_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "karmatik_profit_snapshots" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "karmatik_price_suggestions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "karmatik_price_suggestions" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "karmatik_alerts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "karmatik_alerts" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "karmatik_competitor_prices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "karmatik_competitor_prices" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "yanit_visibility_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "yanit_visibility_snapshots" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "yanit_gaps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "yanit_gaps" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "yanit_opportunities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "yanit_opportunities" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "yanit_citations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "yanit_citations" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
