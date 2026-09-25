# @altyapi/admin

Merchant admin panel (Next.js 16 App Router, React 19, Tailwind 4, Radix primitives, cmdk,
lucide-react). Interface languages: Turkish (default) and English.

```sh
pnpm --filter @altyapi/admin dev        # http://localhost:3000 (ADMIN_URL)
pnpm --filter @altyapi/admin typecheck
```

Environment (read on the server only): `API_URL` (or `API_INTERNAL_URL`), `APP_ENV`,
`SESSION_COOKIE_NAME` (the API's cookie name, default `altyapi_session`), `STORE_ROOT_DOMAIN`,
`STOREFRONT_ORIGIN_TEMPLATE` (default `https://{host}`), optional `ADMIN_API_TIMEOUT_MS` and
`ADMIN_TRUSTED_PROXY_HOPS` (reverse proxies in front of the admin that append to X-Forwarded-For,
default 1; the client IP sent to the API is the entry the outermost of them wrote, never a value
the browser supplied).

## How requests reach the API

The browser never calls the API directly. The API accepts cookie-authenticated writes only from
its configured admin origin and its cookie is host-only, so the admin is a backend-for-frontend:

- Sign-in and sign-up are server actions (`app/actions/auth.ts`). They read the session token from
  the API's `Set-Cookie` and keep it in the admin's own httpOnly cookie `altyapi_admin_session`.
- Server components, layouts and server actions call the API with `lib/api/server.ts`, which
  sends the token as `Authorization: Bearer …` and forwards `X-Forwarded-For` and `User-Agent`.
- Client components use `bff()` from `lib/api/client.ts`, which goes through the same-origin proxy
  `app/api/bff/[...path]`. The proxy requires `Origin` to match the admin's own origin on every
  POST, PUT, PATCH and DELETE (its CSRF check) and refuses `/v1/auth/*`.
- `proxy.ts` sends requests without a session cookie to `/login?next=…`. When the API answers
  401, `load()` sends the user through `/api/session/expired`, which clears the cookie and returns
  them to the page after they sign in again.

## Adding a screen

1. Create `app/o/[org]/[store]/(shell)/<area>/page.tsx` (the path in `lib/nav.ts`). Add
   `loading.tsx` shaped like the page; add `not-found.tsx` for record pages.
2. Load data in the server component with `load()` from `lib/api/load.ts`, using the store's API
   prefix from `requireStoreContext(params)` (`ctx.apiBase`). `load()` returns
   `{ ok, data } | { ok: false, error }`: render `<ErrorState error={…} />` for failures (403
   renders the "no permission" variant) and pass `notFoundOn404: true` on record pages.
   Error boundaries only get a digest in production, so render API failures instead of throwing
   them.
3. Set `ready: true` on the screen's entry in `lib/nav.ts`. The sidebar, the command palette and
   the `g <key>` shortcuts pick it up; entries are hidden unless the user holds one of `anyOf`.
4. Record search in ⌘K (orders, products) and shortcut commands ("New product") are registered in
   `lib/commands.ts`.
5. Mutations: server actions for form submissions (redirect after success), `bff()` for
   interactive updates. Show errors inline with `describeError(error, fieldForKey)` from
   `useI18n()`; use toasts only for background or row actions.

## Text and formatting

- Interface text lives in `lib/i18n/messages/{tr,en}/<namespace>.ts`; the English file is typed
  against the Turkish one, so a missing key fails `tsc`. A new area adds its own namespace file in
  both folders and registers it in both `index.ts` files. Use `useI18n().t` in client components
  and `getI18n()` in server components.
- API error keys (`error.message_key`) are translated in `lib/i18n/api-errors/*.ts`, with details
  such as `{slug}` interpolated. Unknown keys fall back to a message per error code.
- Status values are labelled through `<StatusPill domain="order" value={…} />`
  (`statuses.<domain>.<value>`). Unknown values render as the raw value.
- Money is minor units as strings (`<Money>`, `<MoneyInput>`, `lib/format.ts`), never floats.
  Dates show in the store's time zone (`<DateTime>`, `<DateTimeInput>`).

## Components

`components/ui` holds the primitives (Button, Field, Input, Textarea, Select, Combobox, Checkbox,
Switch, RadioGroup, SegmentedControl, Badge, StatusPill, Card, Dialog, AlertDialog, Drawer,
Popover, DropdownMenu, Tabs, TabLinks, Tooltip, Toast, EmptyState, ErrorState, Skeleton,
InlineAlert, CodeBlock, CopyButton, SecretInput, MoneyInput, DateTimeInput, LocalizedTextField,
FileDropzone, Progress, Stepper, Countdown, ConflictBanner, PageHeader, Breadcrumbs, FormSection,
ErrorSummary). `components/data` holds DataTable, the pagination adapters (cursor, offset, load
more), DateTime, Money, Bps, KeyValue and Stat. Design tokens (colors with contrast notes, type
scale, radii, shadows, motion) live in `app/globals.css`.
