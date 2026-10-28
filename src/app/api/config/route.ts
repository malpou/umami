import { isRelationalOnly } from '@/lib/db';
import { getOidcConfig } from '@/lib/oidc';
import { parseRequest } from '@/lib/request';
import { json } from '@/lib/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { error } = await parseRequest(request, null, { skipAuth: true });

  if (error) {
    return error();
  }

  const oidc = getOidcConfig();

  return json({
    cloudMode: !!process.env.CLOUD_MODE,
    faviconUrl: process.env.FAVICON_URL,
    oidcEnabled: oidc.enabled,
    oidcProviderName: oidc.enabled ? oidc.providerName : undefined,
    oidcRpLogout: oidc.enabled && oidc.rpLogout,
    localLoginDisabled: oidc.enabled && !oidc.allowLocalLogin,
    linksUrl: process.env.LINKS_URL,
    pixelsUrl: process.env.PIXELS_URL,
    privateMode: !!process.env.PRIVATE_MODE,
    sessionDeletionEnabled: isRelationalOnly(),
    telemetryDisabled: !!process.env.DISABLE_TELEMETRY,
    trackerScriptName: process.env.TRACKER_SCRIPT_NAME,
    updatesDisabled: !!process.env.DISABLE_UPDATES,
  });
}
