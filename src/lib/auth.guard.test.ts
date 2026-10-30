import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { hash } from '@/lib/crypto';
import { resetVerifier } from '@/lib/guard-identity';
import { parseSecureToken, parseToken } from '@/lib/jwt';
import kv from '@/lib/kv';
import { parseRequest } from '@/lib/request';
import { getUser, getUserByOidcIdentity } from '@/queries/prisma/user';
import { startTestIssuer, type TestIssuer } from '@/test/edgeauth';
import { checkAuth } from './auth';

// checkAuth behind guard (GUARD_IDENTITY=1), with identity JWTs minted by a
// local ES256 issuer and verified by @metsaapp/edgeauth against its JWKS.

vi.mock('@/lib/jwt', () => ({
  parseSecureToken: vi.fn(),
  parseToken: vi.fn(() => null),
}));

vi.mock('@/queries/prisma/user', () => ({
  getUser: vi.fn(),
  getUserByOidcIdentity: vi.fn(),
  getUserForOidcLink: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('@/queries/prisma/apiKey', () => ({
  getApiKeyByHash: vi.fn(),
  updateApiKeyLastUsed: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/kv', () => ({
  default: { auth: { get: vi.fn() } },
}));

const HOST = 'insights.example.com';
const SUBJECT = '123456789012345678';
const PASSWORD_HASH = '$2b$10$currentpasswordhashvalue';

const parseSecureTokenMock = vi.mocked(parseSecureToken);
const parseTokenMock = vi.mocked(parseToken);
const getUserMock = vi.mocked(getUser);
const getUserByOidcIdentityMock = vi.mocked(getUserByOidcIdentity);
const kvGetMock = (kv as unknown as { auth: { get: ReturnType<typeof vi.fn> } }).auth.get;

let issuer: TestIssuer;

beforeAll(async () => {
  issuer = await startTestIssuer();
});

afterAll(async () => {
  await issuer.close();
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('APP_SECRET', 'test-secret');
  vi.stubEnv('CLOUD_MODE', '');
  vi.stubEnv('GUARD_IDENTITY', '1');
  vi.stubEnv('GUARD_USER_ISSUER', 'https://idp.example.com');
  vi.stubEnv('GUARD_ROLE_ADMIN', 'umami-admin');
  vi.stubEnv('PLATFORM_KIT_EDGEAUTH_AUDIENCES', HOST);
  vi.stubEnv('PLATFORM_KIT_EDGEAUTH_JWKS_URL', issuer.jwksUrl);
  resetVerifier();
  parseSecureTokenMock.mockReset();
  parseTokenMock.mockReset().mockReturnValue(null);
  getUserMock.mockReset();
  getUserByOidcIdentityMock.mockReset();
  kvGetMock.mockReset();
});

function request(headers: Record<string, string> = {}) {
  return new Request(`https://${HOST}/api/websites`, { headers });
}

function mockLinkedAdmin() {
  getUserByOidcIdentityMock.mockResolvedValue({
    id: 'user-1',
    username: 'bob',
    role: 'admin',
    displayName: 'Bob',
  } as any);
  getUserMock.mockResolvedValue({
    id: 'user-1',
    username: 'bob',
    role: 'admin',
    createdAt: new Date(),
    twoFactorRequired: false,
  } as any);
}

describe('checkAuth behind guard', () => {
  test('signs in the Umami user linked to the identity, as admin', async () => {
    mockLinkedAdmin();
    const token = issuer.mint({ sub: SUBJECT, name: 'Bob', roles: ['umami-admin'] }, HOST);

    const result = await checkAuth(request({ 'x-bastion-identity': token }));

    expect(result?.authType).toBe('session');
    expect(result?.user).toMatchObject({ id: 'user-1', role: 'admin', isAdmin: true });
    expect(result?.user).not.toHaveProperty('password');
    expect(getUserByOidcIdentityMock).toHaveBeenCalledWith('https://idp.example.com', SUBJECT);
  });

  test('refuses an identity without umami-admin', async () => {
    mockLinkedAdmin();
    const token = issuer.mint({ sub: SUBJECT, roles: [] }, HOST);

    expect(await checkAuth(request({ 'x-bastion-identity': token }))).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  test('refuses a request without an identity', async () => {
    expect(await checkAuth(request())).toBeNull();
  });

  test('refuses an identity for another host', async () => {
    mockLinkedAdmin();
    const token = issuer.mint({ sub: SUBJECT, roles: ['umami-admin'] }, 'other.example.com');

    expect(await checkAuth(request({ 'x-bastion-identity': token }))).toBeNull();
  });

  test('ignores a valid Umami session token: only guard signs in', async () => {
    mockLinkedAdmin();
    parseSecureTokenMock.mockReturnValue({ authKey: 'auth:session-key' } as any);
    kvGetMock.mockResolvedValue({ userId: 'user-1', pwd: hash(PASSWORD_HASH) });

    expect(await checkAuth(request({ authorization: 'Bearer secure-token' }))).toBeNull();
    expect(kvGetMock).not.toHaveBeenCalled();
  });

  test('a share token still works in share context without an identity', async () => {
    parseTokenMock.mockReturnValue({ type: 'share', websiteId: 'w1' } as any);

    const result = await checkAuth(
      request({ 'x-umami-share-token': 'share', 'x-umami-share-context': '1' }),
    );

    expect(result?.authType).toBe('share');
    expect(result?.user).toBeNull();
  });

  test('a share token outside share context is refused', async () => {
    parseTokenMock.mockReturnValue({ type: 'share', websiteId: 'w1' } as any);

    expect(await checkAuth(request({ 'x-umami-share-token': 'share' }))).toBeNull();
  });
});

describe('parseRequest behind guard', () => {
  test('answers 401 without an identity', async () => {
    const { error } = await parseRequest(request());

    expect(error().status).toBe(401);
  });

  test('answers 503 when guard keys are unreachable', async () => {
    vi.stubEnv('PLATFORM_KIT_EDGEAUTH_JWKS_URL', 'http://127.0.0.1:1/jwks.json');
    resetVerifier();
    const token = issuer.mint({ sub: SUBJECT, roles: ['umami-admin'] }, HOST);

    const { error } = await parseRequest(request({ 'x-bastion-identity': token }));

    expect(error().status).toBe(503);
  });
});
