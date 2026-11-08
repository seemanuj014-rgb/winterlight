import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { assertContent } from './src/content/validate';
import { gzipSync } from 'node:zlib';
import { isStrictEnv, downloadBudgetError } from './tools/buildEnv';

/** Link previews need an absolute image URL: on Vercel production use its domain, otherwise a relative path (fine locally). */
function siteUrl(env: Record<string, string | undefined>): Plugin {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = env.SITE_URL ? env.SITE_URL.replace(/\/$/, '') : host ? `https://${host}` : '';
  return { name: 'winterlight-site-url', transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', base) };
}

/** Fail the build when the first-load download goes over the budget (Phase 31). */
function sizeGate(): Plugin {
  return {
    name: 'winterlight-size-gate',
    apply: 'build',
    generateBundle(_o, bundle) {
      const files = Object.values(bundle).map((f) => {
        const body = f.type === 'chunk' ? f.code : f.source;
        return { name: f.fileName, gzipBytes: gzipSync(typeof body === 'string' ? Buffer.from(body) : Buffer.from(body)).length };
      });
      const err = downloadBudgetError(files);
      if (err) this.error(err);
    },
  };
}

/** In a strict (production) build, stop before bundling if any of the owner's words are still TODO_OWNER. */
function contentGuard(strict: boolean): Plugin {
  return {
    name: 'winterlight-content-guard',
    apply: 'build',
    buildStart() {
      if (!strict) return;
      const read = (f: string) => readFileSync(new URL(`./content/${f}`, import.meta.url), 'utf8');
      assertContent({ letter: read('letter.md'), wishes: read('wishes.json'), names: read('names.json'), credits: read('credits.json') }, true);
    },
  };
}

export default defineConfig(({ mode }) => {
  // '' prefix: also sees Vercel's own variables (VERCEL_ENV). Only the two values below are ever put into the bundle.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const strict = isStrictEnv(env);
  return {
    define: {
      __STRICT_CONTENT__: JSON.stringify(strict),
    },
    plugins: [contentGuard(strict), sizeGate(), siteUrl(env)],
    // './' so the card works from a sub-folder like https://name.github.io/repo/ as well as from a root domain
    base: './',
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
    test: { include: ['tests/**/*.test.ts'], environment: 'node' },
  };
});
