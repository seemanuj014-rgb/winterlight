// Build-time helpers used by vite.config.ts (node only). Kept here so tests can reach them.
/** First-load download budget from docs/PERF_BUDGET.md: 2.5 MB transferred (gzip). */
export const DOWNLOAD_BUDGET_BYTES = 2.5 * 1024 * 1024;

/** Pure check: the files that make up a first load, with their gzip sizes. Returns an error message, or null when inside the budget. */
export function downloadBudgetError(files: { name: string; gzipBytes: number }[], budget: number = DOWNLOAD_BUDGET_BYTES): string | null {
  const total = files.reduce((n, f) => n + f.gzipBytes, 0);
  if (total <= budget) return null;
  const top = [...files].sort((a, b) => b.gzipBytes - a.gzipBytes).slice(0, 3).map((f) => `${f.name} ${(f.gzipBytes / 1024).toFixed(0)} KB`).join(', ');
  return `First-load download is ${(total / 1048576).toFixed(2)} MB gzip, over the ${(budget / 1048576).toFixed(1)} MB budget (docs/PERF_BUDGET.md). Biggest: ${top}`;
}

type Env = Record<string, string | undefined>;

/** Strict (placeholders refuse to ship) on Vercel's production environment, or when WINTERLIGHT_STRICT=1. Preview builds of `dev` stay lenient. */
export function isStrictEnv(env: Env): boolean {
  return env.VERCEL_ENV === 'production' || env.WINTERLIGHT_STRICT === '1';
}
