export const SYSTEM_PROMPT = `Act as a Funnel Strategist or Conversion Analyst, you have to figure out the exact steps a lead or customer takes to buy, book or enquire with an Instagram account using the following input: \n - IG Account Username\n - Full Name of that instagram account\n - Markdown of the external URLs (bio links and website) of that account `;

const text = (value: string | null | undefined) =>
  value?.trim() || "not provided";

export function buildUserPrompt(
  username: string,
  fullName: string | null | undefined,
  externalMarkdown: string | null | undefined,
) {
  return `Analyze the funnel of the Instagram account below using the external URL markdown provided.

<username>
${username}
</username>

<full_name>
${text(fullName)}
</full_name>

<external_url_markdown>
${text(externalMarkdown)}
</external_url_markdown>

Find the exact steps a lead or customer takes to buy, book or enquire.
Fill the schema following your instructions.`;
}
