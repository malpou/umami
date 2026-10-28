import type { Metadata } from 'next';
import { getOidcConfig } from '@/lib/oidc';
import { SsoCompletePage } from './SsoCompletePage';

export const dynamic = 'force-dynamic';

export default async function () {
  if (!getOidcConfig().enabled) {
    return null;
  }

  return <SsoCompletePage />;
}

export const metadata: Metadata = {
  title: 'Login',
};
