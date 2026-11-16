---
name: stream-checkout-replica
description: Recreate an existing storefront or course-registration website faithfully and connect its final payment step to Stream staging checkout. Use for branded checkout demonstrations or adapting an existing replica; not for an unrelated redesign, production billing migration, or an automatic subscription/usage-billing package.
---

# Stream checkout replica

Preserve the recognizable site and purchase journey. Add real Stream checkout at the requested final payment step, with the selected products and payer details carried through.

The user's current instructions define scope. This skill does not authorize unrelated account changes, payments, publication to a wider audience, or messages.
Do not add subscriptions, usage billing, dashboards, a presentation, or an invoice feature merely because another demo included them.

## Inspect the reference before building

1. Open the current source site and walk the actual catalog → product/options → cart → registration → checkout path.
2. Capture desktop and mobile screenshots; inspect actual pixels, source HTML/CSS, fonts, images, spacing and selected states.
3. Extract a structured catalog: exact name, description, price/currency, tax treatment, categories, images, variants, dates and quantity rules.
4. Record every form label, required field, validation rule and conditional branch. Identify the fields that feed checkout.
5. Save public evidence and an implementation design note in the task workspace. Distinguish extracted values from estimates.

Use the available website-reading and browser tools according to their instructions. A logo and matching colors do not establish visual fidelity.
Do not submit an order or registration to the reference merchant. A temporary anonymous cart item may be used for inspection when authorized; restore it afterward.
Retain original spelling, capitalization, language and historical dates when an exact replica is requested. Explain stale dates privately; do not invent future availability.
If the source has no working payment method, reproduce the surrounding form and replace that final payment area with Stream.
Keep reference-site login, chat, analytics and order-submission integrations from accidentally transmitting replica activity to the original merchant.

## Reuse earlier work deliberately

Inspect relevant existing demos and their current source before adapting them. Treat earlier work as implementation evidence, not evidence of this client's products or prices.
Reusable lessons include original registration above embedded checkout, consistent cart totals, session-owned payment returns and a readable mobile payment area.
Create a separate project and preserve the earlier demo unless the user explicitly requests an in-place change.

Replace or remove copied:

- Organization/product/customer IDs, keys, payment links, portal sessions, seed records and cached provider responses.
- Client names, assets, pricing, tax identity, metadata namespaces, browser storage keys and test fixtures.
- Site/project IDs, database bindings, deployment identity, Git remotes, domains and redirect URLs.

Do not copy `.git`, `.env*`, `.dev.vars*`, local databases, runtime state, generated output or live QA records into the new project.
Public implementation reference: https://github.com/rakan003/dau-edumarket-stream
Use that reference only after checking its current code and sanitizing client-specific state; it is not an API contract.

## Lock the intended Stream environment

Read current documentation and use the supplied credential only against its intended service.
Before billing writes, call the documented read-only account endpoint and verify the exact organization against the user's intended account.
Do not assume a generic connected Stream tool has switched to a newly supplied key.
Resolve merchant app, admin panel, API, checkout and portal origins separately; their hostnames can differ within the same environment.
Record this mapping and expected organization in a private project manifest. Never derive API/checkout hosts from a merchant-app hostname.
An unavailable endpoint is not permission to try production or another client's account.

For staging, the following were verified on 16 November 2026; recheck before reuse:

- API base: `https://staging.streampay.sa/api/v2`.
- Embedded checkout origin: `https://staging.billing.streampay.sa`.
- Read-only identity: `GET /me` relative to that API base.

An account field named `sandbox` is supporting evidence, not a sufficient environment identity by itself.
A `sandbox: false` value alone must not block an otherwise verified staging API origin and expected organization.
Keep the API credential in the hosting platform's server secret mechanism; never place it in client code, browser storage, screenshots, logs or archives.
Configure only requested organization settings. Use official English/Arabic names and logo; do not invent legal suffixes, addresses or tax numbers.
Save, reload and read back requested settings. Keep an internal demo contact separate from public merchant and payer details.

## Preserve catalog and form continuity

The browser sends allowlisted product selections, variants/dates and quantities; the server resolves provider IDs and authoritative amounts.
Reject unknown products, invalid dates, unsupported quantities, currency changes and client-supplied price overrides.
Reconcile existing Stream products before creating more. Compare name, type, amount, currency and tax configuration with the source.
Use source prices as published. Do not silently change VAT/exemption settings to force a matching total.
Preserve the selected item, date and quantity through cart, form, payment summary, checkout and return.
Retain original registration fields even when only some feed billing. State which fields are local-only; do not imply they created enrollment records.

