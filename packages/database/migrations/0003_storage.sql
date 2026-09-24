CREATE TYPE "public"."asset_bucket" AS ENUM('storefront-public', 'merchant-private', 'imports-temporary', 'exports-temporary', 'audit-archive');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('image', 'video', 'document', 'font', 'data', 'other');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('pending_upload', 'uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "asset_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"bucket" "asset_bucket" NOT NULL,
	"object_key" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"status" "asset_status" DEFAULT 'pending_upload' NOT NULL,
	"content_type" text NOT NULL,
	"extension" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"content_hash" text NOT NULL,
	"original_filename" text,
	"alt_text" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"failure_reason" text,
	"uploaded_by_principal_id" uuid,
	"upload_expires_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_references" ADD CONSTRAINT "asset_references_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_references_uq" ON "asset_references" USING btree ("asset_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "asset_references_resource_idx" ON "asset_references" USING btree ("store_id","resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_assets_object_uq" ON "content_assets" USING btree ("bucket","object_key");--> statement-breakpoint
CREATE INDEX "content_assets_store_idx" ON "content_assets" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "content_assets_store_hash_idx" ON "content_assets" USING btree ("store_id","content_hash");--> statement-breakpoint
CREATE INDEX "content_assets_cleanup_idx" ON "content_assets" USING btree ("deleted_at") WHERE "content_assets"."deleted_at" is not null;--> statement-breakpoint
ALTER TABLE "content_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "content_assets" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "asset_references" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "asset_references" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
