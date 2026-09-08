import { env } from 'cloudflare:workers';
import { serviceStatus, type ServiceEnv } from '@/lib/services';
export function GET() {
  return Response.json(serviceStatus(env as ServiceEnv), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
