import { env } from 'cloudflare:workers';
import catalogData from './catalog.json';
import { assertFingerprint, CheckoutError, checkoutURL, consumerProfileUpdate, digest, fingerprint, linkExpired, object, sessionFromCookie,
  totalCents, UUID, validateInput, type CheckoutInput, type Course } from './stream-core';

const API_BASE = 'https://staging.streampay.sa/api/v2';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const catalog: Course[] = catalogData;
type Json = Record<string, unknown>;
type CheckoutRow = { id: string; session_id: string; client_key: string; fingerprint: string;
  input_json: string; total_cents: number; consumer_id: string | null; link_id: string | null;
  url: string | null; stage: string; attempt: number; error_code: string | null; created_at: number; updated_at: number };
type ContactRow = { id: string; consumer_id: string | null; stage: string; updated_at: number };

function secret(name: string): string {
  const value: unknown = Reflect.get(env, name);
  if (typeof value !== 'string' || !value.trim()) throw new CheckoutError('CHECKOUT_UNAVAILABLE', 'Checkout is not connected yet.', 503);
  return value.trim();
}

function expectedOrganization(): string {
  const organization = secret('STREAM_ORGANIZATION_ID');
  if (!UUID.test(organization)) {
    throw new CheckoutError('ORGANIZATION_MISMATCH', 'The checkout account could not be verified.', 503);
  }
  return organization;
}

function configuration() {
  return { key: secret('STREAM_API_KEY'), organization: expectedOrganization() };
}

function db(): D1Database {
  if (!env.DB) throw new CheckoutError('STORAGE_UNAVAILABLE', 'Checkout is temporarily unavailable.', 503);
  return env.DB;
}

async function one<T>(sql: string, ...values: (string | number | null)[]): Promise<T | null> {
  return db().prepare(sql).bind(...values).first<T>();
}

async function run(sql: string, ...values: (string | number | null)[]) {
  return db().prepare(sql).bind(...values).run();
}

export async function boundedJSON(body: ReadableStream<Uint8Array> | null, limit = 8192): Promise<unknown> {
  if (!body) throw new CheckoutError('INVALID_INPUT', 'The checkout request could not be read.');
  const reader = body.getReader();
  let count = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > limit) {
        await reader.cancel();
        throw new CheckoutError('REQUEST_TOO_LARGE', 'The checkout request is too large.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(count);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new CheckoutError('INVALID_JSON', 'The checkout request could not be read.'); }
}

async function provider(path: string, body?: Json, method?: 'PUT'): Promise<Json> {
  const { key } = configuration();
  let response: Response;
  const startedAt = Date.now();
  const requestMethod = method ?? (body === undefined ? 'GET' : 'POST');
  const endpoint = path.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id');
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: requestMethod,
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json', Accept: 'application/json',
        'User-Agent': 'DarAlUloom-EduMarket/1.0 (Stream staging checkout)' },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Workers supports manual/follow, not Fetch's "error" redirect mode.
      // Never follow a provider redirect with the merchant API credential.
      redirect: 'manual', signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const errorObject = object(error);
    const cause = object(errorObject.cause);
    const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Z_0-9-]{1,60}$/i.test(value) ? value : null;
    // Never log request URLs (searches may contain payer data), payloads, headers,
    // or unrestricted error messages. These fields distinguish DNS/timeout/egress failures.
    const errorName = error instanceof Error ? safeCode(error.name) : null;
    const messageKind = error instanceof Error
      ? /timeout|timed out/i.test(error.message) ? 'timeout'
        : /abort/i.test(error.message) ? 'aborted'
        : /redirect/i.test(error.message) ? 'redirect'
        : /resolve|dns|ENOTFOUND/i.test(error.message) ? 'dns'
        : /network|fetch/i.test(error.message) ? 'network' : 'other'
      : 'unknown';
    console.error('DAU Stream provider fetch failed', { endpoint, method: requestMethod,
      elapsedMs: Date.now() - startedAt, errorName, causeCode: safeCode(cause.code), messageKind });
    throw new CheckoutError('STREAM_UNAVAILABLE', 'Stream has not confirmed the request. Please retry the same checkout.', 502);
  }
  if (!response.ok) {
    const details = await rejectionDetails(response);
    console.error('DAU Stream provider rejected request', { endpoint, method: requestMethod,
      elapsedMs: Date.now() - startedAt, status: response.status, ...details });
    throw new CheckoutError('STREAM_REJECTED', 'Stream could not prepare this checkout. Please try again in a moment.', 502, response.status);
  }
  try { return object(await boundedJSON(response.body, 2 * 1024 * 1024)); }
  catch { throw new CheckoutError('INVALID_STREAM_RESPONSE', 'The checkout response could not be verified.', 502); }
}

