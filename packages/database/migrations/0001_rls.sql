-- Row Level Security: second line of defense behind repository-level tenant filtering.
-- The application sets app.organization_id / app.store_id per transaction (withTenantTx)
-- or app.bypass_rls = 'on' for platform code paths (withPlatformTx).
-- Policies are enforced for non-owner roles; run the API/worker as the altyapi_app role
-- in production so these policies apply. Migrations run as the owner role.

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on'
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_store() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.store_id', true), '')::uuid
$$;
--> statement-breakpoint
-- Organization boundary is always enforced; the store boundary is enforced whenever a
-- store is selected in the transaction.
CREATE OR REPLACE FUNCTION app_tenant_visible(org uuid, store uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_rls_bypass()
      OR (org = app_current_org()
          AND (app_current_store() IS NULL OR store IS NULL OR store = app_current_store()))
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'altyapi_app') THEN
    CREATE ROLE altyapi_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stores" USING (app_tenant_visible(organization_id, id)) WITH CHECK (app_tenant_visible(organization_id, id));
--> statement-breakpoint
ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "channels" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "store_domains" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "store_domains" USING (app_tenant_visible(organization_id, store_id)) WITH CHECK (app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
ALTER TABLE "role_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "role_assignments" USING (app_tenant_visible(organization_id, NULL)) WITH CHECK (app_tenant_visible(organization_id, NULL));
--> statement-breakpoint
ALTER TABLE "agent_principals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "agent_principals" USING (app_tenant_visible(organization_id, NULL)) WITH CHECK (app_tenant_visible(organization_id, NULL));
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_log" USING (organization_id IS NULL OR app_tenant_visible(organization_id, store_id)) WITH CHECK (organization_id IS NULL OR app_tenant_visible(organization_id, store_id));
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO altyapi_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO altyapi_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO altyapi_app;
