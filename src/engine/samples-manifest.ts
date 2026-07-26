/**
 * Canonical sample-library metadata — single source of truth, served to the
 * client via GET /api/samples (see web.ts). Token counts are measured in the
 * background through the real convert pipeline (fullMarkdown) and attached as
 * `tok` once ready. The catalog endpoint itself must stay fast — it must not
 * await conversion of every sample on the request path.
 *
 * Suggested questions are checked against the *converted* sample text so
 * Prove / Agent demos don't ask for plot that an abridged file never contains.
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
  {
    key: "pp",
    file: "pride-and-prejudice.docx",
    fmt: "docx",
    nm: "Pride and Prejudice",
    mt: "Jane Austen · novel (early chapters)",
    q: [
      "What does Mr. Darcy say about Elizabeth at the Meryton assembly?",
      "Why do people at the assembly think Darcy is proud?",
      "What does Mr. Bingley think of Jane Bennet early on?",
      "Why does Jane stay on at Netherfield after falling ill?",
      "What does Darcy say about Elizabeth at the assembly, and why do others find him proud?",
    ],
  },
  {
    key: "sh",
    file: "sherlock-holmes.docx",
    fmt: "docx",
    nm: "The Adventures of Sherlock Holmes",
    mt: "Arthur Conan Doyle · mystery (partial text)",
    q: [
      "Why does the King of Bohemia come to Sherlock Holmes?",
      "Who is Irene Adler, and why does the photograph matter?",
      "What is the Red-Headed League?",
      "Who is Vincent Spaulding, and what does he tell Jabez Wilson about the League?",
      "What salary does the Red-Headed League offer, and what hours must Wilson keep?",
    ],
  },
  {
    key: "og",
    file: "origin-of-species.pdf",
    fmt: "pdf",
    nm: "On the Origin of Species",
    mt: "Charles Darwin · dense science PDF",
    q: [
      "What is natural selection?",
      "What does Darwin say about the struggle for existence?",
      "How does Darwin explain variation under domestication?",
      "What is natural selection, and what does Darwin say about the struggle for existence?",
    ],
  },
  {
    key: "ar",
    file: "meridian-annual-report.docx",
    fmt: "docx",
    nm: "Meridian Annual Report",
    mt: "business report · tables + prose",
    q: [
      "What are the three risks management worries about?",
      "What mistake did the company admit this year?",
      "Which R&D programs were cancelled and why?",
      "What revenue guidance does Meridian give for FY 2026?",
      "What are the three risks, and which R&D programs were cancelled?",
    ],
  },
  {
    key: "km",
    file: "kestrel-k2-manual.pdf",
    fmt: "pdf",
    nm: "Kestrel K2 Drone Manual",
    mt: "user manual PDF",
    q: [
      "What does the K2 warranty not cover?",
      "Can the drone fly in rain?",
      "How should batteries be handled for air travel?",
      "Why do the forward obstacle sensors struggle at night?",
      "What does the warranty not cover, and can the drone fly in rain?",
    ],
  },
  {
    key: "fin",
    file: "meridian-financials.xlsx",
    fmt: "xlsx",
    nm: "Meridian Financials",
    mt: "spreadsheet · 3 sheets",
    q: [
      "What was net profit in FY25?",
      "Which quarter had the best gross margin?",
      "How did revenue change from FY21 to FY25?",
      "What was net profit in FY25, and which quarter had the best gross margin?",
    ],
  },
  {
    key: "lt",
    file: "the-lantern-tales.md",
    fmt: "md",
    nm: "The Lantern Tales",
    mt: "24 short fables",
    q: [
      "What three promises did the fox collect as payment for winter?",
      "How did Lina win her shadow back?",
      "What did the ferryman charge instead of coins?",
      "What was the house rule at the night market of lost things?",
      "What did the ferryman charge, and what was the rule at the night market?",
    ],
  },
  {
    key: "hi",
    file: "chhoti-kahaniyan.md",
    fmt: "md",
    nm: "छोटी कहानियाँ",
    mt: "Hindi · Devanagari · 12 stories",
    q: [
      "ईमानदार चायवाले को अंगूठी लौटाने पर क्या मिला?",
      "आम का पेड़ बँटवारे में किसके हिस्से आया?",
      "गणित की परीक्षा का आख़िरी सवाल क्या था?",
      "ईमानदार चायवाले को क्या मिला, और आम का पेड़ किसके हिस्से आया?",
    ],
  },
  {
    key: "es",
    file: "cuentos-breves.md",
    fmt: "md",
    nm: "Cuentos breves",
    mt: "Spanish · Latin + accents · 8 tales",
    q: [
      "¿Qué encontró el panadero escondido en la harina?",
      "¿Qué pregunta puso la maestra en su último examen?",
      "¿Por qué el farero mantenía encendida la lámpara?",
      "¿Qué encontró el panadero, y qué preguntaba el último examen de la maestra?",
    ],
  },
  {
    key: "ru",
    file: "korotkie-rasskazy.md",
    fmt: "md",
    nm: "Короткие рассказы",
    mt: "Russian · Cyrillic · 8 tales",
    q: [
      "Что нашёл извозчик в санях?",
      "Какой вопрос был на последнем экзамене учительницы?",
      "Почему смотритель маяка держал огонь?",
      "Что нашёл извозчик, и какой вопрос был на последнем экзамене?",
    ],
  },
  {
    key: "hq",
    file: "hikayat-qasira.md",
    fmt: "md",
    nm: "حكايات قصيرة",
    mt: "Arabic · right-to-left · 8 tales",
    q: [
      "ماذا وجد الخبّاز مخبّأً في كيس الطحين؟",
      "ما السؤال الذي طرحته المعلّمة في امتحانها الأخير؟",
      "لماذا أبقى حارس المنارة المصباح مضيئًا؟",
      "ماذا وجد الخبّاز، وما السؤال في امتحان المعلّمة الأخير؟",
    ],
  },
  {
    key: "pd",
    file: "meridian-pitch-deck.pptx",
    fmt: "pptx",
    nm: "Meridian Series B Pitch Deck",
    mt: "15-slide pitch deck",
    q: [
      "What is the total addressable market?",
      "How much is Meridian raising in Series B, and how is it allocated?",
      "What risks does the deck call out?",
      "How many units are deployed, and how many of the largest delivery operators are paying customers?",
      "What is the total addressable market, and what risks does the deck list?",
    ],
  },
];