async function rejectionDetails(response: Response) {
  const token = (value: unknown) => typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value) ? value : null;
  const contentType = response.headers.get('content-type')?.split(';')[0] ?? '';
  let sample = '';
  // Inspect at most 16 KiB to classify the rejection; never log this text.
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let remaining = 16384;
    try {
      while (remaining > 0) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value.slice(0, remaining);
        remaining -= chunk.byteLength;
        sample += decoder.decode(chunk, { stream: true });
      }
      sample += decoder.decode();
      if (remaining === 0) await reader.cancel();
    } catch { sample = ''; }
    finally { reader.releaseLock(); }
  }
  let providerCode: string | null = null;
  if (contentType.includes('json')) {
    try {
      const data = object(JSON.parse(sample));
      providerCode = token(data.code ?? data.error_code ?? object(data.error).code);
    } catch { /* Only classifications are retained for non-JSON errors. */ }
  }
  const challenge = response.headers.get('cf-mitigated') === 'challenge';
  const reason = challenge || /captcha|challenge-platform|checking your browser/i.test(sample) ? 'edge_challenge'
    : /csrf|cross.site.request/i.test(sample) ? 'csrf_rejection'
    : /duplicate|already exists/i.test(sample) ? 'duplicate_record'
    : /permission|not permitted|not allowed|access denied/i.test(sample) ? 'access_denied'
    : /unauthorized|invalid.*(?:key|token)/i.test(sample) ? 'authentication'
    : /validation|field required/i.test(sample) ? 'validation'
    : /forbidden/i.test(sample) ? 'forbidden'
    : 'unclassified';
  return { contentType: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(contentType) ? contentType : null,
    providerCode, reason, edgeChallenge: challenge,
    streamTraceId: token(response.headers.get('x-stream-trace-id')), cfRay: token(response.headers.get('cf-ray')) };
}

export async function checkoutHealth() {
  await verifyAccount();
  return { ok: true, environment: 'staging' };
}

async function verifyAccount(): Promise<void> {
  const result = await provider('/me');
  const organization = object(result.organization);
  // The API origin fixes this integration to staging. The merchant UI's sandbox
  // toggle can change independently and is not proof of a production environment.
  if (organization.id !== expectedOrganization()) {
    throw new CheckoutError('ORGANIZATION_MISMATCH', 'The checkout account could not be verified.', 503);
  }
}

async function mutate(path: string, body: Json, method?: 'PUT') {
  await verifyAccount();
  return provider(path, body, method);
}

async function list(path: string): Promise<Json[]> {
  const result: Json[] = [];
  for (let page = 1; page <= 20; page++) {
    const response = await provider(`${path}${path.includes('?') ? '&' : '?'}limit=100&page=${page}`);
    if (!Array.isArray(response.data)) throw new CheckoutError('INVALID_STREAM_RESPONSE', 'The checkout records could not be verified.', 502);
    result.push(...response.data.map(object));
    if (object(response.pagination).has_next_page === false || response.data.length < 100) return result;
  }
  throw new CheckoutError('RECONCILIATION_LIMIT', 'This checkout needs review before another attempt.', 409);
}

