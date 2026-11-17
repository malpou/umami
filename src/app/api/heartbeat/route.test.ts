import { beforeEach, expect, test, vi } from 'vitest';
import { checkKv } from '@/lib/kv';
import { GET } from './route';

vi.mock('@/lib/kv', () => ({ checkKv: vi.fn() }));

const checkKvMock = vi.mocked(checkKv);

beforeEach(() => {
  checkKvMock.mockReset();
});

test('the plain heartbeat does not touch NATS KV', async () => {
  checkKvMock.mockRejectedValue(new Error('closed connection'));

  const response = await GET(new Request('http://localhost/api/heartbeat'));

  expect(response.status).toBe(200);
  expect(checkKvMock).not.toHaveBeenCalled();
});

test('?kv is ready when both buckets can be read', async () => {
  checkKvMock.mockResolvedValue({ auth: 'a', cache: 'c' });

  const response = await GET(new Request('http://localhost/api/heartbeat?kv'));

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true });
});

test('?kv is not ready when NATS KV fails', async () => {
  checkKvMock.mockRejectedValue(new Error('closed connection'));

  const response = await GET(new Request('http://localhost/api/heartbeat?kv'));

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({ ok: false, error: 'closed connection' });
});
