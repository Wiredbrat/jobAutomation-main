import "dotenv/config";
import { registry } from "./data/registry.js";

/**
 * Reads LLM_PROVIDERS from .env as an ordered, comma-separated priority list,
 * e.g. "groq,gemini,ollama" — first is tried first, later ones are fallbacks.
 */
function getProviderOrder() {
  const list = process.env.LLM_PROVIDERS || process.env.LLM_PROVIDER || "groq";
  const names = list
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const unknown = names.filter((n) => !registry[n]);
  if (unknown.length) {
    throw new Error(
      `Unknown LLM provider(s): ${unknown.join(", ")}. Available: ${Object.keys(registry).join(", ")}`
    );
  }
  return names;
}

async function buildModels() {
  const names = getProviderOrder();
  const models = await Promise.all(names.map((name) => registry[name].create()));
  return names.map((name, i) => ({ name, model: models[i] }));
}

// How long a single provider gets before we give up and move to the next
// one — this is what makes fallback trigger on a SLOW provider, not just a
// broken one. withFallbacks() alone only reacts to thrown errors.
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 15000);

function invokeWithTimeout(runnable, input, ms) {
  return Promise.race([
    runnable.invoke(input),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Builds a chain from `entries` (each { name, runnable }) and returns a
 * single object with an .invoke() that tries them in order, moving to the
 * next entry on either a thrown error OR a timeout. Both getChatModel and
 * getStructuredModel below are thin wrappers around this — same shared
 * fallback/timeout/logging logic either way.
 */
function withTimeoutFallback(entries) {
  return {
    async invoke(input) {
      let lastErr;
      for (const { name, runnable } of entries) {
        const started = Date.now();
        try {
          const result = await invokeWithTimeout(runnable, input, TIMEOUT_MS);
          const ms = Date.now() - started;
          if (entries.length > 1) console.log(`[llm] ${name} answered in ${ms}ms`);
          return result;
        } catch (err) {
          lastErr = err;
          console.warn(`[llm] ${name} failed after ${Date.now() - started}ms: ${err.message}`);
        }
      }
      throw new Error(`All LLM providers failed. Last error: ${lastErr?.message}`);
    },
  };
}

/**
 * Returns an object with .invoke(input) that tries providers in priority
 * order, timing out and falling through to the next one if a provider is
 * either erroring or just too slow.
 */
export async function getChatModel() {
  const models = await buildModels();
  return withTimeoutFallback(models.map((m) => ({ name: m.name, runnable: m.model })));
}

/**
 * Same as getChatModel, but every provider is wrapped with
 * withStructuredOutput(schema) first, so whichever one answers, you get
 * back the same parsed shape.
 */
export async function getStructuredModel(schema) {
  const models = await buildModels();
  return withTimeoutFallback(
    models.map((m) => ({ name: m.name, runnable: m.model.withStructuredOutput(schema) }))
  );
}

export { registry };
