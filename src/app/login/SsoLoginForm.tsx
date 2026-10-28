'use client';
import { Button, Column, Heading, Icon, Text } from '@umami/react-zen';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useMessages } from '@/components/hooks';
import { Logo } from '@/components/svg';
import { LoginForm } from './LoginForm';

const OIDC_ERROR_CODES = [
  'oidc-failed',
  'oidc-no-role',
  'oidc-provision-failed',
  'oidc-state',
  'oidc-unavailable',
  'local-login-disabled',
];

export interface SsoLoginFormProps {
  providerName: string;
  authorizeUrl: string;
  allowLocalLogin: boolean;
}

export function SsoLoginForm({ providerName, authorizeUrl, allowLocalLogin }: SsoLoginFormProps) {
  const { t, labels, getMessage } = useMessages();
  const searchParams = useSearchParams();
  const [showLocalLogin, setShowLocalLogin] = useState(false);

  const errorParam = searchParams.get('error');
  const error = OIDC_ERROR_CODES.includes(errorParam) ? getMessage(errorParam) : null;

  if (showLocalLogin) {
    return (
      <Column justifyContent="center" alignItems="center" gap="6">
        <LoginForm />
        <Button variant="quiet" onPress={() => setShowLocalLogin(false)}>
          {t(labels.continueWith, { name: providerName })}
        </Button>
      </Column>
    );
  }

  return (
    <Column justifyContent="center" alignItems="center" gap="6">
      <Icon size="lg">
        <Logo />
      </Icon>
      <Heading>umami</Heading>
      <Column gap="4" style={{ minWidth: 300 }}>
        {error && <Text style={{ color: 'var(--color-danger, red)' }}>{error}</Text>}
        <Button
          data-test="button-sso-login"
          variant="primary"
          onPress={() => {
            window.location.href = authorizeUrl;
          }}
        >
          {t(labels.continueWith, { name: providerName })}
        </Button>
        {allowLocalLogin && (
          <Button variant="quiet" onPress={() => setShowLocalLogin(true)}>
            {t(labels.loginWithPassword)}
          </Button>
        )}
      </Column>
    </Column>
  );
}
