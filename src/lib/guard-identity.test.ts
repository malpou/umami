import { EdgeAuthUnavailable, type Identity } from '@metsaapp/edgeauth';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ROLES } from '@/lib/constants';
import {
  createUser,
  getUserByOidcIdentity,
  getUserForOidcLink,
  updateUser,
} from '@/queries/prisma/user';
import { startTestIssuer, type TestIssuer } from '@/test/edgeauth';
import {
  findOrCreateGuardUser,
  getGuardConfig,
  getGuardUserId,
  getRequestIdentity,
  guardLoginUrl,
  pickUsername,
  resetVerifier,
  resolveRole,
} from './guard-identity';

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

const HOST = 'insights.example.com';
const ISSUER = 'https://idp.example.com';
const SUBJECT = '123456789012345678';

let issuer: TestIssuer;

beforeAll(async () => {
  issuer = await startTestIssuer();
});

afterAll(async () => {
  await issuer.close();
});

function identity(overrides: Partial<Identity> = {}): Identity {
  return {
    subject: SUBJECT,
    email: 'bob@example.com',
    emailVerified: false,
    name: 'Bob Smith',
    roles: ['umami-admin'],
    sessionId: 'abcdef0123456789',
    authTime: null,
    clientId: 'umami',
    source: 'session',
    ...overrides,
  };
}

