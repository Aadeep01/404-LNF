type TranslationInput = {
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
  context?: string;
};

const apiKey = () => process.env.GROQ_API_KEY?.trim();
const model = () => process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b";
const baseUrl = () => (process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/$/, "");

function mockTranslation(input: TranslationInput) {
  return `[${input.targetLanguage}] ${input.sourceText}`;
}

export function translationMode() {
  return apiKey() ? "groq" : "mock";
}

export async function translateText(input: TranslationInput) {
  if (!apiKey()) return { text: mockTranslation(input), mode: "mock" as const };

  const response = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({
      model: model(),
      temperature: 0.2,
      max_completion_tokens: 2048,
      messages: [
        {
          role: "system",
          content: "You are a professional website translator. Return only the translated text. Preserve URLs, HTML-like placeholders, product names, numbers, and variables exactly. Do not add explanations or quotation marks.",
        },
        {
          role: "user",
          content: `Translate from ${input.sourceLanguage} to ${input.targetLanguage}.\nContext: ${input.context || "Website content"}\nSource:\n${input.sourceText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Groq request failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned an empty translation");
  return { text, mode: "groq" as const };
}
