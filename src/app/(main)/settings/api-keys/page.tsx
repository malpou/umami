import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isApiKeyEnabled } from '@/lib/api-key';
import { ApiKeysPage } from './ApiKeysPage';

export default function () {
  // Disabled in this fork; see isApiKeyEnabled.
  if (!isApiKeyEnabled()) {
    notFound();
  }

  return <ApiKeysPage />;
}

export const metadata: Metadata = {
  title: 'API keys',
};
