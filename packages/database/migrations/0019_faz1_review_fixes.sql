ALTER TABLE "content_entries" ADD COLUMN "scheduled_revision" integer;--> statement-breakpoint
ALTER TABLE "content_entries" ADD COLUMN "scheduled_by_principal_id" uuid;--> statement-breakpoint
ALTER TABLE "content_entries" ADD COLUMN "is_singleton" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Entries of singleton types are marked, so the partial unique index below allows one
-- non-archived entry per singleton type. A store that already has two fails the migration
-- instead of silently hiding one of them.
UPDATE "content_entries" e
   SET "is_singleton" = true
  FROM "content_types" t
 WHERE t.id = e.type_id AND t.kind = 'singleton';--> statement-breakpoint
-- Schedules set before revisions were pinned approve the draft as it is now.
UPDATE "content_entries"
   SET "scheduled_revision" = "draft_revision"
 WHERE "publish_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "content_entries_singleton_uq" ON "content_entries" USING btree ("type_id") WHERE "content_entries"."is_singleton" and "content_entries"."status" <> 'archived';--> statement-breakpoint
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_schedule_pinned" CHECK (("content_entries"."publish_at" is null) = ("content_entries"."scheduled_revision" is null));
