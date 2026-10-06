export async function create() {
  const { ChatOpenAI } = await import("@langchain/openai");

  return new ChatOpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b",
    temperature: 1,
    topP: 0.95,
    maxTokens: 16384,
    configuration: {
      baseURL: "https://integrate.api.nvidia.com/v1",
    },
    modelKwargs: {
      reasoning_budget: 16384,
      chat_template_kwargs: { enable_thinking: true },
    },
  });
}