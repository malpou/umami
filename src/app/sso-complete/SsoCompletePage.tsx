'use client';
import { Loading } from '@umami/react-zen';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { setClientAuthToken } from '@/lib/client';

const HANDOFF_COOKIE = 'umami.sso-handoff';

function readHandoffCookie(): string | null {
  for (const part of document.cookie.split(';')) {
    const index = part.indexOf('=');

    if (index !== -1 && part.slice(0, index).trim() === HANDOFF_COOKIE) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return null;
}

function clearHandoffCookie() {
  const basePath = process.env.basePath || '';

  document.cookie = `${HANDOFF_COOKIE}=; Path=${basePath}/sso-complete; SameSite=Lax; Max-Age=0`;
}

export function SsoCompletePage() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token');
    const sid = params.get('sid');
    const handoff = readHandoffCookie();

    clearHandoffCookie();
    // Remove the token fragment from the address bar and history.
    window.history.replaceState(null, '', window.location.pathname);

    // Only accept a token delivered by this browser's own callback redirect,
    // proven by the matching one-time handoff cookie.
    if (!token || !sid || !handoff || sid !== handoff) {
      router.replace('/login?error=oidc-failed');
      return;
    }

    setClientAuthToken(token);
    router.replace('/');
  }, [router]);

  return <Loading placement="absolute" />;
}
