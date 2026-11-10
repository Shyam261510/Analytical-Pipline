import { GoogleGenAI } from "@google/genai";

export class GeminiProvider {
  private static instance: GeminiProvider | null = null;

  private geminiClient: GoogleGenAI;

  private constructor() {
    this.geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY!,
    });
  }

  public static getInstance(): GeminiProvider {
    if (!GeminiProvider.instance) {
      GeminiProvider.instance = new GeminiProvider();
    }
    return GeminiProvider.instance;
  }

  public get client(): GoogleGenAI {
    return this.geminiClient;
  }

  /** Single-turn text generation. Throws on an empty reply so the calling job retries. */
  public async generateText(
    prompt: string,
    systemInstruction: string,
    model = "gemini-3.8-flash",
  ): Promise<string> {
    const response = await this.client.models.generateContent({
      model,
      contents: prompt,
      config: { systemInstruction, temperature: 0.3 },
    });
    const text = response.text?.trim();
    if (!text) throw new Error(`Gemini (${model}) returned an empty response`);
    return text;
  }

  public async generateEmbedding(text: string) {
    const response = await this.client.models.embedContent({
      model: "gemini-embedding-2",
      contents: text,
    });
    return response.embeddings;
  }
}
