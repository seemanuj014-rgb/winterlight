// Phase 34: scan dist/ for anything private before it ships. Usage: node tools/leak_scan.mjs [dir]
// Always checks: source maps, sourceMappingURL. (Placeholders in content/ are refused by the strict build itself; the bundled validator code contains the word, so dist/ is not searched for it.) Also checks every term in the env var LEAK_TERMS (comma separated)
// and in tools/leak_terms.local.txt (one per line, git-ignored): put her username, city, college there. Terms are never printed in the repo.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
if (!existsSync(dir)) {
  console.error(`leak_scan: ${dir}/ not found. Run npm run build first.`);
  process.exit(2);
}
const terms = [
  ...(process.env.LEAK_TERMS ?? '').split(','),
  ...(existsSync('tools/leak_terms.local.txt') ? readFileSync('tools/leak_terms.local.txt', 'utf8').split(/\r?\n/) : []),
].map((t) => t.trim()).filter(Boolean);

const TEXT = /\.(html|js|css|json|txt|svg|webmanifest|map)$/i;
const problems = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (/\.map$/i.test(name)) problems.push(`${p}: a source map is shipped`);
    if (!TEXT.test(name)) continue;
    const body = readFileSync(p, 'utf8');
    if (/sourceMappingURL=/.test(body)) problems.push(`${p}: points at a source map`);
    const low = body.toLowerCase();
    for (const t of terms) if (low.includes(t.toLowerCase())) problems.push(`${p}: contains a private term (#${terms.indexOf(t) + 1} of your list)`);
  }
};
walk(dir);
if (!terms.length) console.log('leak_scan: no private terms configured (LEAK_TERMS or tools/leak_terms.local.txt); only the built-in checks ran.');
if (problems.length) {
  console.error('leak_scan FAILED:\n' + problems.map((x) => ' - ' + x).join('\n'));
  process.exit(1);
}
console.log(`leak_scan OK (${terms.length} private terms, dist scanned).`);
