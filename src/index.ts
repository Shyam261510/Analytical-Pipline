import { ReelProcessingService } from "./Services/Reel/ReelProcessService";

const usernames = [
  "piyushgarg.official",
  // "dammit.memona",
  // "happydownloads",
  // "teacher_boo__",
  // "miinoroom",
  // "nikkkihawkes",
  // "itisyawarali",
  // "nrml_mtber",
];
const reelProcessingService = new ReelProcessingService();

await reelProcessingService.scrapeReelCodes(usernames);
// import ollama from "ollama";
// import {
//   SYSTEM_PROMPT,
//   USER_PROMPT,
// } from "./Services/Analysis/BioAnalysis/BioAnalysisPrompt";
// import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// const username = "piyushgarg.official";
// const fullName = "Piyush Garg";
// const bio =
//   "Software Engineer | Tech Content Creator & YouTuber | 400k+ on YouTube | 35k+ X (Twitter) | 110k+ LinkedIn";

// const response = await ollama.chat({
//   model: "gemma4",
//   messages: [
//     { role: "system", content: SYSTEM_PROMPT },
//     { role: "user", content: USER_PROMPT(username, fullName, bio) },
//   ],

//   options: {
//     temperature: 0.3,
//   },
// });
// // const result = response.message.content;
// // await Bun.write("RESPONSE.txt", result);
// const file = Bun.file("RESPONSE.txt");
// const result = await file.text();

// const splitter = new RecursiveCharacterTextSplitter({
//   chunkSize: 500, // The maximum number of characters per chunk
//   chunkOverlap: 50,
// });

// const chunks = await splitter.splitText(result);

// console.log(`CHUNKS -> ${chunks.length}`);

// await Bun.write("CHUKNS.json", JSON.stringify(chunks));