function remoteId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new CheckoutError('INVALID_STREAM_RESPONSE', 'The checkout record could not be verified.', 502);
  return value;
}

async function locked<T>(id: string, action: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID();
  await run('DELETE FROM dau_locks WHERE id = ? AND expires_at < ?', id, Date.now());
  const lock = await run('INSERT OR IGNORE INTO dau_locks (id, token, expires_at) VALUES (?, ?, ?)', id, token, Date.now() + 180000);
  if (!lock.meta.changes) throw new CheckoutError('CHECKOUT_BUSY', 'Your checkout is being prepared. Please try again in a moment.', 409);
  try { return await action(); }
  finally { await run('DELETE FROM dau_locks WHERE id = ? AND token = ?', id, token); }
}

export async function currentSession(request: Request, create: boolean): Promise<{ id: string; cookie?: string }> {
  const existing = sessionFromCookie(request);
  if (existing) {
    const record = await one<{ id: string; created_at: number }>('SELECT id, created_at FROM dau_sessions WHERE id = ?', existing);
    if (record && record.created_at > Date.now() - SESSION_TTL) {
      await run('UPDATE dau_sessions SET last_used_at = ? WHERE id = ?', Date.now(), existing);
      return { id: existing };
    }
  }
  if (!create) throw new CheckoutError('CHECKOUT_NOT_FOUND', 'This checkout is not available in this browser session.', 404);
  const id = crypto.randomUUID();
  await run('INSERT INTO dau_sessions (id, created_at, last_used_at) VALUES (?, ?, ?)', id, Date.now(), Date.now());
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return { id, cookie: `dau_checkout_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${secure}` };
}

async function findConsumer(input: CheckoutInput, externalId: string): Promise<Json | null> {
  const matches = (await list(`/consumers?search_term=${encodeURIComponent(input.phone)}`))
    .filter((consumer) => consumer.phone_number === input.phone || consumer.external_id === externalId);
  if (matches.length > 1) throw new CheckoutError('CONSUMER_CONFLICT', 'This mobile number needs review before checkout.', 409);
  return matches[0] ?? null;
}

async function consumerFor(input: CheckoutInput): Promise<string> {
  const contactKey = await digest(input.phone);
  const externalId = `dau-edumarket-${contactKey.slice(0, 32)}`;
  return locked(`contact:${contactKey}`, async () => {
    const contact = await one<ContactRow>('SELECT * FROM dau_contacts WHERE id = ?', contactKey);
    let consumer = contact?.consumer_id ? await provider(`/consumers/${remoteId(contact.consumer_id)}`) : await findConsumer(input, externalId);
    if (consumer) {
      if (consumer.phone_number !== input.phone) throw new CheckoutError('CONSUMER_CONFLICT', 'The payer details could not be verified.', 409);
    } else {
      if (contact?.stage === 'sent') throw new CheckoutError('PENDING_RECONCILIATION', 'Stream is still confirming your details. Please retry this checkout shortly.', 409);
      await verifyAccount();
      await run('INSERT INTO dau_contacts (id, stage, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET stage = excluded.stage, updated_at = excluded.updated_at', contactKey, 'sent', Date.now());
      try {
        consumer = await provider('/consumers', {
          name: input.name, phone_number: input.phone, ...(input.email ? { email: input.email } : {}),
          consumer_type: 'INDIVIDUAL', preferred_language: 'EN', communication_methods: [], external_id: externalId,
        });
      } catch (error) {
        // A timeout may have committed. Reconcile before allowing another create.
        consumer = await findConsumer(input, externalId);
        if (!consumer) {
          if (error instanceof CheckoutError && error.providerStatus && [400, 401, 403, 404, 409, 422].includes(error.providerStatus)) {
            await run('UPDATE dau_contacts SET stage = ?, updated_at = ? WHERE id = ?', 'new', Date.now(), contactKey);
          }
          throw error;
        }
      }
    }
    const id = remoteId(consumer.id);
    // Preserve existing contact identity while keeping the display name and
    // language aligned with this registration. An email-only mismatch is not
    // a reason to modify a verified Stream consumer.
    const profileUpdate = consumerProfileUpdate(consumer, input.name);
    if (profileUpdate) await mutate(`/consumers/${id}`, profileUpdate, 'PUT');
    await run('INSERT INTO dau_contacts (id, consumer_id, stage, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET consumer_id = excluded.consumer_id, stage = excluded.stage, updated_at = excluded.updated_at', contactKey, id, 'ready', Date.now());
    return id;
  });
}

