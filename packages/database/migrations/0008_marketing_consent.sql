CREATE TYPE "public"."channel_consent_status" AS ENUM('subscribed', 'unsubscribed', 'pending', 'bounced', 'not_set');--> statement-breakpoint
CREATE TYPE "public"."consent_subject_type" AS ENUM('anonymous', 'customer', 'contact');--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"subject_type" "consent_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"purpose" text NOT NULL,
	"categories" jsonb NOT NULL,
	"policy_version" text NOT NULL,
	"text_snapshot" text,
	"source" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"email" text,
	"phone" text,
	"customer_id" uuid,
	"locale" text,
	"email_status" "channel_consent_status" DEFAULT 'not_set' NOT NULL,
	"sms_status" "channel_consent_status" DEFAULT 'not_set' NOT NULL,
	"whatsapp_status" "channel_consent_status" DEFAULT 'not_set' NOT NULL,
	"source" text,
	"email_subscribed_at" timestamp with time zone,
	"email_unsubscribed_at" timestamp with time zone,
	"iys_status" text DEFAULT 'not_required' NOT NULL,
	"iys_synced_at" timestamp with time zone,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_contacts" ADD CONSTRAINT "marketing_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_subject_idx" ON "consent_records" USING btree ("store_id","subject_type","subject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contacts_store_email_uq" ON "marketing_contacts" USING btree ("store_id",lower("email")) WHERE "marketing_contacts"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_contacts_store_phone_uq" ON "marketing_contacts" USING btree ("store_id","phone") WHERE "marketing_contacts"."phone" is not null;--> statement-breakpoint
CREATE INDEX "marketing_contacts_customer_idx" ON "marketing_contacts" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "marketing_contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "marketing_contacts" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "consent_records" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
