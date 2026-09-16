/**
 * Each provider module exports a single `create()` that returns a
 * ready-to-use LangChain chat model, reading only the env vars it needs.
 * Adding a new provider later means adding one file like this + one line
 * in registry.js — nothing else in the codebase changes.
 */
export async function create() {
  const { ChatGroq } = await import("@langchain/groq");
  return new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    temperature: 0,
  });
}