For the common first-name/last-name form:

```js
const fullName = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, " ");
```

Pass that name and the normalized form phone to the intended consumer. Pass email when present and appropriate for a new consumer.
Normalize a Saudi local mobile only when the chosen country/default supports that interpretation; retain valid international E.164 numbers.
Keep the source website's language unless asked to change it. Default newly created demo consumers and checkout to English when no preference is given.
Set the documented consumer language value, currently `preferred_language: "EN"`; configure checkout separately, currently `language=en`.
Verify the effective provider record and displayed checkout language; a UI language parameter alone does not change the consumer preference.

## Reuse consumers without changing contact identity

Look up a saved consumer mapping, then reconcile by the intended account and normalized phone/external identity before creating.
Do not overwrite a reused consumer's verified phone/email with a new form email simply to make the fields match.
Only send a profile update when the requested name, language or authorized demo communication setting actually differs.
When updating a reused consumer, preserve the phone and email returned by the provider explicitly; update the authorized profile fields separately.

```js
const update = {
  name: fullName,
  phone_number: existing.phone_number,
  email: existing.email,
  preferred_language: "EN"
};
```

For a quiet staging demo, use the supported empty communication-method setting when within scope; do not invoke email/SMS/WhatsApp delivery.
`CONSUMER_CONTACT_INFO_CHANGE_NOT_ALLOWED` has been observed on contact-changing updates. The public update schema does not explain all verification restrictions or omitted-field semantics.
Do not claim that omitted fields universally become null. Preserve known contacts, inspect the returned code and read back the result.
If a profile update still fails, preserve the existing identity and report the specific limitation; do not claim the requested name/language was applied.
Continue using that identity only when the mismatch is acceptable for the requested flow; otherwise leave checkout recoverably blocked. Do not create duplicates or retry another person's contact details.

## Make remote writes repeatable

Use durable storage for session ownership, request key, canonical payload fingerprint, operation stage, attempt and provider IDs.
Use an HttpOnly, Secure, SameSite cookie for the demo session; a random cookie is not authentication for a public production customer portal.
Serialize conflicting checkout/contact operations with bounded locks. Apply all schema migrations before live traffic.

For each create:

1. Validate account/configuration before marking a remote write as sent.
2. Reuse the completed operation for the same key and fingerprint; reject a changed payload under the same key.
3. Reconcile remote records using stable external metadata before creating a replacement.
4. Persist the intent immediately before the actual POST; store the returned resource ID and verified amount/ownership afterward.
5. On timeout or an uncertain response, reconcile that same intent. Do not generate a fresh key to escape uncertainty.
6. If reconciliation remains inconclusive, stop creating and show a recoverable pending state with an honest explanation.

Include dates/quantities and payer identity in the fingerprint. Retain aliases when different request keys map to the same checkout.
Do not return an expired/inactive link as pending. Verify whether it is paid or processing before renewal; separate replacement attempts in durable metadata.
Return an already-paid checkout's verified result instead of creating another charge.
A transient failure of the read-only account preflight must not leave an unsent POST marked ambiguously committed.

## Prepare and embed checkout

Create the link server-side with the current documented endpoint, selected products, bounded quantities and consumer ID.
For a single purchase, use the supported single-use limit and an appropriate expiry; preserve source rules for other purchase types.
Use success/failure return URLs on the replica's own verified origin and bind the return to its server-owned checkout.
Verify provider response organization, consumer, products, quantities, currency and amount before exposing a URL.

Stream staging has returned both a canonical checkout URL and `https://streampay.sa/ss/<slug>` short links.
Only support a short-link format after verifying its mapping in the current staging environment.
If verified, construct the canonical staging URL from the trusted authenticated response's payment-link ID and expected organization ID.
Never construct it from a caller-supplied ID or infer environment from the short URL alone; reject unexpected hosts, paths, credentials and query redirects.
Keep credentials away from the short-link host and iframe. Add only currently supported embed/language parameters.

Preserve the merchant shell and put checkout at the requested final step. Do not replace the real provider UI with a card-input mockup.
Allow readable iframe width/height; use supported resize events, one scrolling owner, focus/close behavior and responsive layout.
Retain a secure-page fallback when needed. Respect provider framing restrictions and cross-origin boundaries.

On Cloudflare Workers, use `redirect: "manual"` and explicitly reject unexpected 3xx responses.
Workers does not implement `redirect: "error"`; it throws before sending the request, even though local fetch clients may support it.
Log bounded error classification, HTTP status and elapsed time for diagnosis; omit secrets, payer data and provider token/query strings.

