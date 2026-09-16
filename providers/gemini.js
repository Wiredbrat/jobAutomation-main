export async function create() {
  const { ChatGoogleGenerativeAI } = await import("@langchain/google-genai");
  return new ChatGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    temperature: 0,
  });
}
