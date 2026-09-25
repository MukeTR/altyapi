"use client";

import { Pause, Pencil, Play, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { DataTable, type Column } from "@/components/data/data-table";
import { DateTime } from "@/components/data/date-time";
import { KeyValue } from "@/components/data/key-value";
import { useI18n } from "@/components/providers/i18n-provider";
import { useStore } from "@/components/providers/store-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { ApiError, bff } from "@/lib/api/client";
import type { ApiErrorInfo } from "@/lib/api/errors";
import { formatNumber } from "@/lib/format";
import { settingsFor } from "@/lib/integrations/settings-spec";
import type { ConnectionDetail as Detail, IntegrationConnection, IntegrationProvider, SyncRun } from "@/lib/integrations/types";
import { ConnectionForm } from "./connection-form";
import { CapabilityList, KindBadge, useProviderName } from "./shared";

/** While a sync is queued or running the page re-reads the connection every 10 s. */
const POLL_MS = 10_000;

function settingValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Apps & Integrations › Connection: health, sync schedule, recent sync runs, settings and the
 * actions sync now, pause/resume, edit (re-verifies) and remove.
 */
export function ConnectionDetailView({ initial, provider }: { initial: Detail; provider: IntegrationProvider | null }) {
  const { t, locale, describeError } = useI18n();
  const { apiBase, basePath, can } = useStore();
  const router = useRouter();
  const { toast, toastError } = useToast();
  const [, startRefresh] = useTransition();
  const [conn, setConn] = useState(initial);
  const [busy, setBusy] = useState<"sync" | "status" | "delete" | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [removeError, setRemoveError] = useState<ApiErrorInfo | null>(null);
  const [syncQueued, setSyncQueued] = useState(false);
  const canManage = can("integrations:manage");
  const providerName = useProviderName()(conn.provider, conn.providerName);
  const running = syncQueued || conn.recentRuns.some((r) => r.status === "running");

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      bff<Detail>(`${apiBase}/integrations/connections/${conn.id}`)
        .then((next) => {
          setConn(next);
          setSyncQueued(false);
        })
        .catch((err: unknown) => {
          if (!(err instanceof ApiError)) throw err;
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, apiBase, conn.id]);

  const sync = async () => {
    setBusy("sync");
    try {
      await bff<{ queued: boolean }>(`${apiBase}/integrations/connections/${conn.id}/sync`, { method: "POST" });
      setSyncQueued(true);
      toast({ tone: "info", title: t("integrations.detail.syncQueued") });
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status: "active" | "paused") => {
    setBusy("status");
    try {
      const updated = await bff<IntegrationConnection>(`${apiBase}/integrations/connections/${conn.id}`, { method: "PATCH", body: { status } });
      setConn((c) => ({ ...c, ...updated }));
      toast({ tone: "success", title: status === "paused" ? t("integrations.detail.paused") : t("integrations.detail.resumed") });
    } catch (err) {
      if (err instanceof ApiError) toastError(err.toInfo());
      else throw err;
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    setRemoveError(null);
    try {
      await bff<void>(`${apiBase}/integrations/connections/${conn.id}`, { method: "DELETE" });
      toast({ tone: "success", title: t("integrations.detail.removed", { name: conn.name }) });
      router.push(`${basePath}/apps`);
      startRefresh(() => router.refresh());
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setRemoveError(err.toInfo());
      setBusy(null);
    }
  };

  const settingFields = settingsFor(conn.provider);
  const settingItems = settingFields.length
    ? settingFields.flatMap((f) => {
        const value = f.path.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), conn.settings);
        return value === undefined ? [] : [{ label: t(f.label), value: settingValue(value), mono: true }];
      })
    : Object.entries(conn.settings).map(([k, v]) => ({ label: k, value: settingValue(v), mono: true }));

  const runColumns: Column<SyncRun>[] = [
    { id: "started", header: t("integrations.runs.started"), cell: (r) => <DateTime value={r.startedAt} format="relative" className="whitespace-nowrap text-fg-muted" /> },
    { id: "resource", header: t("integrations.runs.resource"), cell: (r) => t.maybe(`integrations.resources.${r.resource}`) ?? r.resource },
    { id: "status", header: t("integrations.runs.status"), cell: (r) => <StatusPill domain="syncRun" value={r.status} /> },
    { id: "fetched", header: t("integrations.runs.fetched"), align: "end", cell: (r) => formatNumber(r.fetched, locale) },
    { id: "changed", header: t("integrations.runs.changed"), align: "end", cell: (r) => formatNumber(r.changed, locale) },
    {
      id: "duration",
      header: t("integrations.runs.duration"),
      align: "end",
      cell: (r) => (r.finishedAt ? t("integrations.runs.seconds", { n: formatNumber(Math.max(0, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000)), locale) }) : t("common.none")),
    },
    { id: "error", header: t("integrations.runs.error"), cell: (r) => (r.error ? <span className="block max-w-72 truncate text-sm text-danger" title={r.error}>{r.error}</span> : null) },
  ];

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <PageHeader
        title={conn.name}
        breadcrumbs={[{ label: t("integrations.title"), href: `${basePath}/apps` }, { label: providerName }]}
        status={
          <>
            <StatusPill domain="integrationConnection" value={conn.status} />
            <KindBadge kind={conn.kind} />
          </>
        }
        meta={
          <span>
            {providerName} · {t("integrations.detail.connectedOn")} <DateTime value={conn.createdAt} format="date" />
          </span>
        }
        actions={
          canManage ? (
            <>
              <Button variant="primary" onClick={() => void sync()} loading={busy === "sync"} disabled={conn.status === "paused" || busy !== null}>
                <RefreshCw aria-hidden="true" />
                {t("integrations.detail.syncNow")}
              </Button>
              {conn.status === "paused" ? (
                <Button onClick={() => void setStatus("active")} loading={busy === "status"} disabled={busy !== null}>
                  <Play aria-hidden="true" />
                  {t("integrations.detail.resume")}
                </Button>
              ) : (
                <Button onClick={() => void setStatus("paused")} loading={busy === "status"} disabled={busy !== null}>
                  <Pause aria-hidden="true" />
                  {t("integrations.detail.pause")}
                </Button>
              )}
              <Button onClick={() => setEditing(true)} disabled={busy !== null}>
                <Pencil aria-hidden="true" />
                {t("common.edit")}
              </Button>
              <Button variant="ghost" onClick={() => setRemoving(true)} disabled={busy !== null}>
                <Trash2 aria-hidden="true" />
                {t("common.remove")}
              </Button>
            </>
          ) : null
        }
      />

      {conn.lastError ? (
        <InlineAlert tone="danger" title={t("integrations.detail.lastError", { count: formatNumber(conn.consecutiveFailures, locale) })}>
          <span className="break-words">{conn.lastError}</span>
        </InlineAlert>
      ) : null}
      {conn.status === "paused" ? <InlineAlert tone="warning">{t("integrations.detail.pausedNote")}</InlineAlert> : null}
      {running ? (
        <InlineAlert tone="info" live="status">
          {t("integrations.detail.running")}
        </InlineAlert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card flush title={t("integrations.runs.title")} description={t("integrations.runs.description")}>
            <DataTable
              caption={t("integrations.runs.title")}
              columns={runColumns}
              rows={conn.recentRuns}
              rowKey={(r) => r.id}
              empty={<EmptyState title={t("integrations.runs.empty")} description={t("integrations.runs.emptyBody")} />}
            />
          </Card>
          <Card title={t("integrations.detail.settings")} description={t("integrations.detail.settingsHelp")}>
            {settingItems.length ? <KeyValue items={settingItems} /> : <p className="text-sm text-fg-muted">{t("integrations.detail.noSettings")}</p>}
          </Card>
        </div>
        <aside className="flex flex-col gap-4">
          <Card title={t("integrations.detail.schedule")}>
            <KeyValue
              className="sm:grid-cols-1"
              items={[
                { label: t("integrations.detail.every"), value: t("integrations.detail.minutes", { n: formatNumber(conn.pollIntervalMinutes, locale) }) },
                { label: t("integrations.detail.lastSync"), value: conn.lastSyncAt ? <DateTime value={conn.lastSyncAt} format="relative" /> : t("integrations.never") },
                { label: t("integrations.detail.lastSuccess"), value: conn.lastSuccessAt ? <DateTime value={conn.lastSuccessAt} format="relative" /> : t("integrations.never") },
                { label: t("integrations.detail.nextSync"), value: conn.status === "paused" ? t("integrations.detail.none") : <DateTime value={conn.nextSyncAt} /> },
              ]}
            />
          </Card>
          <Card title={t("integrations.detail.capabilities")}>
            <CapabilityList capabilities={conn.capabilities} className="flex flex-col gap-1.5" />
          </Card>
          <Card title={t("integrations.detail.credentials")}>
            <p className="text-sm text-fg-muted">{t("integrations.detail.credentialsNote")}</p>
          </Card>
        </aside>
      </div>

      {canManage ? (
        <Dialog open={editing} onOpenChange={setEditing} title={t("integrations.detail.editTitle", { name: conn.name })} description={t("integrations.detail.editDescription")} size="lg" modalLock>
          <ConnectionForm
            key={conn.updatedAt}
            provider={{ id: conn.provider, name: providerName, credentialFields: provider?.credentialFields ?? [], defaultPollMinutes: conn.pollIntervalMinutes }}
            connection={conn}
            onCancel={() => setEditing(false)}
            onDone={(updated) => {
              setConn((c) => ({ ...c, ...updated }));
              setEditing(false);
              toast({ tone: "success", title: t("integrations.detail.saved") });
            }}
          />
        </Dialog>
      ) : null}

      <AlertDialog
        open={removing}
        onOpenChange={(o) => {
          setRemoving(o);
          if (!o) {
            setConfirmName("");
            setRemoveError(null);
          }
        }}
        title={t("integrations.detail.removeTitle", { name: conn.name })}
        description={t("integrations.detail.removeBody")}
        confirmLabel={t("common.remove")}
        pending={busy === "delete"}
        confirmDisabled={confirmName.trim() !== conn.name}
        onConfirm={() => void remove()}
      >
        <div className="flex flex-col gap-3">
          <Field label={t("integrations.detail.typeName", { name: conn.name })}>
            <Input value={confirmName} autoComplete="off" onChange={(e) => setConfirmName(e.target.value)} />
          </Field>
          {removeError ? (
            <InlineAlert tone="danger" live="alert">
              {describeError(removeError).message}
            </InlineAlert>
          ) : null}
        </div>
      </AlertDialog>
    </div>
  );
}
