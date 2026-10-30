'use client';
import { useEffect } from 'react';
import { useApi } from '@/components/hooks';
import { removeClientAuthToken } from '@/lib/client';
import { setUser } from '@/store/app';

export function LogoutPage({ guardIdentity }: { guardIdentity?: boolean }) {
  const { post } = useApi();

  useEffect(() => {
    async function logout() {
      await post('/auth/logout');

      const basePath = process.env.basePath || '';

      // Guard's logout ends its session and the Zitadel one; it lives at the
      // host root, outside BASE_PATH.
      window.location.href = guardIdentity ? '/.well-known/bastion/logout' : `${basePath}/login`;
    }

    removeClientAuthToken();
    setUser(null);
    logout();
  }, [guardIdentity, post]);

  return null;
}
