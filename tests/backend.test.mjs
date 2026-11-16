import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFingerprint, checkoutURL, consumerProfileUpdate, fingerprint, linkExpired, normalizePhone, sameOrigin, sessionFromCookie,
  totalCents, validateInput } from '../lib/stream-core.ts';

const organization = '11111111-1111-4111-8111-111111111111';
const productId = '19b81b15-54b4-4c82-9405-98d239f8d151';
const courses = [
  { id: 'first-aid', name: 'First Aid', price: 250, productId },
  { id: 'cpr', name: 'CPR', price: 1000, productId: '734a9ec2-0d5e-443a-820a-0289b8cf3cd7' },
];
const input = { courseIds: ['first-aid'], firstName: '  Amina ', lastName: 'Al   Salem ', phone: '050 123 4567',
  email: 'Amina@Example.com', idempotencyKey: '7bdc5a0a-51e3-40eb-909d-f872db45d8af' };

test('form names are appended and mobile/email normalized', () => {
  const result = validateInput(input, courses);
  assert.equal(result.name, 'Amina Al Salem');
  assert.equal(result.phone, '+966501234567');
  assert.equal(result.email, 'amina@example.com');
  for (const phone of ['0501234567', '501234567', '966501234567', '+966501234567', '00966501234567', '٠٥٠١٢٣٤٥٦٧']) {
    assert.equal(normalizePhone(phone), '+966501234567');
  }
  assert.equal(normalizePhone('+15551234567'), '+15551234567');
  assert.equal(normalizePhone('00442079460958'), '+442079460958');
  assert.throws(() => normalizePhone('+966123'));
});

test('server catalogue rejects prices, foreign product IDs and duplicate course selection', () => {
  assert.throws(() => validateInput({ ...input, total: 1 }, courses));
  assert.throws(() => validateInput({ ...input, consumerId: 'someone-else' }, courses));
  assert.throws(() => validateInput({ ...input, courseIds: [productId] }, courses));
  assert.throws(() => validateInput({ ...input, courseIds: ['first-aid', 'first-aid'] }, courses));
  assert.equal(totalCents(courses), 125000);
  assert.equal(totalCents(courses, { 'first-aid': 2 }), 150000);
  assert.throws(() => totalCents([{ ...courses[0], productId: '' }]));
});

test('quantities and dates are bounded and included in the checkout fingerprint', async () => {
  const datedCourses = [{ ...courses[0], dates: ['03/03/2026', '10/03/2026'] }];
  const valid = { ...input, quantities: { 'first-aid': 2 }, courseDates: { 'first-aid': '03/03/2026' } };
  const parsed = validateInput(valid, datedCourses);
  assert.equal(totalCents(datedCourses, parsed.quantities), 50000);
  assert.throws(() => validateInput(input, datedCourses));
  assert.throws(() => validateInput({ ...valid, courseDates: { 'first-aid': '01/01/2030' } }, datedCourses));
  assert.throws(() => validateInput({ ...valid, quantities: { 'first-aid': 0 } }, datedCourses));
  assert.throws(() => validateInput({ ...valid, quantities: { 'first-aid': 1.5 } }, datedCourses));
  assert.throws(() => validateInput({ ...valid, quantities: { 'first-aid': 21 } }, datedCourses));
  const later = validateInput({ ...valid, courseDates: { 'first-aid': '10/03/2026' } }, datedCourses);
  assert.notEqual(await fingerprint(parsed), await fingerprint(later));
});

test('a repeated request is canonical but changed payer or selection conflicts', async () => {
  const first = validateInput({ ...input, courseIds: ['first-aid', 'cpr'] }, courses);
  const reordered = validateInput({ ...input, courseIds: ['cpr', 'first-aid'], phone: '+966501234567' }, courses);
  const originalHash = await fingerprint(first);
  assert.equal(originalHash, await fingerprint(reordered));
  assert.doesNotThrow(() => assertFingerprint(originalHash, originalHash));
  const changed = await fingerprint(validateInput({ ...input, firstName: 'Sara' }, courses));
  assert.throws(() => assertFingerprint(originalHash, changed));
});

test('only expected staging checkout origin, path and organization can be embedded', () => {
  const url = `https://staging.billing.streampay.sa/payment-link/${productId}?organization_id=${organization}`;
  const verified = new URL(checkoutURL(url, organization));
  assert.equal(verified.searchParams.get('embed'), 'true');
  assert.equal(verified.searchParams.get('language'), 'en');
  assert.throws(() => checkoutURL(url.replace('staging.billing', 'billing'), organization));
  assert.throws(() => checkoutURL(url.replace(organization, productId), organization));
  assert.throws(() => checkoutURL(url.replace('/payment-link/', '/redirect/'), organization));
  assert.throws(() => checkoutURL('javascript:alert(1)', organization));
});

