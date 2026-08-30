import debug from 'debug';
import * as client from 'openid-client';
import { getOidcClient, getOidcConfig } from '@/lib/oidc';
import { notFound } from '@/lib/response';

const log = debug('umami:oidc');

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = getOidcConfig();

  if (!config.enabled || !config.rpLogout) {
    return notFound();
  }

  const loginUrl = `${config.basePath}/login`;

  try {
    const configuration = await getOidcClient();

    const endSessionUrl = client.buildEndSessionUrl(configuration, {
      client_id: config.clientId,
      post_logout_redirect_uri: `${config.appUrl}${loginUrl}`,
    });

    return new Response(null, {
      status: 302,
      headers: { Location: endSessionUrl.toString() },
    });
  } catch (e) {
    log('OIDC end session failed', e);

    return new Response(null, {
      status: 302,
      headers: { Location: loginUrl },
    });
  }
}
