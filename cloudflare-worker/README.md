# ChronoLens DeepSeek Proxy

This Cloudflare Worker keeps the DeepSeek API key out of the Chrome extension.

## Setup

```sh
npm install
npx wrangler login
npm run secret:deepseek
npm run deploy
```

After deploy, copy the Worker URL into `SUMMARY_PROXY_URL` in `../background.js`, then rebuild the extension.

Do not paste the DeepSeek API key into source files or commit it to git.

## Abuse Controls

The Worker rejects normal website origins by default and only allows Chrome extension origins. For production, replace the broad `chrome-extension://` value in `wrangler.jsonc` with your published extension origin:

```json
"ALLOWED_EXTENSION_ORIGINS": "chrome-extension://your-extension-id"
```

Also add a Cloudflare Rate Limiting binding or dashboard/WAF rate limit for this Worker before public release. The Worker code automatically uses a `RATE_LIMITER` binding when one is configured.

Requests without an `Origin` header are rejected by default. If you need temporary command-line testing, set `ALLOW_NO_ORIGIN=true` as a Worker variable and remove it before release.
