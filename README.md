# DAU EduMarket × Stream

A faithful replica of [Dar Al Uloom University’s EduMarket](https://dau.edu.sa/edumarket/), captured on **16 November 2026**, with an embedded **Stream staging** checkout. The nine course names, descriptions, images, SAR prices, published dates, cart and registration form follow that snapshot. Some course dates are historical. This demonstrates checkout; it does not enroll anyone at DAU.

## Checkout behavior

The payer selects a course and date, reviews the cart, and completes the registration form. The server joins first and last names, normalizes the phone number, and creates or reuses a Stream consumer with `preferred_language: EN`. It creates a consumer-bound, single-use payment link and embeds the English checkout. The API key stays on the server.

Prices and product IDs come from the server catalog. D1 stores session ownership, request fingerprints and checkout attempts so retries can reuse a payment link. A return URL or browser message only triggers verification: the server must confirm the matching Stream invoice and successful payment before displaying a paid result. Registration-only fields stay in the browser; payer name, phone, email and purchase selection are used for checkout. This application does not invoke email, SMS or WhatsApp sending.

## Requirements

- Node.js 22.13 or later and npm.
- A Cloudflare account with Workers and D1 for deployment.
- A Stream **staging** API key and its organization UUID.
- Staging products matching `lib/catalog.json` in that same organization.

This source uses Vinext to run the Next.js App Router interface on Cloudflare Workers. It has no dependency on a private Sites plugin or hosting account.

## Local setup

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Fill in the two server runtime values in `.dev.vars`:

| Variable | Value |
| --- | --- |
| `STREAM_API_KEY` | Your Stream staging API key. |
| `STREAM_ORGANIZATION_ID` | The UUID of the organization that owns that key and the catalog products. |

Never put either value in browser code or a `NEXT_PUBLIC_` variable. `.dev.vars` is ignored by Git. The server verifies the configured organization against Stream’s `/me` response. The API origin is fixed to `https://staging.streampay.sa/api/v2`; this project does not use the production API.

The placeholder D1 ID in `wrangler.jsonc` works for an isolated local database. Apply all three committed schema migrations, then start the app:

```sh
npm run db:migrate:local
npm run dev -- --hostname 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`. Catalog browsing works without Stream credentials; checkout requires configured credentials and matching products. Runtime checkout records are created in local `.wrangler` state and are not source files.

## Catalog mapping

`lib/catalog-display.ts` contains the public course snapshot. `lib/catalog.json` is the server-authoritative mapping of course IDs, prices, dates and Stream product UUIDs. The included product UUIDs identify the original staging catalog; they are identifiers, not credentials, and are useful only with their owning organization.

For a different staging organization, create the same one-off SAR products through the [Stream products API](https://staging-docs.streampay.sa/api/v2-products-create/), then replace each `productId` in `lib/catalog.json` with that organization’s product UUID. Keep prices, course IDs and date choices consistent between the two catalog files. Stream validates the product IDs during link creation, and this backend checks the returned organization, products, quantities and total before exposing checkout. Mixing an organization and another account’s product IDs fails closed. Organization display names can be configured in Stream as **Dar Al Uloom University / جامعة دار العلوم**.

The payment-link request follows the [Stream staging documentation](https://staging-docs.streampay.sa/api/v2-payment-links-create/). Existing consumers retain their verified contact information when their name and preferred language are updated.

## Build and deploy to Cloudflare

Authenticate and create a D1 database:

```sh
npx wrangler login
npx wrangler d1 create dau-edumarket-staging
```

Replace the placeholder `database_id` in `wrangler.jsonc` with the returned UUID. If needed, select your Cloudflare account with `CLOUDFLARE_ACCOUNT_ID`. Set the server secrets interactively; do not pass secrets as shell arguments:

```sh
npx wrangler secret put STREAM_API_KEY
npx wrangler secret put STREAM_ORGANIZATION_ID
npm run db:migrate:remote
npm run typecheck
npm test
npm run deploy
```

`npm run deploy` builds with Vinext and deploys with Wrangler. The Cloudflare Vite plugin emits the Worker and static-asset deployment configuration under `dist/`; Wrangler uses that generated configuration. To run the built Worker locally:

```sh
npm run build
npm run preview
```

All three files in `drizzle/` are schema-only migrations, applied in order by Wrangler. Keep the `DB` binding name unchanged. For future schema changes, run `npm run db:generate`, review the SQL, and apply it with the appropriate local or remote migration command.

A new Worker deployment is accessible according to your Cloudflare settings; this repository does not include the original hosting service’s access gate. Configure Cloudflare Access if the demonstration should be private. No existing live deployment, customer records or credentials are included here.

## Verification and limits

The delivered staging demo was checked for desktop/mobile fidelity, original form behavior, consumer creation/reuse with combined name, phone and English language, payment-link creation, and the English embedded Apple Pay/card interface. Same-checkout retries reused the link. Tampered totals returned 400, another session’s checkout returned 404, and changed data under the same request key returned 409. An existing consumer’s name update was read back while preserving their existing contacts.

The source includes ten backend helper tests for validation, catalog enforcement, quantities/dates, idempotency, checkout URL restrictions, session ownership and consumer updates. Run them with `npm test`, and TypeScript checks with `npm run typecheck`.

**No payment was submitted.** Card authorization, 3DS, paid receipts, enrollment and notification delivery have not been verified. Browsing an existing completed staging invoice’s PDF was separately verified; PDF retrieval is not a feature of this interface. The portable source build is verified independently from the live demo; a new Cloudflare deployment must be configured and checked in its own environment.

## Attribution

The original website design, DAU logo, course images and course content belong to their respective owners. They are included to demonstrate the requested replica; this repository does not grant rights to reuse those assets or imply an official DAU service. No broad license is granted for third-party branding or content.

## Reusable agent skill

[skills/stream-checkout-replica/SKILL.md](skills/stream-checkout-replica/SKILL.md) contains the reusable workflow for a faithful website replica with Stream checkout. It covers catalog/form continuity, existing customers, English checkout, durable retries, verified payment returns and optional issued-invoice downloads. For Codex, place its folder under `~/.codex/skills/` and invoke `$stream-checkout-replica` with the source website and the intended environment. Supply credentials through the server secret mechanism, not the skill file.
