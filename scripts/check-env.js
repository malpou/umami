/* eslint-disable no-console */
import 'dotenv/config';

function checkMissing(vars) {
  const missing = vars.reduce((arr, key) => {
    if (!process.env[key]) {
      arr.push(key);
    }
    return arr;
  }, []);

  if (missing.length) {
    console.log(`The following environment variables are not defined:`);
    for (const item of missing) {
      console.log(' - ', item);
    }
    process.exit(1);
  }
}

if (!process.env.SKIP_DB_CHECK && !process.env.DATABASE_TYPE) {
  checkMissing(['DATABASE_URL']);
}

checkMissing(['NATS_URL']);

if (process.env.CLOUD_URL) {
  checkMissing(['CLOUD_URL', 'CLICKHOUSE_URL']);
}

if (process.env.GUARD_IDENTITY) {
  checkMissing(['PLATFORM_KIT_EDGEAUTH_AUDIENCES', 'GUARD_USER_ISSUER']);

  if (
    !process.env.GUARD_ROLE_ADMIN &&
    !process.env.GUARD_ROLE_USER &&
    !process.env.GUARD_ROLE_VIEW_ONLY
  ) {
    console.log(
      'GUARD_IDENTITY is set but no role mapping is defined. ' +
        'Set at least one of GUARD_ROLE_ADMIN, GUARD_ROLE_USER, or GUARD_ROLE_VIEW_ONLY.',
    );
    process.exit(1);
  }
}
