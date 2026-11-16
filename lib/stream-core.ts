export type Course = { id: string; name: string; price: number; productId: string; dates?: string[] };
export type CheckoutInput = {
  courseIds: string[];
  quantities: Record<string, number>;
  courseDates: Record<string, string>;
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  email: string | null;
  idempotencyKey: string;
};

export class CheckoutError extends Error {
  code: string;
  status: number;
  providerStatus?: number;
  constructor(code: string, message: string, status = 400, providerStatus?: number) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
    this.status = status;
    this.providerStatus = providerStatus;
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function field(value: unknown, label: string, max = 100): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new CheckoutError('INVALID_INPUT', `Please enter a valid ${label}.`);
  }
  const result = value.trim().replace(/\s+/g, ' ');
  if (!result || result.length > max) throw new CheckoutError('INVALID_INPUT', `Please enter a valid ${label}.`);
  return result;
}

export function normalizePhone(value: unknown): string {
  const raw = field(value, 'mobile number', 30).replace(/[\s()\-]/g, '')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0));
  let phone = raw.startsWith('00') ? `+${raw.slice(2)}` : raw;
  if (/^05\d{8}$/.test(phone)) phone = `+966${phone.slice(1)}`;
  else if (/^5\d{8}$/.test(phone)) phone = `+966${phone}`;
  else if (/^9665\d{8}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || (phone.startsWith('+966') && !/^\+966[1-9]\d{8}$/.test(phone))) {
    throw new CheckoutError('INVALID_PHONE', 'Please enter a valid phone number with its country code, or a Saudi mobile number starting with 05.');
  }
  return phone;
}

export function validateInput(value: unknown, catalog: Course[]): CheckoutInput {
  const input = object(value);
  const allowed = new Set(['courseIds', 'quantities', 'courseDates', 'firstName', 'lastName', 'phone', 'email', 'idempotencyKey']);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new CheckoutError('INVALID_INPUT', 'The checkout request contains unsupported fields.');
  }
  const firstName = field(input.firstName, 'first name');
  const lastName = field(input.lastName, 'last name');
  const idempotencyKey = field(input.idempotencyKey, 'request identifier');
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
    throw new CheckoutError('INVALID_REQUEST', 'Refresh the page and try again.');
  }
  if (!Array.isArray(input.courseIds) || !input.courseIds.length || input.courseIds.length > 9 ||
      input.courseIds.some((id) => typeof id !== 'string' || !catalog.some((course) => course.id === id)) ||
      new Set(input.courseIds).size !== input.courseIds.length) {
    throw new CheckoutError('INVALID_COURSES', 'Please choose a course from the catalogue.');
  }
  const courseIds = [...input.courseIds].sort();
  const rawQuantities = input.quantities === undefined ? {} : object(input.quantities);
  const rawDates = input.courseDates === undefined ? {} : object(input.courseDates);
  if ((input.quantities !== undefined && (!input.quantities || Array.isArray(input.quantities) || typeof input.quantities !== 'object')) ||
      (input.courseDates !== undefined && (!input.courseDates || Array.isArray(input.courseDates) || typeof input.courseDates !== 'object')) ||
      [...Object.keys(rawQuantities), ...Object.keys(rawDates)].some((key) => !courseIds.includes(key))) {
    throw new CheckoutError('INVALID_SELECTION', 'Please check your selected courses.');
  }
  const quantities: Record<string, number> = {};
  const courseDates: Record<string, string> = {};
  for (const id of courseIds) {
    const quantity = rawQuantities[id] ?? 1;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new CheckoutError('INVALID_QUANTITY', 'Please choose a quantity between 1 and 20.');
    }
    quantities[id] = quantity;
    const availableDates = catalog.find((course) => course.id === id)?.dates ?? [];
    if (availableDates.length) {
      if (typeof rawDates[id] !== 'string' || !availableDates.includes(rawDates[id])) {
        throw new CheckoutError('INVALID_COURSE_DATE', 'Please select an available date for each course.');
      }
      courseDates[id] = rawDates[id];
    } else if (rawDates[id] !== undefined && rawDates[id] !== '') {
      throw new CheckoutError('INVALID_COURSE_DATE', 'This course does not have a date selection.');
    }
  }
  let email: string | null = null;
  if (input.email != null && input.email !== '') {
    email = field(input.email, 'email address', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new CheckoutError('INVALID_EMAIL', 'Please enter a valid email address.');
    }
  }
  return { courseIds, quantities, courseDates, firstName, lastName,
    name: `${firstName} ${lastName}`, phone: normalizePhone(input.phone), email, idempotencyKey };
}

