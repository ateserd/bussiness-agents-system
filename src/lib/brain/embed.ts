/**
 * Embeddings for the shared memory.
 *
 * The default provider is deterministic, offline and dependency-free: a hashed
 * bag-of-trigrams projected into a fixed-width vector. It is not a semantic
 * model — it captures lexical overlap, which at this corpus size (hundreds to a
 * few thousand atomic statements) recalls well enough to be genuinely useful,
 * and it means `npm run dev` needs no key and no network.
 *
 * Swap in a real embedding model by setting EMBEDDING_PROVIDER and implementing
 * the same `embed(text) -> number[]` contract. Vectors are L2-normalised, so
 * cosine similarity is a dot product either way and nothing downstream changes.
 */

export const EMBEDDING_DIM = 256;

/** FNV-1a, 32-bit. Stable across runs and platforms — seeded data stays seeded. */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "is", "are", "was", "were",
  "be", "been", "it", "its", "that", "this", "with", "as", "at", "by", "from", "has", "have",
  "ve", "bir", "bu", "da", "de", "ile", "için", "olan", "olarak", "gibi",
]);

function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Words carry most of the signal; character trigrams make the vector resilient
 * to Turkish suffixes and to singular/plural drift, which whole-word hashing
 * alone handles badly.
 */
function features(text: string): string[] {
  const tokens = tokenize(text);
  const out: string[] = [];
  for (const token of tokens) {
    out.push(`w:${token}`);
    if (token.length > 4) {
      for (let i = 0; i <= token.length - 3; i++) out.push(`t:${token.slice(i, i + 3)}`);
    }
  }
  for (let i = 0; i < tokens.length - 1; i++) out.push(`b:${tokens[i]}_${tokens[i + 1]}`);
  return out;
}

function localEmbed(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const feature of features(text)) {
    const h = hash(feature);
    const index = h % EMBEDDING_DIM;
    // Sign from a different bit of the hash keeps unrelated features from
    // piling up constructively in the same bucket.
    vec[index] += (h & 0x100) === 0 ? 1 : -1;
  }
  return normalize(vec);
}

export function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/** Both vectors are unit length, so this is cosine similarity. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

export type EmbeddingProvider = {
  name: string;
  embed: (text: string) => Promise<number[]>;
};

const local: EmbeddingProvider = {
  name: "local-hashed",
  async embed(text: string) {
    return localEmbed(text);
  },
};

export function getEmbeddingProvider(): EmbeddingProvider {
  // Only one provider ships today. Adding another means adding a branch here
  // and an entry in SETUP_TODO.md — nothing else in the system changes.
  return local;
}

export async function embed(text: string): Promise<number[]> {
  return getEmbeddingProvider().embed(text);
}

/** Synchronous path, for the seed script and tests. */
export function embedSync(text: string): number[] {
  return localEmbed(text);
}
