// Pure validation of the owner's content files. No DOM, no three, no node: it runs in the
// browser, in tests and inside vite.config.ts. It never edits the owner's words; it only checks them.

export const PLACEHOLDER = 'TODO_OWNER';

export interface Issue {
  file: string;
  where: string;
  message: string;
}

export interface Names {
  formal: string;
  nickname: string;
  owner_calls_her: string;
  she_calls_owner: string;
  character: { name: string };
  constellations: { id: string; name: string; shape: string }[];
}

export type Wishes = Record<string, string>;

export const CREDIT_KEYS = ['finale_sky_message', 'sign_off', 'made_by'] as const;
export type Credits = Record<(typeof CREDIT_KEYS)[number], string>;

export interface Content {
  /** Exactly the bytes of content/letter.md. Never trimmed, never edited. */
  letter: string;
  wishes: Wishes;
  names: Names;
  credits: Credits;
}

export interface RawContent {
  letter: string;
  wishes: string;
  names: string;
  credits: string;
}

export interface ValidationResult {
  content: Content | null;
  /** Structural problems: always fatal. */
  errors: Issue[];
  /** Fields still holding TODO_OWNER: fatal in strict (production) mode, allowed in dev. */
  placeholders: Issue[];
}

const FILES = {
  letter: 'content/letter.md',
  wishes: 'content/wishes.json',
  names: 'content/names.json',
  credits: 'content/credits.json',
} as const;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasPlaceholder(s: string): boolean {
  return s.includes(PLACEHOLDER);
}

function parseJson(raw: string, file: string, errors: Issue[]): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    errors.push({ file, where: '(whole file)', message: 'is not valid JSON: ' + (e instanceof Error ? e.message : String(e)) });
    return undefined;
  }
}

/** Every string anywhere inside `value` that contains the placeholder, keys starting with "_" (notes) skipped. */
function scanPlaceholders(file: string, value: unknown, path: string, out: Issue[]): void {
  if (typeof value === 'string') {
    if (hasPlaceholder(value)) out.push({ file, where: path, message: `still says ${PLACEHOLDER}` });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => scanPlaceholders(file, v, `${path}[${i}]`, out));
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) continue;
      scanPlaceholders(file, v, path ? `${path}.${k}` : k, out);
    }
  }
}

function needString(obj: Record<string, unknown>, key: string, file: string, where: string, errors: Issue[]): string | null {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    errors.push({ file, where: where ? `${where}.${key}` : key, message: 'must be a non-empty string' });
    return null;
  }
  return v;
}

