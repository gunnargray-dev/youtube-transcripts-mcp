import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURES = join(ROOT, "test", "fixtures");
export const dist = (m) => import(join(ROOT, "dist", m));
export const fixture = (rel) => readFileSync(join(FIXTURES, rel), "utf8");
export const fixtureJson = (rel) => JSON.parse(fixture(rel));

/** Await `p` and return the YouTubeError it rejects with (fails if it resolves). */
export async function rejection(p) {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected promise to reject");
}
