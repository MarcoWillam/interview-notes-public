import { env } from 'cloudflare:workers';
import { handleAsrStream, type AsrEnv } from '@/lib/asr/relay';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handleAsrStream(request, env as AsrEnv);
}
