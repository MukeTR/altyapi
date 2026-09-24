CREATE TABLE "import_rows" (
	"job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"store_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "import_rows_job_id_row_number_pk" PRIMARY KEY("job_id","row_number")
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "last_processed_group" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "staged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_rows_group_idx" ON "import_rows" USING btree ("job_id","group_key","row_number");--> statement-breakpoint
ALTER TABLE "import_rows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_rows" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
