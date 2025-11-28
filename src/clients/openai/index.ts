import OpenAI from "openai";
import { getBaseClient } from "../utils/baseClient";

const OPENAI_KEY_ENV = "OPENAI_API_KEY";
const missingKeyMessage =
  `${OPENAI_KEY_ENV} is not set. ` +
  "Set the environment variable to enable LLM-powered suggestions, or supply `useDeterministic: true`.";

const resolveApiKey = (): string | undefined => process.env[OPENAI_KEY_ENV];

const createClient = (): OpenAI | null => {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return null;
  }
  return new OpenAI({ apiKey });
};

const client = createClient();

export const openAIClient = client;

export const ensureOpenAIClient = (): OpenAI => {
  if (!openAIClient) {
    throw new Error(missingKeyMessage);
  }
  return openAIClient;
};

export const openai = (
  { apiKey }: { apiKey?: string } = {}
) => {
  const resolvedKey = apiKey ?? resolveApiKey();
  if (!resolvedKey) {
    throw new Error(missingKeyMessage);
  }
  return getBaseClient({
    baseURL: "https://eu.api.openai.com/v1",
    headers: {
      Authorization: `Bearer ${resolvedKey}`,
      "Content-Type": "application/json",
    },
  });
};
