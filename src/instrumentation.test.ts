import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { checkKv } = vi.hoisted(() => ({ checkKv: vi.fn() }));

vi.mock('@/lib/kv', () => ({ checkKv }));

import { register } from './instrumentation';

let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  checkKv.mockReset();
  process.env.NEXT_RUNTIME = 'nodejs';
  delete process.env.NEXT_PHASE;
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_RUNTIME;
});

test('starts when the KV buckets are reachable', async () => {
  checkKv.mockResolvedValue({ auth: 'umami_auth', cache: 'umami_cache' });

  await register();

  expect(checkKv).toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
});

test('exits when NATS KV is missing or unreachable', async () => {
  checkKv.mockRejectedValue(new Error('NATS_URL is not defined.'));

  await register();

  expect(exit).toHaveBeenCalledWith(1);
  expect(console.error).toHaveBeenCalledWith('NATS KV check failed: NATS_URL is not defined.');
});

test('skips the check outside the Node.js runtime and during the build', async () => {
  process.env.NEXT_RUNTIME = 'edge';
  await register();

  process.env.NEXT_RUNTIME = 'nodejs';
  process.env.NEXT_PHASE = 'phase-production-build';
  await register();

  expect(checkKv).not.toHaveBeenCalled();
});
