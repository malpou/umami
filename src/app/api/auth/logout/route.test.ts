import { beforeEach, expect, test, vi } from 'vitest';
import kv from '@/lib/kv';
import { parseRequest } from '@/lib/request';
import { POST } from './route';

vi.mock('@/lib/kv', () => ({
  default: {
    auth: {
      del: vi.fn(),
    },
  },
}));

vi.mock('@/lib/request', () => ({
  parseRequest: vi.fn(),
}));

vi.mock('@/lib/response', () => ({
  ok: () => new Response(null, { status: 200 }),
}));

const kvMock = kv as unknown as {
  auth: {
    del: ReturnType<typeof vi.fn>;
  };
};
const parseRequestMock = vi.mocked(parseRequest);

beforeEach(() => {
  kvMock.auth.del.mockReset();
  parseRequestMock.mockReset();
});

test('POST deletes the authenticated KV auth key', async () => {
  parseRequestMock.mockResolvedValue({
    auth: { authKey: 'auth:session-key' },
    error: undefined,
  });

  const response = await POST(
    new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secure-token',
      },
    }),
  );

  expect(kvMock.auth.del).toHaveBeenCalledTimes(1);
  expect(kvMock.auth.del).toHaveBeenCalledWith('auth:session-key');
  expect(kvMock.auth.del).not.toHaveBeenCalledWith('secure-token');
  expect(response.status).toBe(200);
});

test('POST does not delete a key when auth fails', async () => {
  parseRequestMock.mockResolvedValue({
    auth: null,
    error: () => new Response(null, { status: 401 }),
  });

  const response = await POST(new Request('http://localhost/api/auth/logout', { method: 'POST' }));

  expect(kvMock.auth.del).not.toHaveBeenCalled();
  expect(response.status).toBe(401);
});
