import { apiError, apiResponse, currentSession } from '@/lib/stream-checkout';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await currentSession(request, true);
    return apiResponse({ ready: true }, 200, session.cookie);
  } catch (error) { return apiError(error); }
}
