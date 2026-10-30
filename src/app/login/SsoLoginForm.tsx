'use client';
import { Button, Column, Heading, Icon } from '@umami/react-zen';
import { useMessages } from '@/components/hooks';
import { Logo } from '@/components/svg';

export interface SsoLoginFormProps {
  // Guard's login endpoint on this host.
  loginUrl: string;
}

export function SsoLoginForm({ loginUrl }: SsoLoginFormProps) {
  const { t, labels } = useMessages();

  return (
    <Column justifyContent="center" alignItems="center" gap="6">
      <Icon size="lg">
        <Logo />
      </Icon>
      <Heading>umami</Heading>
      <Column gap="4" style={{ minWidth: 300 }}>
        <Button
          data-test="button-sso-login"
          variant="primary"
          onPress={() => {
            window.location.href = loginUrl;
          }}
        >
          {t(labels.login)}
        </Button>
      </Column>
    </Column>
  );
}
