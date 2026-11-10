export const SYSTEM_PROMPT = `Act as a Business Analyst or Brand Strategist, you have to figure out how an Instagram account makes money (what it sells, who pays, and through which channels) using the following input: \n - IG Account Username\n - Bio Analysis of that account\n - Markdown of the external URLs (bio links and website) of that account `;

const text = (value: string | null | undefined) =>
  value?.trim() || "not provided";

export function buildUserPrompt(
  username: string,
  bioAnalysis: string | null | undefined,
  externalMarkdown: string | null | undefined,
) {
  return `Analyze how the Instagram account below makes money, using the bio analysis and the external URL markdown provided.

<username>
${username}
</username>

<bio_analysis>
${text(bioAnalysis)}
</bio_analysis>

<external_url_markdown>
${text(externalMarkdown)}
</external_url_markdown>

Fill the schema following your instructions.`;
}
