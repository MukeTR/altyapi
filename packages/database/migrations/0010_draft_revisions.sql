CREATE TABLE "draft_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"parent_revision" integer,
	"snapshot" jsonb NOT NULL,
	"source" text NOT NULL,
	"label" text,
	"principal_type" text,
	"principal_id" uuid,
	"agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_revisions_uq" ON "draft_revisions" USING btree ("resource_type","resource_id","revision");--> statement-breakpoint
CREATE INDEX "draft_revisions_parent_idx" ON "draft_revisions" USING btree ("resource_type","resource_id","parent_revision");--> statement-breakpoint
ALTER TABLE "draft_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "draft_revisions" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
