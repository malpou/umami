import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for guard in tests: an in-memory P-256 key, a JWKS served on
// 127.0.0.1, and ES256 identity JWTs minted the way guard mints them.

export interface IdentityClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  roles?: string[];
}

export interface TestIssuer {
  jwksUrl: string;
  mint(claims: IdentityClaims, aud: string, options?: { kid?: string; exp?: number }): string;
  close(): Promise<void>;
}

const KID = 'test-1';

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function signToken(key: KeyObject, header: object, payload: object): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });

  return `${input}.${b64url(signature)}`;
}

export async function startTestIssuer(): Promise<TestIssuer> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwks = JSON.stringify({
    keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'ES256' }],
  });

  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(jwks);
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    jwksUrl: `http://127.0.0.1:${port}/jwks.json`,
    mint(claims, aud, options = {}) {
      const iat = Math.floor(Date.now() / 1000);

      return signToken(
        privateKey,
        { alg: 'ES256', typ: 'bastion-id+jwt', kid: options.kid ?? KID },
        {
          iss: 'bastion',
          aud,
          email: '',
          email_verified: false,
          name: '',
          roles: [],
          sid: 'abcdef0123456789',
          auth_time: iat,
          azp: 'umami',
          src: 'session',
          iat,
          exp: options.exp ?? iat + 60,
          ...claims,
        },
      );
    },
    close() {
      return new Promise(resolve => server.close(() => resolve()));
    },
  };
}
