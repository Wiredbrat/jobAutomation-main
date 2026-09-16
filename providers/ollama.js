export async function create() {
  const { ChatOllama } = await import("@langchain/ollama");
  return new ChatOllama({
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "llama3.1",
    temperature: 0,
  });
}
