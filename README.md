# bits-now-page

Supabase database setup and admin-function deployment instructions are in [SUPABASE_SETUP.md](SUPABASE_SETUP.md).

Configure the browser-facing Supabase URL and publishable/anon key in `supabase-config.js`. The public board is `index.html`; admin sign-in and management are at `admin.html`.

## Build and deployment

The repository's `Build and deploy Pages` workflow tests and builds pushes to `main`, then deploys only `dist/` to GitHub Pages. Pull requests run the same tests and build without deploying. In GitHub **Settings > Pages > Build and deployment**, select **GitHub Actions** as the source. Disable any previous custom Pages deployment workflow that uploads the repository directly, so it cannot overwrite the built site.

With Node.js 22 or newer, run locally:

```sh
node --test scripts/build.test.mjs
node scripts/build.mjs
```

The build gives every root-level CSS and JavaScript asset a content-hashed filename (including `supabase-config.js`) and rewrites references in both HTML pages. Only the public HTML and fingerprinted assets are deployed; source pages remain usable directly for local development. Unchanged assets keep their URLs, while changed assets get new URLs so browsers fetch them without clearing their cache. Third-party fonts and analytics remain controlled by their providers.

HTML entry points keep stable URLs and must be revalidated to discover new asset URLs. GitHub Pages manages its own cache headers, so its normal HTML cache lifetime can still delay an update; fingerprinting does not force already-open tabs to reload. If moving to another host, serve HTML with `Cache-Control: no-cache` and hashed assets with `Cache-Control: public, max-age=31536000, immutable`.