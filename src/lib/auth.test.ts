import { beforeEach, describe, expect, test, vi } from 'vitest';
import { hash } from '@/lib/crypto';
import { parseSecureToken } from '@/lib/jwt';
import kv from '@/lib/kv';
import { getUser } from '@/queries/prisma/user';
import { checkAuth } from './auth';

vi.mock('@/lib/jwt', () => ({
  parseSecureToken: vi.fn(),
  parseToken: vi.fn(() => null),
}));

vi.mock('@/queries/prisma/user', () => ({
  getUser: vi.fn(),
}));

vi.mock('@/lib/kv', () => ({
  default: {
    auth: {
      get: vi.fn(),
    },
  },
}));

const parseSecureTokenMock = vi.mocked(parseSecureToken);
const getUserMock = vi.mocked(getUser);
const kvMock = kv as unknown as {
  auth: {
    get: ReturnType<typeof vi.fn>;
  };
};

const PASSWORD_HASH = '$2b$10$currentpasswordhashvalue';

function authedRequest() {
  return new Request('http://localhost/api/test', {
    headers: { authorization: 'Bearer secure-token' },
  });
}

function mockUser() {
  getUserMock.mockResolvedValue({
    id: 'user-1',
    username: 'bob',
    role: 'user',
    password: PASSWORD_HASH,
  } as any);
}

beforeEach(() => {
  parseSecureTokenMock.mockReset();
  getUserMock.mockReset();
  kvMock.auth.get.mockReset();
});

describe('checkAuth sessions', () => {
  test('authorizes a KV session whose fingerprint matches the current password', async () => {
    parseSecureTokenMock.mockReturnValue({ authKey: 'auth:session-key' } as any);
    kvMock.auth.get.mockResolvedValue({ userId: 'user-1', pwd: hash(PASSWORD_HASH) });
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(kvMock.auth.get).toHaveBeenCalledWith('auth:session-key');
    expect(result?.user?.id).toBe('user-1');
  });

  test('authorizes a KV session that does not include a password fingerprint', async () => {
    parseSecureTokenMock.mockReturnValue({ authKey: 'auth:session-key' } as any);
    kvMock.auth.get.mockResolvedValue({ userId: 'user-1' });
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result?.user?.id).toBe('user-1');
  });

  test('rejects a KV session whose fingerprint predates a password change', async () => {
    parseSecureTokenMock.mockReturnValue({ authKey: 'auth:session-key' } as any);
    kvMock.auth.get.mockResolvedValue({ userId: 'user-1', pwd: hash('old-password-hash') });
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result).toBeNull();
  });

  test('rejects a session that is no longer in KV (logged out or expired)', async () => {
    parseSecureTokenMock.mockReturnValue({ authKey: 'auth:session-key' } as any);
    kvMock.auth.get.mockResolvedValue(null);
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  test('rejects a stateless token, which could not be revoked', async () => {
    parseSecureTokenMock.mockReturnValue({ userId: 'user-1', pwd: hash(PASSWORD_HASH) } as any);
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result).toBeNull();
    expect(kvMock.auth.get).not.toHaveBeenCalled();
  });

  test('rejects a partial 2FA token as a full login', async () => {
    parseSecureTokenMock.mockReturnValue({ userId: 'user-1', type: 'partial-auth' } as any);
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result).toBeNull();
  });

  test('does not expose the password hash on the returned user', async () => {
    parseSecureTokenMock.mockReturnValue({ authKey: 'auth:session-key' } as any);
    kvMock.auth.get.mockResolvedValue({ userId: 'user-1', pwd: hash(PASSWORD_HASH) });
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result?.user).not.toHaveProperty('password');
  });
});
