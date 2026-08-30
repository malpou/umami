<p align="center">
  <img src="https://content.umami.is/website/images/umami-logo.png" alt="Umami Logo" width="100">
</p>

<h1 align="center">Umami</h1>

<p align="center">
  <i>Umami is a privacy-first analytics platform. Traffic, campaigns, behavior, conversions, and revenue in one place — no cookies, no surveillance, self-hosted or in the cloud.</i>
</p>

<p align="center">
  <a href="https://github.com/umami-software/umami/releases"><img src="https://img.shields.io/github/release/umami-software/umami.svg" alt="GitHub Release" /></a>
  <a href="https://github.com/umami-software/umami/blob/master/LICENSE"><img src="https://img.shields.io/github/license/umami-software/umami.svg" alt="MIT License" /></a>
  <a href="https://github.com/umami-software/umami/actions"><img src="https://img.shields.io/github/actions/workflow/status/umami-software/umami/ci.yml" alt="Build Status" /></a>
  <a href="https://cloud.umami.is/share/LGazGOecbDtaIwDr/umami.is" style="text-decoration: none;"><img src="https://img.shields.io/badge/Try%20Demo%20Now-Click%20Here-brightgreen" alt="Umami Demo" /></a>
</p>

---

## 🚀 Getting Started

A detailed getting started guide can be found at [umami.is/docs](https://umami.is/docs/).

---

## 🛠 Installing from Source

### Requirements

- A server with Node.js version 18.18+.
- A PostgreSQL database version v12.14+.

### Get the source code and install packages

```bash
git clone https://github.com/umami-software/umami.git
cd umami
pnpm install
```

### Configure Umami

Create an `.env` file with the following:

```bash
DATABASE_URL=connection-url
```

Optional: set `API_URL` to change the base URL used by internal UI API calls.
Relative paths are served under `BASE_PATH`; absolute URLs are proxied through the local `/api` route.
For example, `API_URL=/internal-api` or `API_URL=https://api.example.com/api`.

Optional: set `TWO_FACTOR_ENCRYPTION_KEY` to a 64-character hex string to enable two-factor
authentication. Generate one with `openssl rand -hex 32`. Two-factor authentication is unavailable
and cannot be required until this key is set.

The connection URL format:

```bash
postgresql://username:mypassword@localhost:5432/mydb
```

### OIDC / Single Sign-On (optional)

Umami can authenticate users against any OpenID Connect provider (for example [Zitadel](https://zitadel.com))
using the authorization code flow with PKCE. Users are provisioned automatically on first login, and their
umami role is derived from role claims in the ID token on **every** login — the identity provider is the
source of truth for access.

When OIDC is enabled, local password login is disabled (both the login form and the API) unless
`OIDC_ALLOW_LOCAL_LOGIN` is set.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OIDC_ISSUER` | yes | — | Issuer URL; discovery document is read from `<issuer>/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID` | yes | — | OAuth client ID |
| `OIDC_CLIENT_SECRET` | no | — | Omit for a public client using PKCE; set for a confidential client |
| `APP_URL` | yes | — | Public base URL of your umami instance, e.g. `https://analytics.example.com` |
| `OIDC_ROLE_ADMIN` | * | — | Comma-separated provider role keys mapped to the umami `admin` role |
| `OIDC_ROLE_USER` | * | — | Comma-separated provider role keys mapped to the umami `user` role |
| `OIDC_ROLE_VIEW_ONLY` | * | — | Comma-separated provider role keys mapped to the umami `view-only` role |
| `OIDC_SCOPES` | no | `openid profile email urn:zitadel:iam:org:projects:roles` | Requested scopes |
| `OIDC_ROLES_CLAIM` | no | `urn:zitadel:iam:org:project:roles` | Claim containing the user's roles (object map, array, or delimited string) |
| `OIDC_ALLOW_LOCAL_LOGIN` | no | off | Keep username/password login available alongside SSO (break-glass) |
| `OIDC_PROVIDER_NAME` | no | `SSO` | Name shown on the login button |
| `OIDC_RP_LOGOUT` | no | off | Also end the identity provider session on logout |
| `OIDC_AUTO_LINK_USERNAME` | no | off | Link an SSO login to an existing local account with the same username (only from `preferred_username`, or from `email` when `email_verified` is true) |
| `OIDC_SESSION_DURATION` | no | `24h` | Lifetime of umami sessions created via SSO (e.g. `12h`, `30m`, `7d`) |

\* At least one of the three role mappings must be set. A user with none of the mapped roles is denied access.

Do not combine `DISABLE_LOGIN` with OIDC — the login page must render to show the single sign-on button.
Users who were already logged in with a local account keep their existing sessions when OIDC is enabled;
rotate `APP_SECRET` to force everyone through the identity provider.

Zitadel setup: create a **Web** application with **PKCE** authentication, set the redirect URI to
`<APP_URL>/api/auth/oidc/callback` and the post-logout redirect URI to `<APP_URL>/login`, create roles
(e.g. `umami-admin`, `umami-user`) on the project, grant them to your users, and either enable
**Assert Roles on Authentication** on the project or rely on the roles scope requested by default.

### Build the Application

```bash
pnpm run build
```

The build step will create tables in your database if you are installing for the first time. It will also create a login user with username **admin** and password **umami**.

### Start the Application

```bash
pnpm run start
```

By default, this will launch the application on `http://localhost:3000`. You will need to either [proxy](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/) requests from your web server or change the [port](https://nextjs.org/docs/api-reference/cli#production) to serve the application directly.

---

## 🐳 Installing with Docker

Umami provides Docker images as well as a Docker compose file for easy deployment.

Docker image:

```bash
docker pull docker.umami.is/umami-software/umami:latest
```

Docker compose (Runs Umami with a PostgreSQL database):

```bash
docker compose up -d
```

---

## 🔄 Getting Updates

To get the latest features, simply do a pull, install any new dependencies, and rebuild:

```bash
git pull
pnpm install
pnpm build
```

To update the Docker image, simply pull the new images and rebuild:

```bash
docker compose pull
docker compose up --force-recreate -d
```

---

## 🛟 Support

<p align="center">
  <a href="https://github.com/umami-software/umami"><img src="https://img.shields.io/badge/GitHub--blue?style=social&logo=github" alt="GitHub" /></a>
  <a href="https://twitter.com/umami_software"><img src="https://img.shields.io/badge/Twitter--blue?style=social&logo=twitter" alt="Twitter" /></a>
  <a href="https://linkedin.com/company/umami-software"><img src="https://img.shields.io/badge/LinkedIn--blue?style=social&logo=linkedin" alt="LinkedIn" /></a>
  <a href="https://umami.is/discord"><img src="https://img.shields.io/badge/Discord--blue?style=social&logo=discord" alt="Discord" /></a>
</p>

[release-shield]: https://img.shields.io/github/release/umami-software/umami.svg
[releases-url]: https://github.com/umami-software/umami/releases
[license-shield]: https://img.shields.io/github/license/umami-software/umami.svg
[license-url]: https://github.com/umami-software/umami/blob/master/LICENSE
[build-shield]: https://img.shields.io/github/actions/workflow/status/umami-software/umami/ci.yml
[build-url]: https://github.com/umami-software/umami/actions
[github-shield]: https://img.shields.io/badge/GitHub--blue?style=social&logo=github
[github-url]: https://github.com/umami-software/umami
[twitter-shield]: https://img.shields.io/badge/Twitter--blue?style=social&logo=twitter
[twitter-url]: https://twitter.com/umami_software
[linkedin-shield]: https://img.shields.io/badge/LinkedIn--blue?style=social&logo=linkedin
[linkedin-url]: https://linkedin.com/company/umami-software
[discord-shield]: https://img.shields.io/badge/Discord--blue?style=social&logo=discord
[discord-url]: https://discord.com/invite/4dz4zcXYrQ
