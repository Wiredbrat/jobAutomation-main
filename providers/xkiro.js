export async function create() {
  const { ChatOpenAI } = await import("@langchain/openai");

  return new ChatOpenAI({
    apiKey: process.env.XKIRO_API_KEY,
    model:
      process.env.XKIRO_MODEL ||
      "sensenova/sensenova-6.8-flash-lite",
    temperature: 1,
    configuration: {
      baseURL: process.env.XKIRO_BASE_URL,
    },
  });
}