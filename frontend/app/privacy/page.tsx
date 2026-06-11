import type { Metadata } from "next";

import { LegalPageShell, type LegalSection } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Privacy Policy — Briefly",
  description: "How Briefly collects, uses, and protects your personal information.",
};

const EFFECTIVE_DATE = "May 28, 2026";

const SECTIONS: LegalSection[] = [
  {
    id: "introduction",
    title: "1. Introduction",
    paragraphs: [
      'Briefly ("Briefly," "we," "us," or "our") respects your privacy. This Privacy Policy explains what personal information we collect, how we use it, who we share it with, and the choices you have when you use our website, applications, and services (the "Service").',
      "This policy applies to information we process as a data controller. When you connect third-party accounts, those providers also process your data under their own policies.",
      "By using the Service, you acknowledge this Privacy Policy. If you do not agree, please do not use the Service.",
    ],
  },
  {
    id: "collect",
    title: "2. Information We Collect",
    subsections: [
      {
        title: "Information you provide",
        list: [
          "Account details: name, email address, profile picture, and authentication identifiers from Google or other sign-in providers",
          "Profile and preferences: role, goals, interests, topics to avoid, digest delivery time and timezone",
          "Connected sources: email senders, RSS URLs, YouTube channels, subreddits, saved links, and Readwise credentials or highlights you authorise",
          "Brain Dumps: text notes and voice recordings you submit (voice is transcribed; audio may be processed transiently)",
          "Communications: support requests and feedback you send us",
        ],
      },
      {
        title: "Information from connected services",
        paragraphs: [
          "When you connect Gmail, YouTube, Reddit, Readwise, RSS, or similar integrations, we access content you authorise—such as newsletter messages, feed items, video metadata and transcripts, posts, and highlights—solely to ingest, deduplicate, summarise, and personalise your briefings.",
          "For Gmail specifically, see our plain-English guide: How Briefly handles your email (/privacy/data-handling). Discovery uses metadata only; full newsletter bodies are fetched only for senders you approve.",
        ],
      },
      {
        title: "Information collected automatically",
        list: [
          "Usage data: pages viewed, features used, briefing opens, item clicks, saves, skips, reading duration, and feedback signals",
          "Device and log data: IP address, browser type, operating system, timestamps, and diagnostic logs",
          "Cookies and similar technologies: session tokens and preferences needed to keep you signed in and remember settings",
        ],
      },
      {
        title: "Inferred information",
        paragraphs: [
          "We generate relevance scores, topic clusters, embeddings, and summaries from your profile and activity to personalise what appears in your briefings. These are derived from the information above, not from unrelated third-party data brokers.",
        ],
      },
    ],
  },
  {
    id: "use",
    title: "3. How We Use Information",
    paragraphs: ["We use personal information to:"],
    list: [
      "Provide, maintain, and improve the Service, including daily briefings and Brain Dump processing",
      "Authenticate you and secure accounts",
      "Ingest, clean, deduplicate, rank, and summarise content from your connected sources",
      "Personalise recommendations, relevance scoring, and \"why it matters\" explanations",
      "Send digest emails and in-app notifications you request",
      "Monitor performance, debug issues, prevent fraud and abuse",
      "Comply with legal obligations and enforce our Terms of Service",
      "Communicate about product updates, security notices, and support (you may opt out of non-essential marketing emails)",
    ],
  },
  {
    id: "legal-bases",
    title: "4. Legal Bases for Processing (EEA, UK, and Similar Regions)",
    paragraphs: ["Where GDPR or similar laws apply, we rely on:"],
    list: [
      "Contract: processing necessary to provide the Service you requested",
      "Legitimate interests: securing the Service, improving features, and personalisation in ways that do not override your rights",
      "Consent: where required for optional integrations, marketing, or non-essential cookies",
      "Legal obligation: when we must retain or disclose information under law",
    ],
  },
  {
    id: "sharing",
    title: "5. How We Share Information",
    paragraphs: [
      "We do not sell your personal information. We share information only as described below:",
    ],
    list: [
      "Service providers (subprocessors): cloud hosting, databases, email delivery, analytics, and AI/speech providers that process data on our behalf under contractual confidentiality and security obligations",
      "Identity and content providers: Google, Reddit, and other platforms when you choose to connect them—governed by their policies",
      "Legal and safety: when required by law, court order, or to protect rights, safety, and integrity of users and the Service",
      "Business transfers: in connection with a merger, acquisition, or asset sale, subject to continued protection consistent with this policy",
    ],
    afterList: [
      "Typical subprocessors include infrastructure hosts, LLM and embedding providers (such as OpenAI, Anthropic, Groq, and Voyage AI, depending on configuration), speech-to-text services, and email delivery providers (such as Resend). We may update subprocessors and will maintain reasonable safeguards.",
    ],
  },
  {
    id: "ai-processing",
    title: "6. AI and Automated Processing",
    paragraphs: [
      "Briefly uses automated systems to transcribe voice notes, structure Brain Dumps, summarise articles, score relevance, and write briefing content. Prompts may include excerpts from your profile, connected content, and recent activity.",
      "We configure providers not to use your content to train their public models where such opt-outs or enterprise terms are available. Outputs are generated algorithmically and should be reviewed for accuracy.",
    ],
  },
  {
    id: "retention",
    title: "7. Data Retention",
    paragraphs: [
      "We retain information while your account is active and as needed to provide the Service. Ingested content may be kept to power memory, deduplication, and cross-referencing features described in the product.",
      "When you delete your account or request deletion, we will delete or anonymise personal information within a reasonable period, except where retention is required for legal, security, or backup purposes. Backups may persist for a limited time before cycling out.",
    ],
  },
  {
    id: "security",
    title: "8. Security",
    paragraphs: [
      "We implement administrative, technical, and organisational measures designed to protect personal information, including encryption in transit, access controls, and monitoring. No method of transmission or storage is completely secure; we cannot guarantee absolute security.",
      "You are responsible for safeguarding your account credentials and reviewing permissions on connected third-party accounts.",
    ],
  },
  {
    id: "rights",
    title: "9. Your Rights and Choices",
    paragraphs: ["Depending on your location, you may have the right to:"],
    list: [
      "Access, correct, or delete personal information we hold about you",
      "Export your data in a portable format where technically feasible",
      "Object to or restrict certain processing, including personalised profiling where applicable",
      "Withdraw consent for processing that relies on consent",
      "Disconnect third-party integrations at any time from Settings or the relevant provider",
      "Opt out of marketing emails via unsubscribe links",
    ],
    afterList: [
      "California residents may have additional rights under the CCPA/CPRA, including knowing categories of data collected and requesting deletion, subject to exceptions.",
      "EEA and UK users may lodge a complaint with a supervisory authority. To exercise rights, contact privacy@briefly.app. We may verify your identity before responding.",
    ],
  },
  {
    id: "international",
    title: "10. International Transfers",
    paragraphs: [
      "We may process and store information in the United States and other countries where we or our service providers operate. These countries may have different data protection laws than your own.",
      "Where required, we use appropriate safeguards such as Standard Contractual Clauses or equivalent mechanisms for cross-border transfers.",
    ],
  },
  {
    id: "children",
    title: "11. Children's Privacy",
    paragraphs: [
      "The Service is not directed to children under 16. We do not knowingly collect personal information from children. If you believe a child has provided us data, contact privacy@briefly.app and we will delete it.",
    ],
  },
  {
    id: "third-party",
    title: "12. Third-Party Links and Services",
    paragraphs: [
      "The Service may link to external sites or embed third-party content. Their privacy practices are governed by their own policies. Review permissions carefully when connecting Google, Reddit, YouTube, Readwise, or other accounts.",
    ],
  },
  {
    id: "changes",
    title: "13. Changes to This Policy",
    paragraphs: [
      "We may update this Privacy Policy periodically. We will post the revised policy with a new effective date and provide additional notice for material changes where required by law.",
    ],
  },
  {
    id: "contact",
    title: "14. Contact Us",
    paragraphs: [
      "Privacy inquiries and data subject requests: privacy@briefly.app",
      "General legal questions: legal@briefly.app",
      "If you are an EEA/UK user and wish to contact our representative where appointed, include your country in your request and we will provide applicable contact details.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      effectiveDate={EFFECTIVE_DATE}
      intro="This policy describes how Briefly handles your personal information when you use our personalised briefing service."
      sections={SECTIONS}
    />
  );
}
