ALTER TABLE "section_definitions" ADD COLUMN "module" text DEFAULT 'core' NOT NULL;--> statement-breakpoint
ALTER TABLE "section_definitions" ADD COLUMN "policy_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "section_definitions" ADD COLUMN "prop_tags" jsonb DEFAULT '{}'::jsonb NOT NULL;