export function validateContent(raw: RawContent): ValidationResult {
  const errors: Issue[] = [];
  const placeholders: Issue[] = [];

  // letter: checked, never changed
  if (raw.letter.trim() === '') errors.push({ file: FILES.letter, where: '(whole file)', message: 'is empty' });
  else if (hasPlaceholder(raw.letter)) placeholders.push({ file: FILES.letter, where: '(whole file)', message: `still says ${PLACEHOLDER}` });

  // names
  const namesJson = parseJson(raw.names, FILES.names, errors);
  let names: Names | null = null;
  if (namesJson !== undefined) {
    if (!isObj(namesJson)) errors.push({ file: FILES.names, where: '(whole file)', message: 'must be a JSON object' });
    else {
      const n = FILES.names;
      const formal = needString(namesJson, 'formal', n, '', errors);
      const nickname = needString(namesJson, 'nickname', n, '', errors);
      const ocr = needString(namesJson, 'owner_calls_her', n, '', errors);
      const sco = needString(namesJson, 'she_calls_owner', n, '', errors);
      let charName: string | null = null;
      if (!isObj(namesJson.character)) errors.push({ file: n, where: 'character', message: 'must be an object with a name' });
      else charName = needString(namesJson.character, 'name', n, 'character', errors);
      const cons: Names['constellations'] = [];
      if (!Array.isArray(namesJson.constellations) || namesJson.constellations.length === 0) {
        errors.push({ file: n, where: 'constellations', message: 'must be a non-empty list' });
      } else {
        const seen = new Set<string>();
        namesJson.constellations.forEach((c: unknown, i: number) => {
          const w = `constellations[${i}]`;
          if (!isObj(c)) {
            errors.push({ file: n, where: w, message: 'must be an object' });
            return;
          }
          const id = needString(c, 'id', n, w, errors);
          const name = needString(c, 'name', n, w, errors);
          const shape = needString(c, 'shape', n, w, errors);
          if (id !== null) {
            if (!ID_RE.test(id)) errors.push({ file: n, where: `${w}.id`, message: 'must be lowercase letters, digits and single dashes' });
            else if (seen.has(id)) errors.push({ file: n, where: `${w}.id`, message: `"${id}" is used twice` });
            seen.add(id);
          }
          if (id !== null && name !== null && shape !== null) cons.push({ id, name, shape });
        });
      }
      scanPlaceholders(n, namesJson, '', placeholders);
      if (formal && nickname && ocr && sco && charName && cons.length === (Array.isArray(namesJson.constellations) ? namesJson.constellations.length : -1)) {
        names = { formal, nickname, owner_calls_her: ocr, she_calls_owner: sco, character: { name: charName }, constellations: cons };
      }
    }
  }

  // wishes: one per constellation id, no strays
  const wishesJson = parseJson(raw.wishes, FILES.wishes, errors);
  let wishes: Wishes | null = null;
  if (wishesJson !== undefined) {
    if (!isObj(wishesJson)) errors.push({ file: FILES.wishes, where: '(whole file)', message: 'must be a JSON object' });
    else {
      const w: Wishes = {};
      for (const [k, v] of Object.entries(wishesJson)) {
        if (k.startsWith('_')) continue;
        if (typeof v !== 'string' || v.trim() === '') errors.push({ file: FILES.wishes, where: k, message: 'must be a non-empty string' });
        else w[k] = v;
      }
      if (names) {
        const ids = new Set(names.constellations.map((c) => c.id));
        for (const id of ids) if (!(id in wishesJson)) errors.push({ file: FILES.wishes, where: id, message: 'is missing (every constellation needs one wish)' });
        for (const k of Object.keys(w)) if (!ids.has(k)) errors.push({ file: FILES.wishes, where: k, message: 'does not match any constellation id in names.json' });
      }
      scanPlaceholders(FILES.wishes, wishesJson, '', placeholders);
      wishes = w;
    }
  }

  // credits
  const creditsJson = parseJson(raw.credits, FILES.credits, errors);
  let credits: Credits | null = null;
  if (creditsJson !== undefined) {
    if (!isObj(creditsJson)) errors.push({ file: FILES.credits, where: '(whole file)', message: 'must be a JSON object' });
    else {
      const c = {} as Credits;
      let ok = true;
      for (const k of CREDIT_KEYS) {
        const v = needString(creditsJson, k, FILES.credits, '', errors);
        if (v === null) ok = false;
        else c[k] = v;
      }
      scanPlaceholders(FILES.credits, creditsJson, '', placeholders);
      if (ok) credits = c;
    }
  }

  const content = errors.length === 0 && names && wishes && credits ? { letter: raw.letter, wishes, names, credits } : null;
  return { content, errors, placeholders };
}

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `  - ${i.file} > ${i.where}: ${i.message}`).join('\n');
}

export class ContentError extends Error {
  readonly issues: Issue[];
  constructor(header: string, issues: Issue[]) {
    super(`${header}\n${formatIssues(issues)}`);
    this.name = 'ContentError';
    this.issues = issues;
  }
}

/**
 * Strict = a production build. Structural errors always throw; placeholders throw only when strict.
 * Returns the content untouched plus any placeholders that were tolerated (dev).
 */
export function assertContent(raw: RawContent, strict: boolean): { content: Content; placeholders: Issue[] } {
  const r = validateContent(raw);
  if (r.errors.length > 0 || !r.content) {
    throw new ContentError('Content files are broken:', r.errors);
  }
  if (strict && r.placeholders.length > 0) {
    throw new ContentError(
      `Refusing to ship: ${r.placeholders.length} place(s) still say ${PLACEHOLDER}. These are the owner's words and Claude never writes them. Fill them in:`,
      r.placeholders,
    );
  }
  return { content: r.content, placeholders: r.placeholders };
}
