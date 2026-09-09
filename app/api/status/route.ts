import { env } from 'cloudflare:workers';
import { serviceStatus, type ServiceEnv } from '@/lib/services';
export function GET() {
  return Response.json(
    { analysis: serviceStatus(env as ServiceEnv).analysis },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
