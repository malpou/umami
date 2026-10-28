import { beforeEach, expect, test, vi } from 'vitest';
import { parseRequest } from '@/lib/request';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  createApiKey: vi.fn(),
  getUserApiKeys: vi.fn(),
}));

vi.mock('@/lib/request', () => ({
  parseRequest: vi.fn(),
}));

vi.mock('@/queries/prisma/apiKey', () => ({
  createApiKey: mocks.createApiKey,
  getUserApiKeys: mocks.getUserApiKeys,
}));

const parseRequestMock = vi.mocked(parseRequest);

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('CLOUD_MODE', '');
  parseRequestMock.mockReset();
  mocks.createApiKey.mockReset();
  mocks.getUserApiKeys.mockReset();

  parseRequestMock.mockResolvedValue({
    auth: { user: { id: 'user-1' } },
    body: { name: 'CI pipeline' },
    error: undefined,
  });
});

test('GET refuses to list api keys outside cloud mode (disabled in this fork)', async () => {
  const response = await GET(new Request('http://localhost/api/me/api-keys'));

  expect(response.status).toBe(404);
  expect(mocks.getUserApiKeys).not.toHaveBeenCalled();
});

test('GET returns 404 in cloud mode', async () => {
  vi.stubEnv('CLOUD_MODE', '1');

  const response = await GET(new Request('http://localhost/api/me/api-keys'));

  expect(response.status).toBe(404);
  expect(mocks.getUserApiKeys).not.toHaveBeenCalled();
});

test('GET returns the auth error when unauthenticated', async () => {
  parseRequestMock.mockResolvedValue({
    auth: null,
    error: () => new Response(null, { status: 401 }),
  });

  const response = await GET(new Request('http://localhost/api/me/api-keys'));

  expect(response.status).toBe(401);
});

test('POST refuses to create an api key outside cloud mode (disabled in this fork)', async () => {
  const response = await POST(new Request('http://localhost/api/me/api-keys', { method: 'POST' }));

  expect(response.status).toBe(404);
  expect(mocks.createApiKey).not.toHaveBeenCalled();
});

test('POST returns 404 in cloud mode', async () => {
  vi.stubEnv('CLOUD_MODE', '1');

  const response = await POST(new Request('http://localhost/api/me/api-keys', { method: 'POST' }));

  expect(response.status).toBe(404);
  expect(mocks.createApiKey).not.toHaveBeenCalled();
});
