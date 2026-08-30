import debug from 'debug';
import * as client from 'openid-client';
import { saveAuth } from '@/lib/auth';
import { hash, secret } from '@/lib/crypto';
import { createSecureToken } from '@/lib/jwt';
import {
  findOrCreateOidcUser,
  getCookieValue,
  getOidcClient,
  getOidcConfig,
  loginStateCookie,
  OIDC_STATE_COOKIE,
  openLoginState,
  resolveRole,
} from '@/lib/oidc';
import redis from '@/lib/redis';
import { notFound } from '@/lib/response';

const log = debug('umami:oidc');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const config = getOidcConfig();

  if (!config.enabled) {
    return notFound();
  }

  const fail = (code: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: `${config.basePath}/login?error=${code}`,
        'Set-Cookie': loginStateCookie(null),
      },
    });

  const cookie = getCookieValue(request, OIDC_STATE_COOKIE);
  const loginState = cookie ? openLoginState(cookie) : null;

  if (!loginState) {
    return fail('oidc-state');
  }

  let configuration: client.Configuration;

  try {
    configuration = await getOidcClient();
  } catch (e) {
    log('OIDC discovery failed', e);
    return fail('oidc-unavailable');
  }

  // Rebuild the callback URL from the registered redirect URI so the token
  // exchange is not affected by proxy-rewritten request URLs.
  const currentUrl = new URL(config.redirectUri);
  currentUrl.search = new URL(request.url).search;

  let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;

  try {
    tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: loginState.codeVerifier,
      expectedState: loginState.state,
      expectedNonce: loginState.nonce,
    });
  } catch (e) {
    log('OIDC code exchange failed', e);
    return fail('oidc-failed');
  }

  let claims: Record<string, unknown> = { ...(tokens.claims() || {}) };

  if (claims[config.rolesClaim] === undefined && tokens.access_token) {
    try {
      const userinfo = await client.fetchUserInfo(
        configuration,
        tokens.access_token,
        String(claims.sub),
      );

      claims = { ...userinfo, ...claims };
    } catch (e) {
      log('OIDC userinfo fetch failed', e);
    }
  }

  const subject = typeof claims.sub === 'string' ? claims.sub : null;

  if (!subject) {
    return fail('oidc-failed');
  }

  const role = resolveRole(claims, config);

  if (!role) {
    return fail('oidc-no-role');
  }

  let user: Awaited<ReturnType<typeof findOrCreateOidcUser>>;

  try {
    user = await findOrCreateOidcUser(config.issuer, subject, claims, role);
  } catch (e) {
    log('OIDC user provisioning failed', e);
    user = null;
  }

  if (!user) {
    return fail('oidc-provision-failed');
  }

  // Bind token to password hash so a password change invalidates old tokens.
  const pwd = hash(user.password);

  let token: string;

  if (redis.enabled) {
    token = await saveAuth({ userId: user.id, role, pwd }, config.sessionDurationSeconds);
  } else {
    token = createSecureToken({ userId: user.id, role, pwd }, secret(), {
      expiresIn: config.sessionDurationSeconds,
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${config.basePath}/sso-complete#token=${encodeURIComponent(token)}`,
      'Set-Cookie': loginStateCookie(null),
    },
  });
}
