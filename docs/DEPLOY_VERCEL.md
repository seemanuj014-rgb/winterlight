# DEPLOY_VERCEL (DV)

> **Hosting moved to GitHub Pages (owner's decision). See `docs/DEPLOY_GITHUB_PAGES.md`.** `vercel.json` stays but does nothing on Pages.

## One-time setup (Phase 1)
1. Create a **private** GitHub repo `winterlight`. Push `main` and `dev`.
2. On vercel.com: Add New, Project, import the repo. Framework preset: **Vite**. Build command `npm run build`, output `dist`. Production branch: `main`.
3. Project Settings, Environment Variables: (no environment variables are needed).
4. First deploy happens automatically. Open the URL on your phone.
5. `vercel.json` already sends `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`; `public/robots.txt` disallows everything. Confirm both on the live URL.

## Daily flow
- `scripts/push_phase.ps1` (or `.sh`) pushes branch `dev`. Vercel builds a **preview URL** for it. Use that to test.
- If the preview asks you to log in to Vercel, that is Vercel's deployment protection: open it while logged in, or relax it for previews in Project Settings.
- At gates (G0 to G3) run `scripts/release.ps1`/`.sh`: merges `dev` into `main`, tags, pushes. That updates the production URL.

## The link you send her
Send the **production** URL only after G3, and ideally on 10 Nov itself (the lock holds it until midnight IST either way). Rename the project in Vercel to something neutral if you like (`Settings, General, Project Name` changes the `*.vercel.app` name). A custom domain is optional.

## Notes
- The repo is private; the deployed site is not. Assume anyone with the link can read the page source. `tools/leak_scan.mjs` (Phase 34) checks the build for anything private.
- There is no lock: the owner sends the link on the day.
- Free (Hobby) Vercel is fine for this.

## Placeholder guard (Phase 4)
- Production builds (Vercel's production environment, i.e. branch `main`, or `WINTERLIGHT_STRICT=1`) refuse to build while any `TODO_OWNER` remains in `content/`, and list each one. Preview builds of `dev` allow placeholders so phase pushes keep working. Try it locally: `WINTERLIGHT_STRICT=1 npm run build`.
