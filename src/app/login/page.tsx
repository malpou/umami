import type { Metadata } from 'next';
import { guardLoginUrl, isGuardIdentityEnabled } from '@/lib/guard-identity';
import { LoginPage } from './LoginPage';

export const dynamic = 'force-dynamic';

export default async function () {
  if (process.env.DISABLE_LOGIN || process.env.CLOUD_MODE) {
    return null;
  }

  // Behind guard the page only offers guard's login: no redirect of its own, so
  // a signed-in user without an Umami role cannot loop through it.
  return (
    <LoginPage
      guardIdentity={isGuardIdentityEnabled()}
      guardLoginUrl={guardLoginUrl(`${process.env.BASE_PATH || ''}/`)}
    />
  );
}

export const metadata: Metadata = {
  title: 'Login',
};
