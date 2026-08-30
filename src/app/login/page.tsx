import type { Metadata } from 'next';
import { getOidcConfig } from '@/lib/oidc';
import { LoginPage } from './LoginPage';

export const dynamic = 'force-dynamic';

export default async function () {
  if (process.env.DISABLE_LOGIN || process.env.CLOUD_MODE) {
    return null;
  }

  const oidc = getOidcConfig();

  return (
    <LoginPage
      oidcEnabled={oidc.enabled}
      oidcProviderName={oidc.providerName}
      oidcAuthorizeUrl={`${oidc.basePath}/api/auth/oidc/authorize`}
      allowLocalLogin={!oidc.enabled || oidc.allowLocalLogin}
    />
  );
}

export const metadata: Metadata = {
  title: 'Login',
};
