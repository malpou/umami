import { defineOperation } from '@/openapi/operation';
import { notFoundResponse } from '@/openapi/schemas';

// A browser redirect flow, not an API for clients: internal audience.
const operation = defineOperation({
  method: 'get',
  path: '/api/auth/oidc/callback',
  audience: 'internal',
  auth: 'none',
  operation: {
    operationId: 'getOidcCallback',
    summary: 'Complete single sign-on',
    description:
      'Handles the OpenID Connect authorization response, maps the role from the token claims, provisions or updates the user and hands a session token to /sso-complete. Returns 404 when OIDC is not configured.',
    tags: ['Authentication'],
    responses: {
      '302': {
        description:
          'Redirect to /sso-complete with the session token, or back to /login with an error code.',
      },
      '404': notFoundResponse,
    },
  },
});

export const operations = [operation] as const;