function selectedCourses(input: CheckoutInput): Course[] {
  return input.courseIds.map((id) => catalog.find((course) => course.id === id)!);
}

function verifyLink(link: Json, row: CheckoutRow, input: CheckoutInput): string {
  if (link.organization_id !== expectedOrganization() || link.organization_consumer_id !== row.consumer_id ||
      link.currency !== 'SAR' || Number(link.amount_in_smallest_unit) !== row.total_cents ||
      object(link.custom_metadata).dau_checkout_id !== row.id ||
      Number(object(link.custom_metadata).dau_attempt) !== row.attempt || !Array.isArray(link.items)) {
    throw new CheckoutError('CHECKOUT_MISMATCH', 'The course total could not be verified. Please try again later.', 409);
  }
  const expected = selectedCourses(input).map((course) => ({ id: course.productId, quantity: input.quantities[course.id] }));
  const actual = link.items.map(object).map((item) => ({ id: item.product_id, quantity: Number(item.quantity) }));
  if (actual.length !== expected.length || expected.some((item) =>
      actual.filter((candidate) => candidate.id === item.id && candidate.quantity === item.quantity).length !== 1)) {
    throw new CheckoutError('CHECKOUT_MISMATCH', 'The selected courses could not be verified.', 409);
  }
  return checkoutURL(link.url, expectedOrganization(), remoteId(link.id));
}

async function saveLink(row: CheckoutRow, input: CheckoutInput, link: Json) {
  const url = verifyLink(link, row, input);
  const linkId = remoteId(link.id);
  await run('UPDATE dau_checkouts SET link_id = ?, url = ?, stage = ?, error_code = NULL, updated_at = ? WHERE id = ?', linkId, url, 'ready', Date.now(), row.id);
  return { url, checkoutId: row.id, total: row.total_cents / 100, currency: 'SAR', status: 'pending' };
}

