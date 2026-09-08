import { env } from 'cloudflare:workers';
import { handleTranscription, type ServiceEnv } from '@/lib/services';
export function POST(request: Request) {
  return handleTranscription(request, env as ServiceEnv);
}
