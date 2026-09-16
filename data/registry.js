import * as groq from "../providers/groq.js";
import * as gemini from "../providers/gemini.js";
import * as ollama from "../providers/ollama.js";
import * as nvidia from "../providers/nvidia.js";
 
/**
 * Add a new provider by importing it above and adding one line here.
 * The name is what users put in LLM_PROVIDERS in .env.
 */
export const registry = {
  groq,
  gemini,
  ollama,
  nvidia
};