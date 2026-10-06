export async function create() {
  const { ChatGroq } = await import("@langchain/groq");
  return new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    temperature: 0,
  });
}