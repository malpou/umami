'use client';
import { Loading } from '@umami/react-zen';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { setClientAuthToken } from '@/lib/client';

export function SsoCompletePage() {
  const router = useRouter();

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');

    if (!token) {
      router.replace('/login?error=oidc-failed');
      return;
    }

    setClientAuthToken(token);
    // Remove the token fragment from the address bar and history.
    window.history.replaceState(null, '', window.location.pathname);
    router.replace('/');
  }, [router]);

  return <Loading placement="absolute" />;
}
