'use client';
import { useEffect } from 'react';
import { useApi, useConfig } from '@/components/hooks';
import { removeClientAuthToken } from '@/lib/client';
import { setUser } from '@/store/app';

export function LogoutPage() {
  const config = useConfig();
  const { post } = useApi();

  useEffect(() => {
    if (!config) {
      return;
    }

    async function logout() {
      await post('/auth/logout');

      const basePath = process.env.basePath || '';

      window.location.href = config.oidcRpLogout
        ? `${basePath}/api/auth/oidc/logout`
        : `${basePath}/login`;
    }

    removeClientAuthToken();
    setUser(null);
    logout();
  }, [config, post]);

  return null;
}
