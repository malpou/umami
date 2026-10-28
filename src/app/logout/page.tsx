import type { Metadata } from 'next';
import { getOidcConfig } from '@/lib/oidc';
import { LogoutPage } from './LogoutPage';

export const dynamic = 'force-dynamic';

export default function () {
  if (process.env.DISABLE_LOGIN || process.env.CLOUD_MODE) {
    return null;
  }

  const oidc = getOidcConfig();

  return <LogoutPage oidcRpLogout={oidc.enabled && oidc.rpLogout} />;
}

export const metadata: Metadata = {
  title: 'Logout',
};
