import { sameOrigin } from '@/lib/stream-core';
import { apiError, apiResponse, boundedJSON, createCheckout, currentSession } from '@/lib/stream-checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let cookie: string | undefined;
  try {
    sameOrigin(request);
    const value = await boundedJSON(request.body);
    const session = await currentSession(request, true);
    cookie = session.cookie;
    return apiResponse(await createCheckout(session.id, value, new URL(request.url).origin), 200, cookie);
  } catch (error) { return apiError(error, cookie); }
}
