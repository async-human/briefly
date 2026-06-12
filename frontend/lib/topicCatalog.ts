/** Shared topic options for settings and onboarding. */

export type TopicCategory = {
  id: string;
  label: string;
  hint: string;
  topics: string[];
};

export const MAX_TRACKED_TOPICS = 15;

export function normalizeTopic(raw: string): string {
  return raw.trim().toLowerCase().replace(/,+$/, "");
}

export const ROLE_STARTER_PACKS: Record<string, { label: string; topics: string[] }> = {
  Founder: {
    label: "Founder essentials",
    topics: [
      "product-market fit",
      "startup funding",
      "go-to-market",
      "hiring",
      "growth metrics",
      "AI tools",
      "competitive strategy",
      "founder psychology",
    ],
  },
  "Product manager": {
    label: "Product manager essentials",
    topics: [
      "product strategy",
      "user research",
      "roadmapping",
      "product analytics",
      "AI/ML products",
      "growth",
      "B2B SaaS",
      "experimentation",
    ],
  },
  Engineer: {
    label: "Engineer essentials",
    topics: [
      "system design",
      "AI/ML",
      "developer tools",
      "open source",
      "security",
      "cloud infrastructure",
      "software architecture",
      "LLM engineering",
    ],
  },
  Investor: {
    label: "Investor essentials",
    topics: [
      "deal flow",
      "market trends",
      "valuations",
      "exits",
      "emerging tech",
      "venture capital",
      "AI startups",
      "macro trends",
    ],
  },
  Researcher: {
    label: "Researcher essentials",
    topics: [
      "academic papers",
      "research methods",
      "data science",
      "AI safety",
      "scientific publishing",
      "statistics",
      "policy research",
      "reproducibility",
    ],
  },
  Other: {
    label: "General essentials",
    topics: [
      "technology",
      "business",
      "science",
      "design",
      "policy",
      "AI tools",
      "productivity",
      "culture",
    ],
  },
};

export const TOPIC_CATALOG: TopicCategory[] = [
  {
    id: "ai",
    label: "AI & ML",
    hint: "Models, agents, and applied intelligence",
    topics: [
      "generative AI",
      "AI agents",
      "LLMs",
      "machine learning",
      "AI safety",
      "computer vision",
      "NLP",
      "reinforcement learning",
      "AI regulation",
      "context engineering",
      "multi-agent systems",
      "AI infrastructure",
    ],
  },
  {
    id: "startups",
    label: "Startups & business",
    hint: "Building, funding, and scaling",
    topics: [
      "startup funding",
      "product-market fit",
      "go-to-market",
      "B2B SaaS",
      "venture capital",
      "bootstrapping",
      "competitive strategy",
      "pricing strategy",
      "customer discovery",
      "founder psychology",
      "hiring",
      "remote work",
    ],
  },
  {
    id: "product",
    label: "Product & design",
    hint: "Discovery, UX, and delivery",
    topics: [
      "product strategy",
      "user research",
      "UX design",
      "product analytics",
      "roadmapping",
      "design systems",
      "experimentation",
      "growth",
      "onboarding",
      "product-led growth",
      "accessibility",
      "service design",
    ],
  },
  {
    id: "engineering",
    label: "Engineering & dev",
    hint: "Systems, tools, and craft",
    topics: [
      "system design",
      "software architecture",
      "developer tools",
      "open source",
      "cloud infrastructure",
      "DevOps",
      "security",
      "databases",
      "API design",
      "mobile development",
      "web performance",
      "LLM engineering",
    ],
  },
  {
    id: "markets",
    label: "Markets & investing",
    hint: "Capital, trends, and macro",
    topics: [
      "public markets",
      "venture capital",
      "private equity",
      "macro trends",
      "valuations",
      "deal flow",
      "exits",
      "fintech",
      "crypto policy",
      "interest rates",
      "IPO market",
      "emerging markets",
    ],
  },
  {
    id: "science",
    label: "Science & research",
    hint: "Discovery, methods, and evidence",
    topics: [
      "academic papers",
      "data science",
      "biology",
      "physics",
      "climate science",
      "neuroscience",
      "research methods",
      "scientific publishing",
      "statistics",
      "materials science",
      "space exploration",
      "biotech",
    ],
  },
  {
    id: "policy",
    label: "Policy & society",
    hint: "Regulation, institutions, and culture",
    topics: [
      "tech policy",
      "privacy regulation",
      "antitrust",
      "geopolitics",
      "education policy",
      "healthcare policy",
      "labor markets",
      "media",
      "urban planning",
      "energy transition",
      "democracy",
      "ethics",
    ],
  },
  {
    id: "career",
    label: "Career & leadership",
    hint: "How you work and lead",
    topics: [
      "leadership",
      "management",
      "writing",
      "public speaking",
      "personal productivity",
      "decision making",
      "negotiation",
      "networking",
      "mental models",
      "coaching",
      "org design",
      "work-life balance",
    ],
  },
];

/** Flat list of every catalog topic (deduped). */
export function allCatalogTopics(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cat of TOPIC_CATALOG) {
    for (const t of cat.topics) {
      const n = normalizeTopic(t);
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

export function filterCatalog(query: string): TopicCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return TOPIC_CATALOG;
  return TOPIC_CATALOG.map((cat) => ({
    ...cat,
    topics: cat.topics.filter(
      (t) => t.toLowerCase().includes(q) || cat.label.toLowerCase().includes(q),
    ),
  })).filter((cat) => cat.topics.length > 0);
}
