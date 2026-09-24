CREATE TYPE "public"."page_status" AS ENUM('draft', 'published', 'scheduled', 'unpublished');--> statement-breakpoint
CREATE TYPE "public"."page_type" AS ENUM('home', 'product', 'collection', 'page', 'landing', 'cart', 'search', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."theme_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "navigations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"type" "page_type" NOT NULL,
	"handle" text NOT NULL,
	"title" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"seo" jsonb NOT NULL,
	"source_revision" integer NOT NULL,
	"created_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"type" "page_type" NOT NULL,
	"handle" text NOT NULL,
	"title" jsonb NOT NULL,
	"status" "page_status" DEFAULT 'draft' NOT NULL,
	"draft_content" jsonb DEFAULT '{"sections":[]}'::jsonb NOT NULL,
	"draft_seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"published_revision" integer,
	"publish_at" timestamp with time zone,
	"unpublish_at" timestamp with time zone,
	"campaign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"theme_version_id" uuid NOT NULL,
	"page_versions" jsonb NOT NULL,
	"navigation" jsonb NOT NULL,
	"reason" text NOT NULL,
	"based_on_publication_id" uuid,
	"created_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redirects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"status_code" smallint DEFAULT 301 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"name" jsonb NOT NULL,
	"category" text NOT NULL,
	"props_schema" jsonb NOT NULL,
	"block_schemas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_bindings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_page_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"renderer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slug_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storefront_state" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"active_publication_id" uuid,
	"active_theme_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theme_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"theme_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"global_sections" jsonb NOT NULL,
	"source_revision" integer NOT NULL,
	"created_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_theme" text DEFAULT 'altyapi-default' NOT NULL,
	"status" "theme_status" DEFAULT 'draft' NOT NULL,
	"draft_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_global_sections" jsonb DEFAULT '{"sections":[]}'::jsonb NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "navigations" ADD CONSTRAINT "navigations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_theme_version_id_theme_versions_id_fk" FOREIGN KEY ("theme_version_id") REFERENCES "public"."theme_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_definitions" ADD CONSTRAINT "section_definitions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_state" ADD CONSTRAINT "storefront_state_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_state" ADD CONSTRAINT "storefront_state_active_publication_id_publications_id_fk" FOREIGN KEY ("active_publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_state" ADD CONSTRAINT "storefront_state_active_theme_id_themes_id_fk" FOREIGN KEY ("active_theme_id") REFERENCES "public"."themes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_versions" ADD CONSTRAINT "theme_versions_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "navigations_store_handle_uq" ON "navigations" USING btree ("store_id","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "page_versions_page_version_uq" ON "page_versions" USING btree ("page_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_store_type_handle_uq" ON "pages" USING btree ("store_id","type","handle");--> statement-breakpoint
CREATE INDEX "pages_schedule_idx" ON "pages" USING btree ("publish_at") WHERE "pages"."status" = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "publications_store_number_uq" ON "publications" USING btree ("store_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "redirects_store_from_uq" ON "redirects" USING btree ("store_id","from_path");--> statement-breakpoint
CREATE UNIQUE INDEX "section_definitions_uq" ON "section_definitions" USING btree (coalesce("store_id", '00000000-0000-0000-0000-000000000000'::uuid),"type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "slug_history_uq" ON "slug_history" USING btree ("store_id","resource_type","locale","slug");--> statement-breakpoint
CREATE INDEX "slug_history_resource_idx" ON "slug_history" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "theme_versions_theme_version_uq" ON "theme_versions" USING btree ("theme_id","version");--> statement-breakpoint
CREATE INDEX "themes_store_idx" ON "themes" USING btree ("store_id");--> statement-breakpoint
ALTER TABLE "themes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "themes" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "theme_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "theme_versions" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "pages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pages" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "page_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "page_versions" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "navigations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "navigations" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "publications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "publications" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "storefront_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "storefront_state" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "redirects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "redirects" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "slug_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "slug_history" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "section_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "section_definitions" USING (store_id IS NULL OR app_rls_bypass() OR store_id = app_current_store()) WITH CHECK (app_rls_bypass() OR (store_id IS NOT NULL AND store_id = app_current_store()));