export async function createCheckout(sessionId: string, value: unknown, origin: string) {
  const input = validateInput(value, catalog);
  const hash = await fingerprint(input);
  const cents = totalCents(selectedCourses(input), input.quantities);
  return locked(`session:${sessionId}`, async () => {
    const requestKey = `${sessionId}:${input.idempotencyKey}`;
    const savedKey = await one<{ fingerprint: string }>('SELECT fingerprint FROM dau_request_keys WHERE id = ? AND session_id = ?', requestKey, sessionId);
    if (savedKey) assertFingerprint(savedKey.fingerprint, hash);
    let row = await one<CheckoutRow>('SELECT * FROM dau_checkouts WHERE session_id = ? AND client_key = ?', sessionId, input.idempotencyKey);
    if (row) assertFingerprint(row.fingerprint, hash);
    else row = await one<CheckoutRow>('SELECT * FROM dau_checkouts WHERE session_id = ? AND fingerprint = ?', sessionId, hash);
    if (!row) {
      const count = await one<{ total: number }>('SELECT COUNT(*) AS total FROM dau_checkouts WHERE session_id = ? AND created_at > ?', sessionId, Date.now() - 3600000);
      if ((count?.total ?? 0) >= 20) throw new CheckoutError('TOO_MANY_CHECKOUTS', 'Please wait before starting another checkout.', 429);
      const id = crypto.randomUUID();
      await run('INSERT INTO dau_checkouts (id, session_id, client_key, fingerprint, input_json, total_cents, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, sessionId, input.idempotencyKey, hash, JSON.stringify(input), cents, 'new', Date.now(), Date.now());
      row = await one<CheckoutRow>('SELECT * FROM dau_checkouts WHERE id = ?', id);
    }
    if (!row) throw new CheckoutError('STORAGE_UNAVAILABLE', 'Checkout is temporarily unavailable.', 503);
    await run('INSERT OR IGNORE INTO dau_request_keys (id, session_id, fingerprint, checkout_id) VALUES (?, ?, ?, ?)', requestKey, sessionId, hash, row.id);
    if (row.total_cents !== cents) throw new CheckoutError('CATALOG_CHANGED', 'Course pricing has changed. Please refresh before continuing.', 409);
    await verifyAccount();
    if (row.link_id) {
      const link = await provider(`/payment_links/${remoteId(row.link_id)}`);
      const expired = linkExpired(link);
      if (link.status === 'COMPLETED' || expired) {
        const verified = await checkoutStatus(sessionId, row.id);
        if (verified.paid) return { ...verified, url: null };
        if (link.status === 'COMPLETED' || verified.processing) {
          throw new CheckoutError('PAYMENT_CONFIRMING', 'Your payment is being confirmed. Please check again shortly.', 409);
        }
        // Only a provider-confirmed inactive or expired attempt may be replaced.
        // Keep the checkout identity, but isolate remote reconciliation per attempt.
        row.attempt += 1;
        row.link_id = null;
        row.url = null;
        row.stage = 'consumer_ready';
        await run('UPDATE dau_checkouts SET link_id = NULL, url = NULL, stage = ?, attempt = ?, updated_at = ? WHERE id = ?',
          'consumer_ready', row.attempt, Date.now(), row.id);
      } else {
        return saveLink(row, input, link);
      }
    }
    if (!row.consumer_id) {
      row.consumer_id = await consumerFor(input);
      await run('UPDATE dau_checkouts SET consumer_id = ?, stage = ?, updated_at = ? WHERE id = ?', row.consumer_id, 'consumer_ready', Date.now(), row.id);
      row.stage = 'consumer_ready';
    }
    if (row.stage === 'link_sent') {
      const fromDate = new Date(row.created_at - 300000).toISOString();
      const matches = (await list(`/payment_links?from_date=${encodeURIComponent(fromDate)}`))
        .filter((link) => object(link.custom_metadata).dau_checkout_id === row!.id &&
          Number(object(link.custom_metadata).dau_attempt) === row!.attempt);
      if (matches.length > 1) throw new CheckoutError('CHECKOUT_CONFLICT', 'This checkout needs review before another attempt.', 409);
      if (matches[0]) return saveLink(row, input, matches[0]);
      throw new CheckoutError('PENDING_RECONCILIATION', 'Stream is still confirming this checkout. Please retry shortly.', 409);
    }
    const courses = selectedCourses(input);
    const payload: Json = {
      name: courses.length === 1 ? courses[0].name : 'Dar Al Uloom University courses',
      description: courses.map((course) => course.name).join(' · '), currency: 'SAR',
      items: courses.map((course) => ({ product_id: course.productId, quantity: input.quantities[course.id], allow_custom_quantity: false })),
      organization_consumer_id: row.consumer_id, max_number_of_payments: 1,
      valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      custom_metadata: { dau_checkout_id: row.id, dau_attempt: row.attempt, dau_course_ids: input.courseIds.join(','),
        dau_course_dates: JSON.stringify(input.courseDates), dau_quantities: JSON.stringify(input.quantities) },
      success_redirect_url: `${origin}/?payment=return&checkout=${row.id}`,
      failure_redirect_url: `${origin}/?payment=return&checkout=${row.id}`,
    };
    // Persist the intent before the provider write. An uncertain outcome is never blindly retried.
    await verifyAccount();
    await run('UPDATE dau_checkouts SET stage = ?, updated_at = ? WHERE id = ?', 'link_sent', Date.now(), row.id);
    try { return await saveLink(row, input, await provider('/payment_links', payload)); }
    catch (error) {
      if (error instanceof CheckoutError && error.providerStatus && [400, 401, 403, 404, 409, 422].includes(error.providerStatus)) {
        await run('UPDATE dau_checkouts SET stage = ?, error_code = ?, updated_at = ? WHERE id = ?', 'consumer_ready', error.code, Date.now(), row.id);
      }
      throw error;
    }
  });
}

export async function checkoutStatus(sessionId: string, checkoutId: string | null) {
  if (checkoutId && !UUID.test(checkoutId)) throw new CheckoutError('CHECKOUT_NOT_FOUND', 'Checkout not found.', 404);
  const row = checkoutId
    ? await one<CheckoutRow>('SELECT * FROM dau_checkouts WHERE session_id = ? AND id = ?', sessionId, checkoutId)
    : await one<CheckoutRow>('SELECT * FROM dau_checkouts WHERE session_id = ? ORDER BY created_at DESC LIMIT 1', sessionId);
  if (!row) throw new CheckoutError('CHECKOUT_NOT_FOUND', 'Checkout not found.', 404);
  if (!row.link_id) return { checkoutId: row.id, status: 'pending', paid: false, processing: false, total: row.total_cents / 100, currency: 'SAR' };
  await verifyAccount();
  const link = await provider(`/payment_links/${remoteId(row.link_id)}`);
  const saved = object(JSON.parse(row.input_json));
  verifyLink(link, row, validateInput({ courseIds: saved.courseIds, firstName: saved.firstName,
    quantities: saved.quantities, courseDates: saved.courseDates,
    lastName: saved.lastName, phone: saved.phone, email: saved.email, idempotencyKey: saved.idempotencyKey }, catalog));
  const invoices = await list(`/invoices?payment_link_id=${row.link_id}&organization_consumer_id=${row.consumer_id}&include_payments=true`);
  let paid = false;
  let failed = false;
  let processing = false;
  for (const invoice of invoices) {
    if (invoice.organization_id !== expectedOrganization() || invoice.organization_consumer_id !== row.consumer_id ||
        invoice.payment_link_id !== row.link_id || invoice.currency !== 'SAR' ||
        Number(invoice.total_amount_in_smallest_unit) !== row.total_cents) continue;
    const payments = Array.isArray(invoice.payments) ? invoice.payments.map(object) : [];
    const settledCents = payments.filter((payment) => ['SUCCEEDED', 'SETTLED'].includes(String(payment.current_status)) && payment.currency === 'SAR')
      .reduce((sum, payment) => sum + Number(payment.amount_in_smallest_unit || 0) - Math.round(Number(payment.amount_refunded || 0) * 100), 0);
    if (invoice.status === 'COMPLETED' && Number(invoice.remaining_amount_in_smallest_unit) === 0 &&
        Number(invoice.paid_amount_in_smallest_unit) >= row.total_cents && settledCents >= row.total_cents) paid = true;
    if (payments.some((payment) => ['FAILED', 'FAILED_INITIATION', 'CANCELED', 'EXPIRED'].includes(String(payment.current_status)))) failed = true;
    if (payments.some((payment) => ['PENDING', 'PROCESSING', 'UNDER_REVIEW'].includes(String(payment.current_status)))) processing = true;
  }
  const expired = linkExpired(link);
  return { checkoutId: row.id, status: paid ? 'paid' : processing ? 'pending' : expired ? 'expired' : failed ? 'failed' : 'pending', paid, processing,
    total: row.total_cents / 100, currency: 'SAR' };
}

export function apiResponse(value: unknown, status = 200, cookie?: string): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
    ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}

export function apiError(error: unknown, cookie?: string): Response {
  if (error instanceof CheckoutError) return apiResponse({ error: error.message, code: error.code }, error.status, cookie);
  console.error('DAU checkout request failed', { errorType: error instanceof Error ? error.name : 'unknown' });
  return apiResponse({ error: 'Checkout is temporarily unavailable. Please try again.', code: 'CHECKOUT_UNAVAILABLE' }, 503, cookie);
}
