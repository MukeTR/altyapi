CREATE TYPE "public"."redirect_match_type" AS ENUM('exact', 'prefix');--> statement-breakpoint
CREATE TYPE "public"."business_legal_form" AS ENUM('sahis', 'limited', 'anonim', 'kooperatif', 'dernek', 'vakif', 'kamu', 'diger');--> statement-breakpoint
CREATE TYPE "public"."page_url_style" AS ENUM('prefixed', 'root');--> statement-breakpoint
CREATE TYPE "public"."site_kind" AS ENUM('static', 'corporate', 'service', 'ecommerce', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."site_location_status" AS ENUM('active', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."site_module_source" AS ENUM('preset', 'pack', 'merchant', 'policy');--> statement-breakpoint
CREATE TYPE "public"."site_module_status" AS ENUM('enabled', 'disabled', 'locked_on', 'locked_off');--> statement-breakpoint
CREATE TYPE "public"."untranslated_policy" AS ENUM('hide', 'fallback_noindex');--> statement-breakpoint
CREATE TYPE "public"."content_entry_status" AS ENUM('draft', 'scheduled', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."content_reference_state" AS ENUM('draft', 'live');--> statement-breakpoint
CREATE TYPE "public"."content_reference_target" AS ENUM('entry', 'page', 'product', 'collection', 'asset', 'location');--> statement-breakpoint
CREATE TYPE "public"."content_type_kind" AS ENUM('collection', 'singleton', 'taxonomy');--> statement-breakpoint
CREATE TYPE "public"."content_type_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TYPE "public"."page_type" ADD VALUE 'template';--> statement-breakpoint
CREATE TABLE "business_identities" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_name" text,
	"trade_name" text,
	"legal_form" "business_legal_form",
	"mersis_no" text,
	"trade_registry_no" text,
	"tax_office" text,
	"tax_number" text,
	"tax_number_public" boolean DEFAULT false NOT NULL,
	"kep_address" text,
	"chamber" text,
	"chamber_rules_url" text,
	"phone" text,
	"email" text,
	"address" jsonb,
	"founding_date" date,
	"logo_asset_id" uuid,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"same_as" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" jsonb NOT NULL,
	"slug" text NOT NULL,
	"address" jsonb,
	"geo" jsonb,
	"phone" text,
	"email" text,
	"whatsapp" text,
	"opening_hours" jsonb DEFAULT '{"weekly":[],"specialDays":[],"byAppointment":false}'::jsonb NOT NULL,
	"service_area" jsonb,
	"is_primary" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "site_location_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_modules" (
	"store_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"status" "site_module_status" NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "site_module_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_modules_store_id_module_key_pk" PRIMARY KEY("store_id","module_key"),
	CONSTRAINT "site_modules_key_format" CHECK ("site_modules"."module_key" ~ '^[a-z][a-z0-9_-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "site_profiles" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "site_kind" NOT NULL,
	"primary_pack" text,
	"addon_packs" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"page_url_style" "page_url_style" DEFAULT 'prefixed' NOT NULL,
	"untranslated_policy" "untranslated_policy" DEFAULT 'hide' NOT NULL,
	"ai_crawlers" jsonb DEFAULT '{"training":"deny"}'::jsonb NOT NULL,
	"verification_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"parent_id" uuid,
	"draft_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_slugs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"published_revision" integer,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"status" "content_entry_status" DEFAULT 'draft' NOT NULL,
	"live_version_id" uuid,
	"published_locales" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"translation_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"publish_at" timestamp with time zone,
	"unpublish_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"first_published_at" timestamp with time zone,
	"content_modified_at" timestamp with time zone,
	"created_by_principal_id" uuid,
	"updated_by_principal_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_entries_live_consistency" CHECK (("content_entries"."status" = 'published') = ("content_entries"."live_version_id" is not null)),
	CONSTRAINT "content_entries_scheduled_has_time" CHECK ("content_entries"."status" <> 'scheduled' or "content_entries"."publish_at" is not null),
	CONSTRAINT "content_entries_archived_consistency" CHECK (("content_entries"."status" = 'archived') = ("content_entries"."archived_at" is not null)),
	CONSTRAINT "content_entries_not_own_parent" CHECK ("content_entries"."parent_id" is null or "content_entries"."parent_id" <> "content_entries"."id")
);
--> statement-breakpoint
CREATE TABLE "content_references" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"state" "content_reference_state" NOT NULL,
	"target_kind" "content_reference_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"field_path" text NOT NULL,
	CONSTRAINT "content_references_pk" PRIMARY KEY("source_type","source_id","state","target_kind","target_id","field_path")
);
--> statement-breakpoint
CREATE TABLE "content_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"key" text NOT NULL,
	"builtin_key" text,
	"builtin_version" integer,
	"kind" "content_type_kind" NOT NULL,
	"labels" jsonb NOT NULL,
	"route_prefix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "content_type_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_types_key_format" CHECK ("content_types"."key" ~ '^[a-z][a-z0-9_]{0,47}$'),
	CONSTRAINT "content_types_builtin_pair" CHECK (("content_types"."builtin_key" is null) = ("content_types"."builtin_version" is null))
);
--> statement-breakpoint
CREATE TABLE "record_slugs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"locale" text NOT NULL,
	"slug" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"derived" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locales" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"live_from" timestamp with time zone DEFAULT now() NOT NULL,
	"live_to" timestamp with time zone,
	"source_revision" integer,
	"published_by_principal_id" uuid,
	"policy_snapshot_id" uuid,
	"lint_report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_versions_version_positive" CHECK ("record_versions"."version" >= 1),
	CONSTRAINT "record_versions_live_period" CHECK ("record_versions"."live_to" is null or "record_versions"."live_to" >= "record_versions"."live_from")
);
--> statement-breakpoint
ALTER TABLE "redirects" ALTER COLUMN "to_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "modules_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "redirects" ADD COLUMN "match_type" "redirect_match_type" DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_identities" ADD CONSTRAINT "business_identities_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_identities" ADD CONSTRAINT "business_identities_logo_asset_id_content_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_locations" ADD CONSTRAINT "site_locations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_modules" ADD CONSTRAINT "site_modules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_profiles" ADD CONSTRAINT "site_profiles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_type_id_content_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."content_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_parent_id_content_entries_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_live_version_id_record_versions_id_fk" FOREIGN KEY ("live_version_id") REFERENCES "public"."record_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_references" ADD CONSTRAINT "content_references_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_types" ADD CONSTRAINT "content_types_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_slugs" ADD CONSTRAINT "record_slugs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_locations_store_slug_uq" ON "site_locations" USING btree ("store_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "site_locations_primary_uq" ON "site_locations" USING btree ("store_id") WHERE "site_locations"."is_primary";--> statement-breakpoint
CREATE INDEX "site_locations_store_position_idx" ON "site_locations" USING btree ("store_id","position");--> statement-breakpoint
CREATE INDEX "content_entries_type_status_idx" ON "content_entries" USING btree ("store_id","type_id","status");--> statement-breakpoint
CREATE INDEX "content_entries_parent_idx" ON "content_entries" USING btree ("parent_id","position") WHERE "content_entries"."parent_id" is not null;--> statement-breakpoint
CREATE INDEX "content_entries_store_schedule_idx" ON "content_entries" USING btree ("store_id","publish_at") WHERE "content_entries"."publish_at" is not null;--> statement-breakpoint
CREATE INDEX "content_entries_publish_due_idx" ON "content_entries" USING btree ("publish_at") WHERE "content_entries"."publish_at" is not null;--> statement-breakpoint
CREATE INDEX "content_entries_unpublish_due_idx" ON "content_entries" USING btree ("unpublish_at") WHERE "content_entries"."unpublish_at" is not null;--> statement-breakpoint
CREATE INDEX "content_references_target_idx" ON "content_references" USING btree ("store_id","target_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_types_store_key_uq" ON "content_types" USING btree ("store_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "record_slugs_current_uq" ON "record_slugs" USING btree ("store_id","scope_key","locale","slug") WHERE "record_slugs"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "record_slugs_resource_current_uq" ON "record_slugs" USING btree ("resource_type","resource_id","locale") WHERE "record_slugs"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "record_slugs_resource_slug_uq" ON "record_slugs" USING btree ("resource_type","resource_id","locale","slug");--> statement-breakpoint
CREATE INDEX "record_slugs_lookup_idx" ON "record_slugs" USING btree ("store_id","scope_key","locale","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "record_versions_resource_version_uq" ON "record_versions" USING btree ("resource_type","resource_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "record_versions_open_uq" ON "record_versions" USING btree ("resource_type","resource_id") WHERE "record_versions"."live_to" is null;--> statement-breakpoint
CREATE INDEX "record_versions_store_timeline_idx" ON "record_versions" USING btree ("store_id","live_from");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_store_template_key_uq" ON "pages" USING btree ("store_id","template_key") WHERE "pages"."template_key" is not null;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_template_key_type" CHECK (("pages"."type"::text = 'template') = ("pages"."template_key" is not null));--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_template_key_handle" CHECK ("pages"."template_key" is null or "pages"."handle" = "pages"."template_key");--> statement-breakpoint
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_status_code" CHECK ("redirects"."status_code" in (301, 302, 410));--> statement-breakpoint
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_gone_has_no_target" CHECK (("redirects"."status_code" = 410) = ("redirects"."to_path" is null));--> statement-breakpoint
ALTER TABLE "site_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "site_profiles" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "site_modules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "site_modules" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "business_identities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "business_identities" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "site_locations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "site_locations" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "content_types" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "content_types" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "content_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "content_entries" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "record_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "record_versions" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "record_slugs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "record_slugs" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "content_references" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "content_references" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
-- record_versions is the tamper-evident publish history (K1). A version can only be closed:
-- live_to set once, from null; every other column is frozen. Rows cannot be deleted, except
-- by the ON DELETE CASCADE of a store deletion: that delete runs inside the foreign key's
-- trigger (trigger depth > 1) after the store row is already gone. TRUNCATE is refused.
CREATE OR REPLACE FUNCTION record_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'record_versions is append-only and cannot be truncated'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 AND NOT EXISTS (SELECT 1 FROM stores WHERE id = OLD.store_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'record_versions rows cannot be deleted (version % of % %)', OLD.version, OLD.resource_type, OLD.resource_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.live_to IS NOT NULL
     OR NEW.live_to IS NULL
     OR (to_jsonb(NEW) - 'live_to') IS DISTINCT FROM (to_jsonb(OLD) - 'live_to') THEN
    RAISE EXCEPTION 'record_versions rows are immutable; only live_to can be set, once (version % of % %)', OLD.version, OLD.resource_type, OLD.resource_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER record_versions_immutable BEFORE UPDATE OR DELETE ON "record_versions" FOR EACH ROW EXECUTE FUNCTION record_versions_guard();
--> statement-breakpoint
CREATE TRIGGER record_versions_no_truncate BEFORE TRUNCATE ON "record_versions" FOR EACH STATEMENT EXECUTE FUNCTION record_versions_guard();
--> statement-breakpoint
-- Backfill: every store that exists today is an e-commerce site with the content, catalog and
-- commerce modules on (the capabilities it already uses). Idempotent.
INSERT INTO "site_profiles" ("store_id", "organization_id", "kind")
SELECT s.id, s.organization_id, 'ecommerce'
  FROM "stores" s
ON CONFLICT ("store_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "site_modules" ("store_id", "organization_id", "module_key", "status", "source")
SELECT s.id, s.organization_id, m.module_key, 'enabled', 'preset'
  FROM "stores" s
 CROSS JOIN (VALUES ('content'), ('catalog'), ('commerce')) AS m(module_key)
ON CONFLICT ("store_id", "module_key") DO NOTHING;