test('authenticated staging short-link response maps to its verified canonical checkout', () => {
  // Synthetic identifiers matching the staging API response shape verified 16 Nov 2026.
  const response = { id: '11111111-2222-4333-8444-555555555555', url: 'https://streampay.sa/ss/Demo1',
    organization_id: organization, currency: 'SAR', amount_in_smallest_unit: 50000 };
  const resolved = new URL(checkoutURL(response.url, response.organization_id, response.id));
  assert.equal(resolved.origin, 'https://staging.billing.streampay.sa');
  assert.equal(resolved.pathname, `/payment-link/${response.id}`);
  assert.equal(resolved.searchParams.get('organization_id'), organization);
  assert.equal(resolved.searchParams.get('embed'), 'true');
  assert.equal(resolved.searchParams.get('language'), 'en');
  assert.throws(() => checkoutURL(response.url, organization));
  assert.throws(() => checkoutURL(response.url.replace('/ss/', '/sp/'), organization, response.id));
  assert.throws(() => checkoutURL(`${response.url}?next=https://evil.example`, organization, response.id));
  assert.throws(() => checkoutURL(response.url.replace('streampay.sa', 'evil.example'), organization, response.id));
  assert.throws(() => checkoutURL(resolved.href, organization, productId));
});

test('mutations require same origin JSON and sessions use a separate validated HttpOnly cookie', () => {
  const valid = new Request('https://dau.example/api/checkout', { method: 'POST', headers: {
    origin: 'https://dau.example', 'content-type': 'application/json', cookie: `dau_checkout_session=${productId}` } });
  assert.doesNotThrow(() => sameOrigin(valid));
  assert.equal(sessionFromCookie(valid), productId);
  assert.throws(() => sameOrigin(new Request(valid, { headers: { origin: 'https://evil.example', 'content-type': 'application/json' } })));
  assert.throws(() => sameOrigin(new Request(valid, { headers: { 'content-type': 'application/json' } })));
  assert.equal(sessionFromCookie(new Request(valid, { headers: { cookie: 'dau_checkout_session=../../somewhere' } })), null);
});

test('only confirmed inactive or time-expired links qualify for renewal checks', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(linkExpired({ status: 'ACTIVE', valid_until: '2026-11-17T12:00:00Z' }, now), false);
  assert.equal(linkExpired({ status: 'ACTIVE', valid_until: '2026-11-15T12:00:00Z' }, now), true);
  assert.equal(linkExpired({ status: 'INACTIVE' }, now), true);
  assert.equal(linkExpired({ status: 'ACTIVE', valid_until: 'invalid' }, now), false);
  assert.equal(linkExpired({ status: 'COMPLETED' }, now), false);
});

test('reused consumers retain locked contacts while name and English can be updated', () => {
  const consumer = { name: 'Previous Name', phone_number: '+966501234567', email: 'verified@example.com',
    preferred_language: 'AR', communication_methods: ['EMAIL'] };
  const update = consumerProfileUpdate(consumer, 'Amina Al Salem');
  assert.deepEqual(update, { name: 'Amina Al Salem', preferred_language: 'EN', communication_methods: [],
    phone_number: '+966501234567', email: 'verified@example.com' });
  assert.equal(consumer.email, 'verified@example.com');
  assert.equal(consumer.phone_number, '+966501234567');
});

test('a different registration email alone never triggers a consumer update', () => {
  const registration = validateInput({ ...input, email: 'registration@example.com' }, courses);
  const consumer = { name: registration.name, phone_number: registration.phone, email: 'verified@example.com',
    preferred_language: 'EN', communication_methods: [] };
  assert.equal(consumerProfileUpdate(consumer, registration.name), null);
  assert.deepEqual(consumerProfileUpdate({ ...consumer, preferred_language: 'AR' }, registration.name), {
    name: registration.name, preferred_language: 'EN', communication_methods: [],
    phone_number: registration.phone, email: 'verified@example.com' });
  assert.deepEqual(consumerProfileUpdate({ ...consumer, preferred_language: 'AR', email: null }, registration.name), {
    name: registration.name, preferred_language: 'EN', communication_methods: [],
    phone_number: registration.phone, email: null });
});
