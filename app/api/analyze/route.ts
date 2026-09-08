import { env } from 'cloudflare:workers';
import { handleAnalysis, type ServiceEnv } from '@/lib/services';
export function POST(request: Request) {
  return handleAnalysis(request, env as ServiceEnv);
}
