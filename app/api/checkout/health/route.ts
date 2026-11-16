import { apiError, apiResponse, checkoutHealth } from '@/lib/stream-checkout';

export const dynamic = 'force-dynamic';

export async function GET() {
  try { return apiResponse(await checkoutHealth()); }
  catch (error) { return apiError(error); }
}
