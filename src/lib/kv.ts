import { readFileSync } from 'node:fs';
import { type KV, Kvm } from '@nats-io/kv';
import {
  type Authenticator,
  connect,
  credsAuthenticator,
  type NatsConnection,
  usernamePasswordAuthenticator,
} from '@nats-io/transport-node';
import debug from 'debug';

const log = debug('umami:kv');

export const DEFAULT_TTL = 3600;

const KV_GLOBAL = 'kv';
const PROBE_KEY = 'probe';
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

type BucketName = 'auth' | 'cache';

interface Bucket {
  kv: KV;
  msgTTL: boolean;
}

interface Buckets {
  nc: NatsConnection;
  auth: Bucket;
  cache: Bucket;
}

interface Entry {
  v: any;
  exp: number;
}

export function getBucketNames(): Record<BucketName, string> {
  return {
    auth: process.env.NATS_KV_AUTH_BUCKET || 'umami_auth',
    cache: process.env.NATS_KV_CACHE_BUCKET || 'umami_cache',
  };
}

// Callers keep the `prefix:id` key shape. KV keys only allow [-/_=.a-zA-Z0-9], so the
// id passes through when it is already safe and is otherwise base64url-encoded behind
// a '=' marker, which a safe id can never contain.
export function toKvKey(key: string) {
  const sep = key.indexOf(':');
  const prefix = sep === -1 ? '' : key.slice(0, sep);
  const id = sep === -1 ? key : key.slice(sep + 1);
  const safeId = SAFE_ID.test(id) ? id : `=${Buffer.from(id).toString('base64url')}`;

  return prefix ? `${prefix}.${safeId}` : safeId;
}

function getAuthenticator(): Authenticator | undefined {
  if (process.env.NATS_CREDS) {
    return credsAuthenticator(readFileSync(process.env.NATS_CREDS));
  }

  // A Kubernetes ServiceAccount token that rotates (an auth callout verifies it). The
  // authenticator runs on every connect, so each reconnect sends the current file, not
  // the token the pod started with.
  if (process.env.NATS_TOKEN_FILE) {
    const file = process.env.NATS_TOKEN_FILE;

    return usernamePasswordAuthenticator(
      process.env.NATS_USER || process.env.SERVICE_IDENTITY,
      () => readFileSync(file, 'utf8').trim(),
    );
  }

  if (process.env.NATS_USER) {
    return usernamePasswordAuthenticator(process.env.NATS_USER, process.env.NATS_PASSWORD);
  }

  return undefined;
}

// Binds to a bucket provisioned outside Umami; status() fails if it does not exist.
async function bindBucket(kvm: Kvm, name: string): Promise<Bucket> {
  const bound = await kvm.open(name);
  const { config } = (await bound.status()).streamInfo;
  const kv = config.allow_direct ? await kvm.open(name, { allow_direct: true }) : bound;

  return { kv, msgTTL: !!config.allow_msg_ttl };
}

async function openBuckets(): Promise<Buckets> {
  const servers = process.env.NATS_URL;

  if (!servers) {
    throw new Error('NATS_URL is not defined.');
  }

  const names = getBucketNames();
  const nc = await connect({
    servers: servers.split(',').map(s => s.trim()),
    name: 'umami',
    authenticator: getAuthenticator(),
    maxReconnectAttempts: -1,
  });

  try {
    const kvm = new Kvm(nc);
    const [auth, cache] = await Promise.all([
      bindBucket(kvm, names.auth),
      bindBucket(kvm, names.cache),
    ]);

    log('NATS KV connected');

    return { nc, auth, cache };
  } catch (e) {
    await nc.close();
    throw e;
  }
}

let buckets: Promise<Buckets> | null = null;

function getBuckets() {
  if (!buckets) {
    buckets = openBuckets().catch(e => {
      buckets = null;
      throw e;
    });
  }

  return buckets;
}

function encode(value: any, time?: number) {
  const ttl = time && time > 0 ? time : DEFAULT_TTL;

  return { ttl, data: JSON.stringify({ v: value, exp: Date.now() + ttl * 1000 }) };
}

class KvStore {
  bucket: BucketName;

  constructor(bucket: BucketName) {
    this.bucket = bucket;
  }

  async getBucket() {
    return (await getBuckets())[this.bucket];
  }

  async get(key: string) {
    const { kv } = await this.getBucket();
    const entry = await kv.get(toKvKey(key));

    if (entry?.operation !== 'PUT') {
      return null;
    }

    try {
      const { v, exp } = entry.json<Entry>();

      return exp > Date.now() ? v : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: any, time?: number) {
    const { kv } = await this.getBucket();

    return kv.put(toKvKey(key), encode(value, time).data);
  }

  // Writes a key that must not exist yet. The expiry is stored in the value and, when
  // the bucket allows per-message TTLs, also enforced by the server.
  async create(key: string, value: any, time?: number) {
    const { kv, msgTTL } = await this.getBucket();
    const { ttl, data } = encode(value, time);

    return kv.create(toKvKey(key), data, msgTTL ? `${ttl}s` : undefined);
  }

  async del(key: string) {
    const { kv } = await this.getBucket();

    return kv.delete(toKvKey(key));
  }

  async fetch(key: string, query: () => Promise<any>, time?: number) {
    const result = await this.get(key);

    if (!result && query) {
      const data = await query();
      if (data) {
        await this.set(key, data, time);
      }
      return data;
    }

    return result;
  }
}

// Fails unless NATS is configured and both buckets exist and can be read.
export async function checkKv() {
  const { auth, cache } = await getBuckets();

  await auth.kv.get(PROBE_KEY);
  await cache.kv.get(PROBE_KEY);

  return getBucketNames();
}

function getClient() {
  const client = { auth: new KvStore('auth'), cache: new KvStore('cache') };

  if (process.env.NODE_ENV !== 'production') {
    globalThis[KV_GLOBAL] = client;
  }

  return client;
}

const client: { auth: KvStore; cache: KvStore } = globalThis[KV_GLOBAL] || getClient();

export default client;