## Card verification and trusted return

Read the current embedded-checkout event contract; do not assume an old demo's event names or payload shape remain valid.
Accept messages only from the active iframe's `contentWindow`, exact verified origin and expected schema.
A valid processor/3DS handoff may require top-level navigation. Support it rather than leaving the payer waiting indefinitely.
Allow only the individually verified HTTPS processor origin and narrow authentication path; do not allow arbitrary URLs under a payment-provider domain.
Moyasar examples include `/v1/transaction_auths/<identifier>` with optional `/form`; some staging flows have used `/v1/card_auth/<UUID>/prepare` or `/acs_emulator`.
Treat those as route families to verify against the current handoff and official docs, not an unconditional allowlist.
Preserve provider query data for the handoff without logging it or adding Stream parameters to it.

Callbacks, browser messages, a return URL and a completed 3DS screen are refresh signals, not payment proof.
On the server, resolve the session-owned checkout and verify the invoice's organization, consumer, link, currency, amount and payment records.
Use current documented statuses and units; for example, invoice `COMPLETED`, zero remaining balance and sufficient successful/settled payments after refunds.
Let current pending/processing attempts outrank a historical failed attempt. Never show success from a client-supplied flag.
Poll only while needed; queue a fresh status request if a trusted return arrives during an older in-flight read.
Make reload, back, close/reopen and return within an iframe recover the same verified checkout.

## Issued invoice PDF, only when requested

Use Stream's issued PDF by default. Do not add a custom cover, fabricate tax identity/QR codes or imply staging establishes regulatory certification.
Resolve the owned invoice and its successful payment server-side; verify organization, consumer and paid state before download.
First inspect the current invoice/payment response for a supported PDF link; it may be null.
On 16 November 2026, staging verified this API-key-authenticated fallback:

`GET /api/v2/consumer_portal/pdf/invoice/{invoice_id}/payment/{payment_id}/download`

It returned `200` JSON `{ "link": "<signed HTTPS URL>" }`; the returned URL served `application/pdf` without the API key.
This route was not listed in the public OpenAPI. Recheck availability in the current authorized environment before implementing it; never guess IDs or alternate hosts.
Validate the signed destination against the verified storage origin, reject unexpected redirects, and fetch without forwarding merchant credentials.
Bound response size, check PDF MIME type and `%PDF-` bytes, and return a private/no-store attachment.
Verify an actual downloaded PDF and its totals/branding, not only a download-button click.

## Verify, publish and hand off

Use the selected hosting workflow. Preserve the site's audience unless the user requests a change; follow native approval requirements without inventing another gate.
Check the deployed journey at desktop and narrow mobile sizes: catalog, options, form conditions, totals, iframe, return and any requested invoice.
Read back actual provider consumer, link and invoice records. Confirm name, phone, language, selections and totals agree with the form/server.
Test meaningful boundaries: same-key retry, changed-payload rejection, cross-session status/download, expiry, uncertain writes and pending-versus-paid behavior.
Do not create repeated payments to rerun visual checks. Test cards/3DS only within the user's authorization and applicable browser handoff rules.
Report separately what was visually inspected, provider-verified, simulated and not tested; never imply checkout opening proves payment or enrollment.

Before source publication or ZIP delivery, scan the exact tracked commit and archive for credentials, environment files, private records and live QA checkout URLs.
For a public Git repository, also scan every commit being pushed, or initialize a fresh repository from the sanitized source without prior history.
Use synthetic IDs/contacts in tests. Preserve runtime configuration names without values. Package editable source from a known commit and check archive integrity.
Deliver the working URL, concise walkthrough, source reference and any material verification limits. Include invoice/download links only when they work and were requested.
Email or otherwise send deliverables only when explicitly authorized, to the specified recipient; building or publishing a demo does not authorize outreach.

## Official references

- [Stream staging documentation](https://staging-docs.streampay.sa/)
- [Create payment link](https://staging-docs.streampay.sa/api/v2-payment-links-create/)
- [Update consumer](https://staging-docs.streampay.sa/api/v2-consumers-update/)
- [List invoices](https://staging-docs.streampay.sa/api/v2-invoices-list/)
- [Embedded checkout](https://staging-docs.streampay.sa/embedded-checkout/)
- [Cloudflare Request options](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [Moyasar card authentication during payment](https://docs.moyasar.com/guides/tokenization/save-card-in-payment)
