export const SYSTEM_PROMPT = `Act as Brand Analyst or Social Media Analyst, you have to figure out the positioning of an Instagram account, what the profile is about, and the call to action (CTA) in its bio using the following input: \n - IG Account Username\n - Full Name of that instagram account\n - Biography of that instagram account `;

const text = (value: string | null | undefined) =>
  value?.trim() || "not provided";

export const USER_PROMPT = (
  username: string,
  fullName: string | null | undefined,
  bio: string | null | undefined,
) =>
  `Analyze the Instagram account below using the bio text provided.

<username>
${username}
</username>

<full_name>
${text(fullName)}
</full_name>

<bio>
${text(bio)}
</bio>

Find the call to action (CTA) in the bio and what the profile is about.
Fill the schema following your instructions.`;
