import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type Stored = { data: string; operation: 'PUT' | 'DEL' };

  class FakeBucket {
    entries = new Map<string, Stored>();
    created: { key: string; ttl?: string }[] = [];
    openOpts: any[] = [];
    config: Record<string, any>;

    constructor(config: Record<string, any> = {}) {
      this.config = config;
    }

    async status() {
      return { streamInfo: { config: this.config } };
    }

    async get(key: string) {
      const entry = this.entries.get(key);

      return entry ? { key, operation: entry.operation, json: () => JSON.parse(entry.data) } : null;
    }

    async put(key: string, data: string) {
      this.entries.set(key, { data, operation: 'PUT' });
      return 1;
    }

    async create(key: string, data: string, ttl?: string) {
      if (this.entries.get(key)?.operation === 'PUT') {
        throw new Error('wrong last sequence');
      }
      this.created.push({ key, ttl });
      this.entries.set(key, { data, operation: 'PUT' });
      return 1;
    }

    async delete(key: string) {
      this.entries.set(key, { data: '', operation: 'DEL' });
    }
  }

  const buckets = new Map<string, FakeBucket>();

  return {
    FakeBucket,
    buckets,
    connect: vi.fn(),
    close: vi.fn(),
    usernamePasswordAuthenticator: vi.fn((user: string, pass?: string) => ({ user, pass })),
    credsAuthenticator: vi.fn((creds: Uint8Array) => ({ creds })),
  };
});

vi.mock('@nats-io/transport-node', () => ({
  connect: mocks.connect,
  credsAuthenticator: mocks.credsAuthenticator,
  usernamePasswordAuthenticator: mocks.usernamePasswordAuthenticator,
}));

vi.mock('@nats-io/kv', () => ({
  Kvm: class {
    async open(name: string, opts?: any) {
      const bucket = mocks.buckets.get(name);

      if (!bucket) {
        return {
          status: async () => {
            throw new Error('stream not found');
          },
        };
      }
      bucket.openOpts.push(opts);

      return bucket;
    }
  },
}));

const ENV = [
  'NATS_URL',
  'NATS_CREDS',
  'NATS_USER',
  'NATS_PASSWORD',
  'NATS_TOKEN_FILE',
  'SERVICE_IDENTITY',
  'NATS_KV_AUTH_BUCKET',
  'NATS_KV_CACHE_BUCKET',
];

async function loadKv() {
  vi.resetModules();
  delete globalThis['kv'];

  return import('./kv');
}

beforeEach(() => {
  for (const key of ENV) {
    delete process.env[key];
  }
  process.env.NATS_URL = 'nats://nats-1:4222, nats://nats-2:4222';

  mocks.buckets.clear();
  mocks.buckets.set(
    'umami_auth',
    new mocks.FakeBucket({ allow_direct: true, allow_msg_ttl: true }),
  );
  mocks.buckets.set('umami_cache', new mocks.FakeBucket());
  mocks.connect.mockReset();
  mocks.close.mockReset();
  mocks.connect.mockResolvedValue({ close: mocks.close });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toKvKey', () => {
  test('keeps safe ids readable and separates the prefix with a dot', async () => {
    const { toKvKey } = await loadKv();

    expect(toKvKey('auth:0123abcd')).toBe('auth.0123abcd');
    expect(toKvKey('website:6f0e8c1a-2b3c-4d5e-8f90-123456789abc')).toBe(
      'website.6f0e8c1a-2b3c-4d5e-8f90-123456789abc',
    );
  });

  test('encodes ids with characters NATS KV does not allow', async () => {
    const { toKvKey } = await loadKv();

    for (const slug of ['a b', 'a:b', 'ünï', 'a.b', '=abc', '', 'a/b']) {
      const key = toKvKey(`link:${slug}`);

      expect(key).toMatch(/^link\.=[A-Za-z0-9_-]*$/);
      expect(Buffer.from(key.slice('link.='.length), 'base64url').toString()).toBe(slug);
    }
  });

  test('cannot collide an encoded id with a safe one', async () => {
    const { toKvKey } = await loadKv();

    expect(toKvKey('link:a.b')).not.toBe(toKvKey('link:YS5i'));
  });
});

