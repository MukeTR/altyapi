CREATE TYPE "public"."agent_kind" AS ENUM('panel_assistant', 'mcp_client', 'automation');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('online_store', 'marketplace', 'social', 'pos', 'api');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."role_name" AS ENUM('organization_owner', 'store_admin', 'catalog_manager', 'order_manager', 'marketing_manager', 'analyst', 'developer');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('setup', 'active', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."domain_kind" AS ENUM('platform_subdomain', 'custom');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'awaiting_dns', 'validating', 'certificate_pending', 'active', 'failed', 'moved', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."principal_type" AS ENUM('user', 'agent', 'customer', 'system', 'api_client');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TABLE "agent_principals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "agent_kind" NOT NULL,
	"name" text NOT NULL,
	"external_ref" text,
	"acting_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"locale" text DEFAULT 'tr' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"type" "channel_type" NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"invited_email" text,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"invited_by_user_id" uuid,
	"invite_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"store_id" uuid,
	"role" "role_name" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "store_status" DEFAULT 'setup' NOT NULL,
	"default_locale" text DEFAULT 'tr' NOT NULL,
	"supported_locales" text[] DEFAULT ARRAY['tr']::text[] NOT NULL,
	"default_currency" char(3) DEFAULT 'TRY' NOT NULL,
	"supported_currencies" text[] DEFAULT ARRAY['TRY']::text[] NOT NULL,
	"timezone" text DEFAULT 'Europe/Istanbul' NOT NULL,
	"country_code" char(2) DEFAULT 'TR' NOT NULL,
	"contact_email" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"routing_version" integer DEFAULT 1 NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"kind" "domain_kind" NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"is_canonical" boolean DEFAULT false NOT NULL,
	"redirect_to_hostname" text,
	"apex_hostname" text,
	"cloudflare_custom_hostname_id" text,
	"ssl_status" text,
	"verification_status" text,
	"dns_instructions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_reason" text,
	"check_attempts" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organization_id" uuid,
	"store_id" uuid,
	"principal_type" "principal_type" NOT NULL,
	"principal_id" uuid,
	"on_behalf_of_user_id" uuid,
	"agent_id" uuid,
	"session_id" uuid,
	"correlation_id" text NOT NULL,
	"request_id" text,
	"action_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"changes" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"organization_id" uuid,
	"store_id" uuid,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" text NOT NULL,
	"causation_id" text,
	"principal_type" text,
	"principal_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "processed_messages" (
	"consumer" text NOT NULL,
	"message_id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"body" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_acting_user_id_users_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_member_id_organization_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_domains" ADD CONSTRAINT "store_domains_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_principals_org_idx" ON "agent_principals" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_hash_uq" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_store_handle_uq" ON "channels" USING btree ("store_id","handle");--> statement-breakpoint
CREATE INDEX "channels_store_idx" ON "channels" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_uq" ON "organization_members" USING btree ("organization_id","user_id") WHERE "organization_members"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_email_uq" ON "organization_members" USING btree ("organization_id","invited_email") WHERE "organization_members"."invited_email" is not null;--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_uq" ON "role_assignments" USING btree ("member_id","role",coalesce("store_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "role_assignments_org_idx" ON "role_assignments" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_slug_uq" ON "stores" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "stores_org_idx" ON "stores" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_domains_hostname_uq" ON "store_domains" USING btree ("hostname") WHERE "store_domains"."status" <> 'moved';--> statement-breakpoint
CREATE UNIQUE INDEX "store_domains_one_canonical_uq" ON "store_domains" USING btree ("store_id") WHERE "store_domains"."is_canonical";--> statement-breakpoint
CREATE INDEX "store_domains_store_idx" ON "store_domains" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_domains_next_check_idx" ON "store_domains" USING btree ("next_check_at") WHERE "store_domains"."next_check_at" is not null;--> statement-breakpoint
CREATE INDEX "audit_log_store_time_idx" ON "audit_log" USING btree ("store_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_org_time_idx" ON "audit_log" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("available_at") WHERE "outbox_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_events_store_idx" ON "outbox_events" USING btree ("store_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_messages_pk" ON "processed_messages" USING btree ("consumer","message_id");--> statement-breakpoint
CREATE INDEX "queue_messages_ready_idx" ON "queue_messages" USING btree ("queue","available_at") WHERE "queue_messages"."status" = 'queued';