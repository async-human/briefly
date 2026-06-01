import type { Metadata } from "next";

import { LegalPageShell, type LegalSection } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "Terms of Service — Briefly",
  description: "Terms of Service for Briefly, the personalised daily briefing service.",
};

const EFFECTIVE_DATE = "May 28, 2026";

const SECTIONS: LegalSection[] = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    paragraphs: [
      'These Terms of Service ("Terms") govern your access to and use of the Briefly website, applications, and related services (collectively, the "Service") operated by Briefly ("Briefly," "we," "us," or "our").',
      "By creating an account, connecting a third-party service, or otherwise using the Service, you agree to be bound by these Terms and our Privacy Policy. If you do not agree, do not use the Service.",
      "If you use the Service on behalf of an organisation, you represent that you have authority to bind that organisation to these Terms.",
    ],
  },
  {
    id: "description",
    title: "2. Description of the Service",
    paragraphs: [
      "Briefly is a personalised information digest service. We connect to sources you authorise (such as email, RSS feeds, YouTube, Reddit, and similar integrations), ingest and process content, and generate daily briefings tailored to your stated interests and usage patterns.",
      "The Service may also allow you to submit text or voice notes (\"Brain Dumps\"), receive source suggestions, and interact with generated summaries. Features may change, expand, or be discontinued at our discretion.",
      "Briefly uses automated systems, including artificial intelligence and machine learning, to summarise, rank, and personalise content. Outputs may contain errors or omissions. You are responsible for verifying important information before relying on it.",
    ],
  },
  {
    id: "eligibility",
    title: "3. Eligibility",
    paragraphs: [
      "You must be at least 16 years old (or the minimum age required in your jurisdiction to consent to data processing) to use the Service. If you are under 18, you may use the Service only with involvement of a parent or guardian.",
      "You must provide accurate registration information and keep your account credentials secure. You are responsible for all activity under your account.",
    ],
  },
  {
    id: "account",
    title: "4. Account Registration and Authentication",
    paragraphs: [
      "You may sign in using Google OAuth or other authentication methods we support. By doing so, you authorise us to receive basic profile information (such as name, email address, and profile picture) from your identity provider.",
      "You agree not to share access tokens, impersonate others, create accounts through unauthorised means, or use the Service in violation of applicable law or third-party terms.",
    ],
  },
  {
    id: "connected-accounts",
    title: "5. Connected Accounts and User Content",
    paragraphs: [
      "When you connect third-party accounts or add sources, you grant Briefly permission to access, retrieve, store, and process content from those sources solely to provide the Service. This may include newsletters, feeds, transcripts, posts, highlights, links you submit, and voice or text you provide.",
      "You retain ownership of content you submit or that originates from your connected accounts. You grant Briefly a worldwide, non-exclusive, royalty-free licence to use, reproduce, process, adapt, and display that content as necessary to operate, improve, and secure the Service, including through subprocessors described in our Privacy Policy.",
      "You represent that you have the right to connect each source and that doing so does not violate any agreement or law. Briefly is not responsible for content provided by third parties.",
    ],
  },
  {
    id: "acceptable-use",
    title: "6. Acceptable Use",
    paragraphs: ["You agree not to:"],
    list: [
      "Use the Service for unlawful, harmful, fraudulent, or abusive purposes",
      "Attempt to gain unauthorised access to systems, accounts, or data",
      "Reverse engineer, scrape, or overload the Service except as permitted by law",
      "Upload malware, spam, or content that infringes intellectual property or privacy rights",
      "Use the Service to build a competing product using non-public aspects of Briefly",
      "Circumvent rate limits, security measures, or usage restrictions",
    ],
    afterList: [
      "We may investigate violations and suspend or terminate access without prior notice where appropriate.",
    ],
  },
  {
    id: "subscriptions",
    title: "7. Plans, Billing, and Free Tier",
    paragraphs: [
      "Briefly may offer free and paid plans. Pricing, features, and limits are described on our website and may change with reasonable notice for future billing periods.",
      "Paid subscriptions, if offered, renew automatically unless cancelled before the renewal date. Taxes may apply. Refunds are handled according to the policy displayed at purchase, except where required by law.",
      "We may modify or discontinue any plan or feature. If we materially reduce paid features you rely on, we will provide notice where commercially reasonable.",
    ],
  },
  {
    id: "intellectual-property",
    title: "8. Intellectual Property",
    paragraphs: [
      "Briefly and its logos, software, design, and documentation are owned by Briefly or its licensors and protected by intellectual property laws. Except for the limited rights expressly granted, no licence is conveyed.",
      "Feedback you provide may be used by Briefly without restriction or compensation.",
    ],
  },
  {
    id: "ai-disclaimer",
    title: "9. AI-Generated Content",
    paragraphs: [
      "Summaries, rankings, \"why it matters\" explanations, and other outputs are generated automatically and may be incomplete, inaccurate, or outdated. They do not constitute professional, legal, financial, medical, or other advice.",
      "You should review source materials for critical decisions. Briefly does not guarantee that ingested content is complete or that citations cover every claim.",
    ],
  },
  {
    id: "termination",
    title: "10. Suspension and Termination",
    paragraphs: [
      "You may stop using the Service at any time and may request account deletion by contacting us. Upon termination, your right to access the Service ends.",
      "We may suspend or terminate your account if you breach these Terms, create risk or legal exposure, or where required by law. Provisions that by nature should survive (including disclaimers, limitations of liability, and dispute terms) will survive termination.",
    ],
  },
  {
    id: "disclaimers",
    title: "11. Disclaimers",
    paragraphs: [
      'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.',
      "We do not warrant that the Service will be uninterrupted, secure, error-free, or that content will meet your expectations. Third-party services and content are provided by others and are subject to their own terms.",
    ],
  },
  {
    id: "liability",
    title: "12. Limitation of Liability",
    paragraphs: [
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, BRIEFLY AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AND SUPPLIERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR BUSINESS OPPORTUNITY, ARISING FROM YOUR USE OF THE SERVICE.",
      "OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID BRIEFLY IN THE TWELVE MONTHS BEFORE THE CLAIM OR (B) ONE HUNDRED US DOLLARS (US $100).",
      "Some jurisdictions do not allow certain limitations; in those cases, our liability is limited to the fullest extent permitted by law.",
    ],
  },
  {
    id: "indemnification",
    title: "13. Indemnification",
    paragraphs: [
      "You agree to indemnify and hold harmless Briefly from claims, damages, losses, and expenses (including reasonable legal fees) arising from your use of the Service, your content, your connected accounts, or your violation of these Terms or applicable law.",
    ],
  },
  {
    id: "disputes",
    title: "14. Governing Law and Disputes",
    paragraphs: [
      "These Terms are governed by the laws of the State of Delaware, United States, excluding conflict-of-law rules, except where mandatory consumer protection laws in your country of residence apply.",
      "Before filing a claim, you agree to contact us at legal@briefly.app to attempt informal resolution. If a dispute is not resolved within 30 days, either party may pursue remedies in the courts of Delaware or, where permitted, through binding arbitration under the rules of a recognised arbitration provider.",
      "You may bring claims in your local courts if required by mandatory law. Class actions are waived to the extent permitted by law.",
    ],
  },
  {
    id: "changes",
    title: "15. Changes to These Terms",
    paragraphs: [
      "We may update these Terms from time to time. We will post the revised version with a new effective date and, for material changes, provide notice by email or in-product notification where appropriate.",
      "Continued use after changes become effective constitutes acceptance. If you do not agree, you must stop using the Service.",
    ],
  },
  {
    id: "contact",
    title: "16. Contact",
    paragraphs: [
      "Questions about these Terms: legal@briefly.app",
      "Privacy-related requests: privacy@briefly.app",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPageShell
      title="Terms of Service"
      effectiveDate={EFFECTIVE_DATE}
      intro="Please read these Terms carefully. They explain your rights and responsibilities when using Briefly."
      sections={SECTIONS}
    />
  );
}
