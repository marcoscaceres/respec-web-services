export interface Reference {
  id?: string;
  aliasOf?: string;
  versionOf?: string;
  title?: string;
  href?: string;
  [key: string]: unknown;
}

export type References = Record<string, Reference>;

export const MIN_REFERENCES = 80_000;

/**
 * Reference identifiers we refuse to look up or to answer with.
 *
 * Assigning one of these onto a response object either re-points its prototype
 * or, on a null-prototype object, becomes a real key the client receives. The
 * upstream data could carry `aliasOf: "__proto__"` as easily as a caller could
 * ask for it, so this is checked at both ends.
 */
const UNSAFE_KEY = /^(?:__proto__|constructor|prototype)$/i;

export function isUnsafeKey(key: string) {
  return UNSAFE_KEY.test(key);
}

const SENTINELS = ["WEBIDL", "rfc2119", "HTML"];

const SENTINEL_ALIASES = [
  ["ABNF", "RFC5234"],
  ["RFC5234", "rfc5234"],
];

/** @returns a reason to reject the data, or null if it is fit to serve. */
export function validate(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "not a plain object";
  }
  const references = data as References;
  const size = Object.keys(references).length;
  if (size < MIN_REFERENCES)
    return `only ${size} references, expected ${MIN_REFERENCES}+`;

  for (const id of SENTINELS) {
    const entry = references[id];
    if (typeof entry?.href !== "string" || typeof entry?.title !== "string") {
      return `sentinel ${id} is missing or malformed`;
    }
  }

  for (const [id, target] of SENTINEL_ALIASES) {
    if (references[id]?.aliasOf !== target)
      return `alias chain broken at ${id}`;
  }

  return null;
}