describe('KvStore', () => {
  test('round-trips JSON values through the cache bucket', async () => {
    const { default: kv } = await loadKv();

    await kv.cache.set('website:w1', { id: 'w1', name: 'Site' }, 60);

    await expect(kv.cache.get('website:w1')).resolves.toEqual({ id: 'w1', name: 'Site' });
    expect(mocks.buckets.get('umami_cache').entries.has('website.w1')).toBe(true);
    expect(mocks.connect).toHaveBeenCalledWith(
      expect.objectContaining({ servers: ['nats://nats-1:4222', 'nats://nats-2:4222'] }),
    );
  });

  test('treats an entry past its stored expiry as missing', async () => {
    vi.useFakeTimers();
    const { default: kv } = await loadKv();

    await kv.cache.set('link:abc', { id: 'l1' }, 60);
    vi.advanceTimersByTime(59_000);
    await expect(kv.cache.get('link:abc')).resolves.toEqual({ id: 'l1' });
    vi.advanceTimersByTime(2_000);
    await expect(kv.cache.get('link:abc')).resolves.toBeNull();
  });

  test('defaults to a one hour expiry', async () => {
    vi.useFakeTimers();
    const { default: kv } = await loadKv();

    await kv.auth.create('auth:k1', { userId: 'u1' });
    vi.advanceTimersByTime(3_599_000);
    await expect(kv.auth.get('auth:k1')).resolves.toEqual({ userId: 'u1' });
    vi.advanceTimersByTime(2_000);
    await expect(kv.auth.get('auth:k1')).resolves.toBeNull();
  });

  test('create sets a per-message TTL when the bucket allows it', async () => {
    const { default: kv } = await loadKv();

    await kv.auth.create('auth:k1', { userId: 'u1' }, 86400);

    const auth = mocks.buckets.get('umami_auth');
    expect(auth.created).toEqual([{ key: 'auth.k1', ttl: '86400s' }]);
    expect(auth.openOpts).toContainEqual({ allow_direct: true });
  });

  test('create relies on the stored expiry when per-message TTLs are off', async () => {
    mocks.buckets.set('umami_auth', new mocks.FakeBucket());
    const { default: kv } = await loadKv();

    await kv.auth.create('auth:k1', { userId: 'u1' }, 86400);

    expect(mocks.buckets.get('umami_auth').created).toEqual([{ key: 'auth.k1', ttl: undefined }]);
  });

  test('create refuses to overwrite an existing session', async () => {
    const { default: kv } = await loadKv();

    await kv.auth.create('auth:k1', { userId: 'u1' });

    await expect(kv.auth.create('auth:k1', { userId: 'u2' })).rejects.toThrow();
    await expect(kv.auth.get('auth:k1')).resolves.toEqual({ userId: 'u1' });
  });

  test('del revokes a session', async () => {
    const { default: kv } = await loadKv();

    await kv.auth.create('auth:k1', { userId: 'u1' });
    await kv.auth.del('auth:k1');

    await expect(kv.auth.get('auth:k1')).resolves.toBeNull();
  });

  test('fetch only queries on a miss', async () => {
    const { default: kv } = await loadKv();
    const query = vi.fn().mockResolvedValue({ id: 'p1' });

    await expect(kv.cache.fetch('pixel:p', query, 86400)).resolves.toEqual({ id: 'p1' });
    await expect(kv.cache.fetch('pixel:p', query, 86400)).resolves.toEqual({ id: 'p1' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('fetch does not cache an empty result', async () => {
    const { default: kv } = await loadKv();
    const query = vi.fn().mockResolvedValue(null);

    await expect(kv.cache.fetch('link:gone', query)).resolves.toBeNull();
    expect(mocks.buckets.get('umami_cache').entries.size).toBe(0);
  });
});

describe('checkKv', () => {
  test('fails when NATS_URL is not set', async () => {
    delete process.env.NATS_URL;
    const { checkKv } = await loadKv();

    await expect(checkKv()).rejects.toThrow('NATS_URL is not defined.');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  test('fails and closes the connection when a bucket does not exist', async () => {
    mocks.buckets.delete('umami_auth');
    const { checkKv } = await loadKv();

    await expect(checkKv()).rejects.toThrow('stream not found');
    expect(mocks.close).toHaveBeenCalled();
  });

  test('retries the connection after a failure', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('connection refused'));
    const { checkKv } = await loadKv();

    await expect(checkKv()).rejects.toThrow('connection refused');
    await expect(checkKv()).resolves.toEqual({ auth: 'umami_auth', cache: 'umami_cache' });
  });

  test('uses the configured bucket names and user/password auth', async () => {
    process.env.NATS_KV_AUTH_BUCKET = 'custom_auth';
    process.env.NATS_KV_CACHE_BUCKET = 'custom_cache';
    process.env.NATS_USER = 'umami';
    process.env.NATS_PASSWORD = 'pw';
    mocks.buckets.set('custom_auth', new mocks.FakeBucket());
    mocks.buckets.set('custom_cache', new mocks.FakeBucket());
    const { checkKv } = await loadKv();

    await expect(checkKv()).resolves.toEqual({ auth: 'custom_auth', cache: 'custom_cache' });
    expect(mocks.connect).toHaveBeenCalledWith(
      expect.objectContaining({ authenticator: { user: 'umami', pass: 'pw' } }),
    );
  });

  test('reads a creds file when NATS_CREDS is set', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const file = join(mkdtempSync(join(tmpdir(), 'kv-test-')), 'umami.creds');
    writeFileSync(file, 'creds-content');
    process.env.NATS_CREDS = file;
    const { checkKv } = await loadKv();

    await checkKv();

    expect(Buffer.from(mocks.credsAuthenticator.mock.calls[0][0]).toString()).toBe('creds-content');
  });

  test('re-reads NATS_TOKEN_FILE on every connect, as user SERVICE_IDENTITY', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const file = join(mkdtempSync(join(tmpdir(), 'kv-test-')), 'token');
    writeFileSync(file, 'first-token\n');
    process.env.NATS_TOKEN_FILE = file;
    process.env.SERVICE_IDENTITY = 'umami/umami';
    const { checkKv } = await loadKv();

    await checkKv();

    const [user, pass] = mocks.usernamePasswordAuthenticator.mock.lastCall as unknown as [
      string,
      () => string,
    ];
    expect(user).toBe('umami/umami');
    expect(pass()).toBe('first-token');
    // The kubelet rotates the projected token in place; a reconnect must see the new one.
    writeFileSync(file, 'rotated-token\n');
    expect(pass()).toBe('rotated-token');
  });
});
