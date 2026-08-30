import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ROLES } from '@/lib/constants';
import {
  createUser,
  getUserByOidcIdentity,
  getUserForOidcLink,
  updateUser,
} from '@/queries/prisma/user';
import {
  findOrCreateOidcUser,
  getOidcConfig,
  loginStateCookie,
  normalizeRoleKeys,
  type OidcConfig,
  openLoginState,
  parseDuration,
  pickUsername,
  resolveRole,
  sealLoginState,
  ssoHandoffCookie,
} from './oidc';

vi.mock('@/queries/prisma/user', () => ({
  createUser: vi.fn(),
  getUserByOidcIdentity: vi.fn(),
  getUserForOidcLink: vi.fn(),
  updateUser: vi.fn(),
}));

const createUserMock = vi.mocked(createUser);
const getUserByOidcIdentityMock = vi.mocked(getUserByOidcIdentity);
const getUserForOidcLinkMock = vi.mocked(getUserForOidcLink);
const updateUserMock = vi.mocked(updateUser);

const ISSUER = 'https://idp.example.com';
const SUBJECT = '123456789012345678';

function makeConfig(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    enabled: true,
    issuer: ISSUER,
    clientId: 'umami',
    scopes: 'openid profile email',
    rolesClaim: 'urn:zitadel:iam:org:project:roles',
    roleMap: { admin: ['umami-admin'], user: ['umami-user'], viewOnly: ['umami-view'] },
    allowLocalLogin: false,
    providerName: 'SSO',
    rpLogout: false,
    autoLinkUsername: false,
    sessionDurationSeconds: 86400,
    appUrl: 'https://analytics.example.com',
    basePath: '',
    redirectUri: 'https://analytics.example.com/api/auth/oidc/callback',
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv('APP_SECRET', 'test-secret');
  createUserMock.mockReset();
  getUserByOidcIdentityMock.mockReset();
  getUserForOidcLinkMock.mockReset();
  updateUserMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('parseDuration', () => {
  test('parses units and falls back on invalid input', () => {
    expect(parseDuration('30s', 1)).toBe(30);
    expect(parseDuration('15m', 1)).toBe(900);
    expect(parseDuration('24h', 1)).toBe(86400);
    expect(parseDuration('7d', 1)).toBe(604800);
    expect(parseDuration('3600', 1)).toBe(3600);
    expect(parseDuration(undefined, 42)).toBe(42);
    expect(parseDuration('soon', 42)).toBe(42);
    expect(parseDuration('0', 42)).toBe(42);
    expect(parseDuration('0h', 42)).toBe(42);
  });
});

describe('getOidcConfig', () => {
  test('is disabled unless issuer and client id are both set', () => {
    expect(getOidcConfig().enabled).toBe(false);

    vi.stubEnv('OIDC_ISSUER', ISSUER);
    expect(getOidcConfig().enabled).toBe(false);

    vi.stubEnv('OIDC_CLIENT_ID', 'umami');
    expect(getOidcConfig().enabled).toBe(true);
  });

  test('derives the redirect URI from APP_URL and BASE_PATH', () => {
    vi.stubEnv('APP_URL', 'https://analytics.example.com/');
    vi.stubEnv('BASE_PATH', '/umami');

    expect(getOidcConfig().redirectUri).toBe(
      'https://analytics.example.com/umami/api/auth/oidc/callback',
    );
  });

  test('parses comma-separated role lists', () => {
    vi.stubEnv('OIDC_ROLE_ADMIN', 'umami-admin, superuser');

    expect(getOidcConfig().roleMap.admin).toEqual(['umami-admin', 'superuser']);
  });
});

describe('normalizeRoleKeys', () => {
  test('handles the Zitadel object map shape', () => {
    expect(normalizeRoleKeys({ 'umami-admin': { org1: 'org1.example' } })).toEqual(['umami-admin']);
  });

  test('handles arrays, strings, and empty values', () => {
    expect(normalizeRoleKeys(['a', 'b', 1])).toEqual(['a', 'b']);
    expect(normalizeRoleKeys('a b,c')).toEqual(['a', 'b', 'c']);
    expect(normalizeRoleKeys(undefined)).toEqual([]);
    expect(normalizeRoleKeys(null)).toEqual([]);
  });
});

describe('resolveRole', () => {
  const config = makeConfig();
  const claim = (roles: unknown) => ({ [config.rolesClaim]: roles });

  test('maps a granted role', () => {
    expect(resolveRole(claim({ 'umami-user': {} }), config)).toBe(ROLES.user);
    expect(resolveRole(claim(['umami-view']), config)).toBe(ROLES.viewOnly);
  });

  test('admin takes precedence over other grants', () => {
    expect(resolveRole(claim(['umami-user', 'umami-admin']), config)).toBe(ROLES.admin);
  });

  test('returns null when no mapped role is granted', () => {
    expect(resolveRole(claim(['unrelated-role']), config)).toBeNull();
    expect(resolveRole({}, config)).toBeNull();
  });

  test('reads a custom claim name', () => {
    const custom = makeConfig({ rolesClaim: 'roles' });

    expect(resolveRole({ roles: ['umami-admin'] }, custom)).toBe(ROLES.admin);
  });
});

describe('pickUsername', () => {
  test('prefers preferred_username, then email, then sub', () => {
    expect(pickUsername({ preferred_username: 'Bob', email: 'b@x.com', sub: '1' })).toBe('bob');
    expect(pickUsername({ email: 'B@X.com', sub: '1' })).toBe('b@x.com');
    expect(pickUsername({ sub: 'ABC' })).toBe('abc');
    expect(pickUsername({})).toBe('');
  });

  test('truncates to 255 characters', () => {
    expect(pickUsername({ sub: 'a'.repeat(300) })).toHaveLength(255);
  });
});

describe('login state', () => {
  test('round-trips state, verifier, and nonce', () => {
    const data = { state: 's1', codeVerifier: 'v1', nonce: 'n1' };

    expect(openLoginState(sealLoginState(data))).toEqual(data);
  });

  test('rejects tampered values', () => {
    const sealed = sealLoginState({ state: 's', codeVerifier: 'v', nonce: 'n' });
    const buf = Buffer.from(sealed, 'base64');
    buf[buf.length - 1] ^= 0xff;

    expect(openLoginState(buf.toString('base64'))).toBeNull();
    expect(openLoginState('garbage')).toBeNull();
  });

  test('rejects expired state', () => {
    vi.useFakeTimers();

    const sealed = sealLoginState({ state: 's', codeVerifier: 'v', nonce: 'n' });

    vi.advanceTimersByTime(11 * 60 * 1000);

    expect(openLoginState(sealed)).toBeNull();
  });
});

describe('cookies', () => {
  test('scopes cookies to their routes and sets Secure for https deployments', () => {
    vi.stubEnv('APP_URL', 'https://analytics.example.com');
    vi.stubEnv('BASE_PATH', '/umami');

    expect(loginStateCookie('v')).toContain('Path=/umami/api/auth/oidc');
    expect(loginStateCookie('v')).toContain('HttpOnly');
    expect(loginStateCookie('v')).toContain('Secure');
    expect(loginStateCookie(null)).toContain('Max-Age=0');

    expect(ssoHandoffCookie('abc')).toContain('Path=/umami/sso-complete');
    expect(ssoHandoffCookie('abc')).toContain('Max-Age=60');
    expect(ssoHandoffCookie('abc')).not.toContain('HttpOnly');
  });

  test('omits Secure for http deployments', () => {
    vi.stubEnv('APP_URL', 'http://localhost:3000');

    expect(loginStateCookie('v')).not.toContain('Secure');
  });
});

describe('findOrCreateOidcUser', () => {
  const claims = {
    sub: SUBJECT,
    preferred_username: 'Bob',
    name: 'Bob Smith',
  };

  test('creates a new user on first login', async () => {
    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u1',
      username: 'bob',
      password: 'hash',
      role: ROLES.user,
      oidcIssuer: ISSUER,
      oidcSubject: SUBJECT,
    } as any);
    getUserForOidcLinkMock.mockResolvedValue(null);

    const user = await findOrCreateOidcUser(ISSUER, SUBJECT, claims, ROLES.user);

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'bob',
        role: ROLES.user,
        displayName: 'Bob Smith',
        oidcIssuer: ISSUER,
        oidcSubject: SUBJECT,
      }),
    );
    // JIT users get a random, non-empty bcrypt password.
    expect(createUserMock.mock.calls[0][0].password).toMatch(/^\$2/);
    expect(user.id).toBe('u1');
  });

  test('re-syncs role and display name for an existing OIDC user', async () => {
    getUserByOidcIdentityMock.mockResolvedValue({
      id: 'u1',
      username: 'bob',
      password: 'hash',
      role: ROLES.user,
      displayName: 'Old Name',
      oidcIssuer: ISSUER,
      oidcSubject: SUBJECT,
    } as any);

    const user = await findOrCreateOidcUser(ISSUER, SUBJECT, claims, ROLES.admin);

    expect(updateUserMock).toHaveBeenCalledWith('u1', {
      role: ROLES.admin,
      displayName: 'Bob Smith',
    });
    expect(user.role).toBe(ROLES.admin);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test('does not rename an existing user when the token has no profile claims', async () => {
    getUserByOidcIdentityMock.mockResolvedValue({
      id: 'u1',
      username: 'bob',
      password: 'hash',
      role: ROLES.user,
      displayName: 'Bob Smith',
      oidcIssuer: ISSUER,
      oidcSubject: SUBJECT,
    } as any);

    await findOrCreateOidcUser(ISSUER, SUBJECT, { sub: SUBJECT }, ROLES.user);

    expect(updateUserMock).not.toHaveBeenCalled();
    expect(getUserForOidcLinkMock).not.toHaveBeenCalled();
  });

  test('keeps the old username when a rename hits a unique-constraint race', async () => {
    getUserByOidcIdentityMock.mockResolvedValue({
      id: 'u1',
      username: 'bob',
      password: 'hash',
      role: ROLES.user,
      displayName: 'Bob Smith',
      oidcIssuer: ISSUER,
      oidcSubject: SUBJECT,
    } as any);
    getUserForOidcLinkMock.mockResolvedValue(null);
    updateUserMock.mockRejectedValueOnce({ code: 'P2002' });

    const user = await findOrCreateOidcUser(
      ISSUER,
      SUBJECT,
      { ...claims, preferred_username: 'Alice' },
      ROLES.admin,
    );

    expect(updateUserMock).toHaveBeenCalledTimes(2);
    expect(updateUserMock).toHaveBeenLastCalledWith('u1', { role: ROLES.admin });
    expect(user.username).toBe('bob');
    expect(user.role).toBe(ROLES.admin);
  });

  test('makes no update when nothing changed', async () => {
    getUserByOidcIdentityMock.mockResolvedValue({
      id: 'u1',
      username: 'bob',
      password: 'hash',
      role: ROLES.user,
      displayName: 'Bob Smith',
      oidcIssuer: ISSUER,
      oidcSubject: SUBJECT,
    } as any);

    await findOrCreateOidcUser(ISSUER, SUBJECT, claims, ROLES.user);

    expect(updateUserMock).not.toHaveBeenCalled();
  });

  test('suffixes the username when it is taken by another account', async () => {
    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u2',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue({ id: 'other', oidcIssuer: 'other-issuer' } as any);

    await findOrCreateOidcUser(ISSUER, SUBJECT, claims, ROLES.user);

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: `bob-${SUBJECT.slice(0, 8)}` }),
    );
  });

  test('links an existing local account when auto-link is enabled', async () => {
    vi.stubEnv('OIDC_AUTO_LINK_USERNAME', '1');

    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'local-1',
      username: 'bob',
      password: 'hash',
      role: ROLES.user,
      oidcIssuer: ISSUER,
      oidcSubject: SUBJECT,
    } as any);
    getUserForOidcLinkMock.mockResolvedValue({ id: 'local-1', oidcIssuer: null } as any);

    const user = await findOrCreateOidcUser(ISSUER, SUBJECT, claims, ROLES.user);

    expect(updateUserMock).toHaveBeenCalledWith(
      'local-1',
      expect.objectContaining({ oidcIssuer: ISSUER, oidcSubject: SUBJECT, role: ROLES.user }),
    );
    expect(createUserMock).not.toHaveBeenCalled();
    expect(user.id).toBe('local-1');
  });

  test('does not auto-link on an unverified email claim', async () => {
    vi.stubEnv('OIDC_AUTO_LINK_USERNAME', '1');

    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u3',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue({ id: 'local-1', oidcIssuer: null } as any);

    await findOrCreateOidcUser(ISSUER, SUBJECT, { sub: SUBJECT, email: 'bob@x.com' }, ROLES.user);

    expect(updateUserMock).not.toHaveBeenCalled();
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: `bob@x.com-${SUBJECT.slice(0, 8)}` }),
    );
  });

  test('auto-links on a verified email claim', async () => {
    vi.stubEnv('OIDC_AUTO_LINK_USERNAME', '1');

    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'local-1',
      username: 'bob@x.com',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue({ id: 'local-1', oidcIssuer: null } as any);

    const user = await findOrCreateOidcUser(
      ISSUER,
      SUBJECT,
      { sub: SUBJECT, email: 'bob@x.com', email_verified: true },
      ROLES.user,
    );

    expect(updateUserMock).toHaveBeenCalledWith(
      'local-1',
      expect.objectContaining({ oidcIssuer: ISSUER, oidcSubject: SUBJECT }),
    );
    expect(user.id).toBe('local-1');
  });

  test('does not auto-link when disabled', async () => {
    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u3',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue({ id: 'local-1', oidcIssuer: null } as any);

    await findOrCreateOidcUser(ISSUER, SUBJECT, claims, ROLES.user);

    expect(updateUserMock).not.toHaveBeenCalled();
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: `bob-${SUBJECT.slice(0, 8)}` }),
    );
  });

  test('recovers when a concurrent login already created the identity', async () => {
    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u1',
      username: 'bob',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue(null);
    createUserMock.mockRejectedValueOnce({ code: 'P2002' });

    const user = await findOrCreateOidcUser(ISSUER, SUBJECT, claims, ROLES.user);

    expect(user.id).toBe('u1');
    expect(createUserMock).toHaveBeenCalledTimes(1);
  });

  test('returns null when no username claim is available', async () => {
    getUserByOidcIdentityMock.mockResolvedValue(null);

    expect(await findOrCreateOidcUser(ISSUER, SUBJECT, { sub: '' }, ROLES.user)).toBeNull();
  });
});
