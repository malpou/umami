import { defineOperation } from '@/openapi/operation';
import { notFoundResponse } from '@/openapi/schemas';

// A browser redirect flow, not an API for clients: internal audience.
const operation = defineOperation({
  method: 'get',
  path: '/api/auth/oidc/authorize',
  audience: 'internal',
  auth: 'none',
  operation: {
    operationId: 'getOidcAuthorize',
    summary: 'Start single sign-on',
    description:
      'Redirects the browser to the OpenID Connect provider with PKCE, state and nonce sealed into a short-lived cookie. Returns 404 when OIDC is not configured.',
    tags: ['Authentication'],
    responses: {
      '302': {
        description: 'Redirect to the identity provider, or back to /login with an error code.',
      },
      '404': notFoundResponse,
    },
  },
});

export const operations = [operation] as const;
