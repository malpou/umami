import debug from 'debug';
import * as client from 'openid-client';
import { getOidcClient, getOidcConfig, loginStateCookie, sealLoginState } from '@/lib/oidc';
import { notFound } from '@/lib/response';

const log = debug('umami:oidc');

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = getOidcConfig();

  if (!config.enabled) {
    return notFound();
  }

  let configuration: client.Configuration;

  try {
    configuration = await getOidcClient();
  } catch (e) {
    log('OIDC discovery failed', e);

    return new Response(null, {
      status: 302,
      headers: { Location: `${config.basePath}/login?error=oidc-unavailable` },
    });
  }

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const authorizationUrl = client.buildAuthorizationUrl(configuration, {
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.toString(),
      'Set-Cookie': loginStateCookie(sealLoginState({ state, codeVerifier, nonce })),
    },
  });
}
