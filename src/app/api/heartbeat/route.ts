import { checkKv } from '@/lib/kv';

// `?kv` also reads both NATS KV buckets, for the readiness probe: every collect and
// login request needs them, so a pod that cannot reach them should not get traffic.
// Liveness keeps the plain check, so a NATS outage does not restart the pod.
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.has('kv')) {
    try {
      await checkKv();
    } catch (e) {
      return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
    }
  }

  return Response.json({ ok: true });
}
