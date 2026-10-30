/* eslint-disable no-console */

// Logins are only valid while their session is in NATS KV, so a missing or unreachable
// store would quietly lock everyone out; so would an incomplete GUARD_IDENTITY
// config behind guard. Refuse to start instead.
export async function register() {
  if (
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return;
  }

  if (process.env.GUARD_IDENTITY) {
    const { guardConfigError } = await import('@/lib/guard-identity');
    const guardError = guardConfigError();

    if (guardError) {
      console.error(`GUARD_IDENTITY is set but incomplete: ${guardError}`);
      process.exit(1);
      return;
    }
  }

  const { checkKv } = await import('@/lib/kv');

  try {
    const { auth, cache } = await checkKv();

    console.log(`NATS KV buckets ${auth} and ${cache} are reachable.`);
  } catch (e) {
    console.error(`NATS KV check failed: ${(e as Error).message}`);
    console.error('Umami stores login sessions in NATS KV and cannot run without it.');
    process.exit(1);
  }
}
