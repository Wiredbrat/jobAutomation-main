export async function create() {
  const { ChatNVIDIA } = await import("@langchain/nvidia-ai-endpoints");

  return new ChatNVIDIA({
    model: "deepseek-ai/deepseek-v4-flash-0731",
    apiKey: process.env.NVIDIA_API_KEY,
    temperature: 1,
    topP: 0.95,
    // maxTokens: 16384,
  });
}