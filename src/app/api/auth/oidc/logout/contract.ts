import { defineOperation } from '@/openapi/operation';
import { notFoundResponse } from '@/openapi/schemas';

// A browser redirect flow, not an API for clients: internal audience.
const operation = defineOperation({
  method: 'get',
  path: '/api/auth/oidc/logout',
  audience: 'internal',
  auth: 'none',
  operation: {
    operationId: 'getOidcLogout',
    summary: 'End single sign-on session',
    description:
      'Redirects to the identity provider end-session endpoint when RP-initiated logout is enabled, otherwise to /login. Returns 404 when OIDC is not configured.',
    tags: ['Authentication'],
    responses: {
      '302': { description: 'Redirect to the identity provider logout page or to /login.' },
      '404': notFoundResponse,
    },
  },
});

export const operations = [operation] as const;
