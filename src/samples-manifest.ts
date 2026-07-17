/**
 * Canonical sample-library metadata — single source of truth, served to the
 * client via GET /api/samples (see web.ts). Token counts are NOT stored here:
 * they're computed live per request from the actual file, through the same
 * convert+cache pipeline a real compile uses (see fullMarkdown() in
 * pipeline.ts), so they can never drift from reality the way a hardcoded
 * number would if a sample file, the tokenizer, or the chunker ever changes.
 */
export interface SampleMeta {
  key: string;
  file: string;
  fmt: string;
  nm: string;
  mt: string;
  q: string[];
}

export const SAMPLES_MANIFEST: SampleMeta[] = [
  { key: "pp", file: "pride-and-prejudice.docx", fmt: "docx", nm: "Pride and Prejudice", mt: "Jane Austen · novel",
    q: ["What is Mr. Darcy's first impression at the ball?", "How does Mr. Collins propose to Elizabeth?", "What does Mr. Bingley think of Jane?", "Why does Elizabeth dislike Mr. Darcy at first?", "How does Mr. Collins propose to Elizabeth, and how does Darcy propose?"] },
  { key: "sh", file: "sherlock-holmes.docx", fmt: "docx", nm: "The Adventures of Sherlock Holmes", mt: "Arthur Conan Doyle · mystery",
    q: ["Why does the King of Bohemia come to Sherlock Holmes?", "What is the Red-Headed League?", "How does Holmes solve the Red-Headed League case?", "What case involves a stepfather and a typewriter?", "What is the Red-Headed League, and how does Holmes solve it?"] },
  { key: "og", file: "origin-of-species.pdf", fmt: "pdf", nm: "On the Origin of Species", mt: "Charles Darwin · dense science PDF",
    q: ["What is natural selection?", "What does Darwin say about the struggle for existence?", "How does Darwin explain variation under domestication?", "What is natural selection? What does Darwin say about the struggle for existence?"] },
  { key: "ar", file: "meridian-annual-report.docx", fmt: "docx", nm: "Meridian Annual Report", mt: "business report · tables + prose",
    q: ["What are the three risks management worries about?", "What mistake did the company admit this year?", "Which R&D programs were cancelled and why?", "What is the FY2026 revenue guidance?", "What are the three risks, and which R&D programs were cancelled?"] },
  { key: "km", file: "kestrel-k2-manual.pdf", fmt: "pdf", nm: "Kestrel K2 Drone Manual", mt: "user manual PDF",
    q: ["What voids the warranty?", "Which directions can the obstacle sensors not see?", "How should batteries be handled for air travel?", "Can the drone fly in rain?", "What voids the warranty? Can the drone fly in rain?"] },
  { key: "fin", file: "meridian-financials.xlsx", fmt: "xlsx", nm: "Meridian Financials", mt: "spreadsheet · 3 sheets",
    q: ["What was net profit in FY25?", "Which quarter had the best gross margin?", "How did revenue grow over five years?", "What was net profit in FY25? Which quarter had the best gross margin?"] },
  { key: "lt", file: "the-lantern-tales.md", fmt: "md", nm: "The Lantern Tales", mt: "24 short fables",
    q: ["What three promises did the fox collect as payment for winter?", "How did Lina win her shadow back?", "What did the ferryman charge instead of coins?", "What was the rule at the night market of lost things?", "What did the ferryman charge, and what was the rule at the night market?"] },
  { key: "hi", file: "chhoti-kahaniyan.md", fmt: "md", nm: "छोटी कहानियाँ", mt: "Hindi · 12 stories (Unicode)",
    q: ["ईमानदार चायवाले को अंगूठी लौटाने पर क्या मिला?", "आम का पेड़ बँटवारे में किसके हिस्से आया?", "गणित की परीक्षा का आख़िरी सवाल क्या था?", "ईमानदार चायवाले को क्या मिला? आम का पेड़ किसके हिस्से आया?"] },
  { key: "pd", file: "meridian-pitch-deck.pptx", fmt: "pptx", nm: "Meridian Series B Pitch Deck", mt: "15-slide pitch deck",
    q: ["What is the total addressable market?", "How much funding is Meridian raising, and what is it for?", "What are the biggest risks to the business?", "Which delivery operators are already paying customers?", "What is the total addressable market, and what are the biggest risks?"] },
];
