import { apiError, apiResponse, checkoutStatus, currentSession } from '@/lib/stream-checkout';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await currentSession(request, false);
    return apiResponse(await checkoutStatus(session.id, new URL(request.url).searchParams.get('checkoutId')));
  } catch (error) { return apiError(error); }
}