function request(token?: string) {
  return new Request(`https://${HOST}/api/auth/verify`, {
    headers: token ? { 'x-bastion-identity': token } : {},
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('GUARD_IDENTITY', '1');
  vi.stubEnv('GUARD_USER_ISSUER', ISSUER);
  vi.stubEnv('GUARD_ROLE_ADMIN', 'umami-admin');
  vi.stubEnv('GUARD_AUTO_LINK_USERNAME', '');
  vi.stubEnv('PLATFORM_KIT_EDGEAUTH_AUDIENCES', HOST);
  vi.stubEnv('PLATFORM_KIT_EDGEAUTH_JWKS_URL', issuer.jwksUrl);
  resetVerifier();
  createUserMock.mockReset();
  getUserByOidcIdentityMock.mockReset();
  getUserForOidcLinkMock.mockReset();
  updateUserMock.mockReset();
});

describe('getGuardConfig', () => {
  test('reads the role map and issuer', () => {
    vi.stubEnv('GUARD_ROLE_USER', 'umami-user, umami-editor');

    expect(getGuardConfig()).toEqual({
      enabled: true,
      issuer: ISSUER,
      roleMap: { admin: ['umami-admin'], user: ['umami-user', 'umami-editor'], viewOnly: [] },
      autoLinkUsername: false,
    });
  });

  test('is disabled without GUARD_IDENTITY', () => {
    vi.stubEnv('GUARD_IDENTITY', '');

    expect(getGuardConfig().enabled).toBe(false);
  });
});

describe('guardLoginUrl', () => {
  test('points at guard login with the return path', () => {
    expect(guardLoginUrl('/websites')).toBe('/.well-known/bastion/login?return_to=%2Fwebsites');
  });
});

describe('resolveRole', () => {
  const roleMap = { admin: ['umami-admin'], user: ['umami-user'], viewOnly: ['umami-view'] };

  test('admin wins over the others', () => {
    expect(resolveRole(['umami-view', 'umami-admin'], roleMap)).toBe(ROLES.admin);
  });

  test('maps user and view-only', () => {
    expect(resolveRole(['umami-user'], roleMap)).toBe(ROLES.user);
    expect(resolveRole(['umami-view'], roleMap)).toBe(ROLES.viewOnly);
  });

  test('no mapped role is no access', () => {
    expect(resolveRole([], roleMap)).toBeNull();
    expect(resolveRole(['other'], roleMap)).toBeNull();
  });
});

describe('pickUsername', () => {
  test('uses the email, lower-cased, else the subject', () => {
    expect(pickUsername(identity({ email: 'Bob@Example.com' }))).toBe('bob@example.com');
    expect(pickUsername(identity({ email: '' }))).toBe(SUBJECT);
  });
});

describe('getRequestIdentity', () => {
  test('verifies the identity header', async () => {
    const token = issuer.mint(
      { sub: SUBJECT, email: 'bob@example.com', roles: ['umami-admin'] },
      HOST,
    );
    const id = await getRequestIdentity(request(token));

    expect(id?.subject).toBe(SUBJECT);
    expect(id?.roles).toEqual(['umami-admin']);
  });

  test('no header is anonymous', async () => {
    expect(await getRequestIdentity(request())).toBeNull();
  });

  test('a token for another host is rejected', async () => {
    const token = issuer.mint({ sub: SUBJECT, roles: ['umami-admin'] }, 'other.example.com');

    expect(await getRequestIdentity(request(token))).toBeNull();
  });

  test('an expired token is rejected', async () => {
    const token = issuer.mint({ sub: SUBJECT }, HOST, { exp: Math.floor(Date.now() / 1000) - 60 });

    expect(await getRequestIdentity(request(token))).toBeNull();
  });

  test('a forged token is rejected', async () => {
    const token = issuer.mint({ sub: SUBJECT }, HOST);
    const [header, , signature] = token.split('.');
    const payload = Buffer.from(
      JSON.stringify({ iss: 'bastion', aud: HOST, sub: 'mallory', roles: ['umami-admin'] }),
    ).toString('base64url');

    expect(await getRequestIdentity(request(`${header}.${payload}.${signature}`))).toBeNull();
  });

  test('unreachable keys reject with EdgeAuthUnavailable', async () => {
    vi.stubEnv('PLATFORM_KIT_EDGEAUTH_JWKS_URL', 'http://127.0.0.1:1/jwks.json');
    resetVerifier();
    const token = issuer.mint({ sub: SUBJECT }, HOST);

    await expect(getRequestIdentity(request(token))).rejects.toBeInstanceOf(EdgeAuthUnavailable);
  });
});

describe('getGuardUserId', () => {
  test('maps an admin identity to its Umami user', async () => {
    getUserByOidcIdentityMock.mockResolvedValue({
      id: 'u1',
      username: 'bob',
      role: ROLES.admin,
      displayName: 'Bob Smith',
    } as any);
    const token = issuer.mint(
      { sub: SUBJECT, email: 'bob@example.com', name: 'Bob Smith', roles: ['umami-admin'] },
      HOST,
    );

    expect(await getGuardUserId(request(token))).toBe('u1');
    expect(getUserByOidcIdentityMock).toHaveBeenCalledWith(ISSUER, SUBJECT);
  });

  test('an identity without a mapped role gets no user', async () => {
    const token = issuer.mint({ sub: SUBJECT, roles: ['umami-viewer'] }, HOST);

    expect(await getGuardUserId(request(token))).toBeNull();
    expect(getUserByOidcIdentityMock).not.toHaveBeenCalled();
  });

  test('no user without GUARD_USER_ISSUER', async () => {
    vi.stubEnv('GUARD_USER_ISSUER', '');
    const token = issuer.mint({ sub: SUBJECT, roles: ['umami-admin'] }, HOST);

    expect(await getGuardUserId(request(token))).toBeNull();
  });
});

describe('findOrCreateGuardUser', () => {
  test('creates a new user on first sight', async () => {
    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u1',
      username: 'bob@example.com',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue(null);

    const user = await findOrCreateGuardUser(ISSUER, identity(), ROLES.user);

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'bob@example.com',
        role: ROLES.user,
        displayName: 'Bob Smith',
        oidcIssuer: ISSUER,
        oidcSubject: SUBJECT,
      }),
    );
    // New users get a random, non-empty bcrypt password.
    expect(createUserMock.mock.calls[0][0].password).toMatch(/^\$2/);
    expect(user.id).toBe('u1');
  });

  test('re-syncs role and display name for an existing user, never the username', async () => {
    getUserByOidcIdentityMock.mockResolvedValue({
      id: 'u1',
      username: 'bob',
      role: ROLES.user,
      displayName: 'Old Name',
    } as any);

    const user = await findOrCreateGuardUser(ISSUER, identity(), ROLES.admin);

    expect(updateUserMock).toHaveBeenCalledWith('u1', {
      role: ROLES.admin,
      displayName: 'Bob Smith',
    });
    expect(user.role).toBe(ROLES.admin);
    expect(user.username).toBe('bob');
    expect(getUserForOidcLinkMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  test('makes no update when nothing changed', async () => {
    getUserByOidcIdentityMock.mockResolvedValue({
      id: 'u1',
      username: 'bob',
      role: ROLES.admin,
      displayName: 'Bob Smith',
    } as any);

    await findOrCreateGuardUser(ISSUER, identity(), ROLES.admin);

    expect(updateUserMock).not.toHaveBeenCalled();
  });

  test('suffixes the username when it is taken by another account', async () => {
    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u2',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue({ id: 'other', oidcIssuer: 'other-issuer' } as any);

    await findOrCreateGuardUser(ISSUER, identity(), ROLES.user);

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: `bob@example.com-${SUBJECT.slice(0, 8)}` }),
    );
  });

  test('auto-links a local account on a verified email when enabled', async () => {
    vi.stubEnv('GUARD_AUTO_LINK_USERNAME', '1');
    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'local-1',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue({ id: 'local-1', oidcIssuer: null } as any);

    const user = await findOrCreateGuardUser(ISSUER, identity({ emailVerified: true }), ROLES.user);

    expect(updateUserMock).toHaveBeenCalledWith(
      'local-1',
      expect.objectContaining({ oidcIssuer: ISSUER, oidcSubject: SUBJECT, role: ROLES.user }),
    );
    expect(createUserMock).not.toHaveBeenCalled();
    expect(user.id).toBe('local-1');
  });

  test('does not auto-link on an unverified email', async () => {
    vi.stubEnv('GUARD_AUTO_LINK_USERNAME', '1');
    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u3',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue({ id: 'local-1', oidcIssuer: null } as any);

    await findOrCreateGuardUser(ISSUER, identity(), ROLES.user);

    expect(updateUserMock).not.toHaveBeenCalled();
    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ username: `bob@example.com-${SUBJECT.slice(0, 8)}` }),
    );
  });

  test('does not auto-link when disabled', async () => {
    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u3',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue({ id: 'local-1', oidcIssuer: null } as any);

    await findOrCreateGuardUser(ISSUER, identity({ emailVerified: true }), ROLES.user);

    expect(updateUserMock).not.toHaveBeenCalled();
    expect(createUserMock).toHaveBeenCalledTimes(1);
  });

  test('recovers when a concurrent request already created the identity', async () => {
    getUserByOidcIdentityMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'u1',
    } as any);
    getUserForOidcLinkMock.mockResolvedValue(null);
    createUserMock.mockRejectedValueOnce({ code: 'P2002' });

    const user = await findOrCreateGuardUser(ISSUER, identity(), ROLES.user);

    expect(user.id).toBe('u1');
    expect(createUserMock).toHaveBeenCalledTimes(1);
  });
});