export function sameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new CheckoutError('ORIGIN_REJECTED', 'Please start checkout from this website.', 403);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new CheckoutError('INVALID_CONTENT_TYPE', 'The checkout request could not be read.', 415);
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sessionFromCookie(request: Request): string | null {
  const value = request.headers.get('cookie')?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('dau_checkout_session='))?.slice('dau_checkout_session='.length);
  return value && UUID.test(value) ? value : null;
}

export function checkoutURL(value: unknown, organizationId: string, verifiedLinkId?: string): string {
  try {
    if (typeof value !== 'string') throw new Error();
    let url = new URL(value);
    if (url.username || url.password || url.hash) throw new Error();
    if (url.origin === 'https://streampay.sa' && /^\/ss\/[A-Za-z0-9_-]{4,64}$/.test(url.pathname) && !url.search) {
      // Verified 16 Nov 2026: staging's authenticated link response returns this
      // short-link format, which redirects to the canonical staging checkout.
      // Build from the separately verified API record ID; no credentials or
      // payer data are sent through the short-link service during resolution.
      if (!verifiedLinkId || !UUID.test(verifiedLinkId)) throw new Error();
      url = new URL(`https://staging.billing.streampay.sa/payment-link/${verifiedLinkId}`);
      url.searchParams.set('organization_id', organizationId);
    }
    if (url.origin !== 'https://staging.billing.streampay.sa' || url.username || url.password ||
        !/^\/payment-link\/[0-9a-f-]{36}\/?$/i.test(url.pathname) ||
        url.searchParams.get('organization_id') !== organizationId ||
        (verifiedLinkId && url.pathname.replace(/\/$/, '').split('/').pop() !== verifiedLinkId)) throw new Error();
    url.searchParams.set('embed', 'true');
    url.searchParams.set('language', 'en');
    return url.toString();
  } catch {
    throw new CheckoutError('INVALID_CHECKOUT_URL', 'The secure checkout address could not be verified.', 502);
  }
}

export async function fingerprint(input: CheckoutInput): Promise<string> {
  return digest(JSON.stringify({ courseIds: input.courseIds, quantities: input.quantities, courseDates: input.courseDates,
    name: input.name, phone: input.phone, email: input.email }));
}

export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function totalCents(courses: Course[], quantities: Record<string, number> = {}): number {
  const total = courses.reduce((sum, course) => sum + Math.round(course.price * 100) * (quantities[course.id] ?? 1), 0);
  if (!Number.isSafeInteger(total) || total <= 0 || courses.some((course) => !UUID.test(course.productId))) {
    throw new CheckoutError('CATALOG_UNAVAILABLE', 'This course is not ready for checkout yet.', 503);
  }
  return total;
}

export function assertFingerprint(saved: string, current: string): void {
  if (saved !== current) throw new CheckoutError('REQUEST_CONFLICT', 'These details changed. Please start a new checkout.', 409);
}

export function linkExpired(link: Record<string, unknown>, now = Date.now()): boolean {
  return link.status === 'INACTIVE' || (typeof link.valid_until === 'string' && Date.parse(link.valid_until) < now);
}

export function consumerProfileUpdate(consumer: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const needsUpdate = consumer.name !== name || consumer.preferred_language !== 'EN' ||
    (Array.isArray(consumer.communication_methods) && consumer.communication_methods.length > 0);
  if (!needsUpdate) return null;
  // A reused consumer may have verified/locked contact details. Registration
  // email and phone remain part of this checkout's saved input; they must not
  // overwrite the provider's existing consumer contact identity. Include the
  // exact current values in this PUT so omission cannot be interpreted as a
  // request to clear a locked phone number or email address.
  return { name, preferred_language: 'EN', communication_methods: [],
    phone_number: typeof consumer.phone_number === 'string' ? consumer.phone_number : null,
    email: typeof consumer.email === 'string' ? consumer.email : null };
}
