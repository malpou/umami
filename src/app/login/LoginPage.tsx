'use client';
import { Column, Loading } from '@umami/react-zen';
import { useRouter } from 'next/navigation';
import { type PropsWithChildren, useEffect } from 'react';
import { useLoginQuery } from '@/components/hooks';
import { LoginForm } from './LoginForm';
import { SsoLoginForm } from './SsoLoginForm';

export function LoginPageWrapper({ children }: PropsWithChildren) {
  const { user, isLoading } = useLoginQuery();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.replace('/');
    }
  }, [user, router]);

  if (isLoading || user) {
    return <Loading placement="absolute" />;
  }

  return (
    <Column
      alignItems="center"
      justifyContent="flex-start"
      height="100vh"
      backgroundColor="surface-raised"
      style={{ paddingTop: '15vh' }}
    >
      {children}
    </Column>
  );
}

export interface LoginPageProps {
  oidcEnabled?: boolean;
  oidcProviderName?: string;
  oidcAuthorizeUrl?: string;
  allowLocalLogin?: boolean;
}

export function LoginPage({
  oidcEnabled,
  oidcProviderName,
  oidcAuthorizeUrl,
  allowLocalLogin = true,
}: LoginPageProps) {
  return (
    <LoginPageWrapper>
      {oidcEnabled ? (
        <SsoLoginForm
          providerName={oidcProviderName}
          authorizeUrl={oidcAuthorizeUrl}
          allowLocalLogin={allowLocalLogin}
        />
      ) : (
        <LoginForm />
      )}
    </LoginPageWrapper>
  );
}
