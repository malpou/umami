'use client';
import { useEffect } from 'react';
import { useApi } from '@/components/hooks';
import { removeClientAuthToken } from '@/lib/client';
import { setUser } from '@/store/app';

export function LogoutPage({ oidcRpLogout }: { oidcRpLogout?: boolean }) {
  const { post } = useApi();

  useEffect(() => {
    async function logout() {
      await post('/auth/logout');

      const basePath = process.env.basePath || '';

      window.location.href = oidcRpLogout
        ? `${basePath}/api/auth/oidc/logout`
        : `${basePath}/login`;
    }

    removeClientAuthToken();
    setUser(null);
    logout();
  }, [oidcRpLogout, post]);

  return null;
}
