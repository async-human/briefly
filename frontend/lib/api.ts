import { API_URL, getToken } from "./auth";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(", ")
          : res.statusText;
    throw new ApiError(message || res.statusText, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type User = {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  email_token: string;
  is_verified: boolean;
  created_at: string;
};

export type Profile = {
  role: string | null;
  goal: string | null;
  digest_time: string;
  digest_timezone: string;
  interests: Record<string, unknown>[];
};

export type MeResponse = {
  user: User;
  profile: Profile | null;
  ingestion_email: string;
};

export type DigestItem = {
  id: string;
  position: number;
  section: string | null;
  headline: string;
  summary: string;
  why_it_matters: string;
  source_name: string | null;
  source_url: string | null;
  all_sources: Record<string, unknown>[];
};

export type Digest = {
  id: string;
  digest_date: string;
  status: string;
  subject_line: string | null;
  preview_text: string | null;
  total_items_ingested: number;
  total_items_shown: number;
  created_at: string;
  items: DigestItem[];
};

export type DigestSummary = {
  id: string;
  digest_date: string;
  status: string;
  subject_line: string | null;
  preview_text: string | null;
  total_items_shown: number;
  created_at: string;
};

export type SourceDetection = {
  source_type: string;
  identifier: string;
  label: string;
  hint: string;
  confidence: string;
};

export type Source = {
  id: string;
  source_type: string;
  status: string;
  name: string | null;
  identifier: string;
  last_fetched_at: string | null;
  created_at: string;
};

export const api = {
  getMe: () => request<MeResponse>("/api/v1/me"),
  getLatestDigest: () => request<Digest | null>("/api/v1/digests/latest"),
  getDigests: () => request<DigestSummary[]>("/api/v1/digests"),
  getSources: () => request<Source[]>("/api/v1/sources"),
  detectSource: (body: { identifier: string; source_type?: string }) =>
    request<SourceDetection>("/api/v1/sources/detect", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addSource: (body: { identifier: string; source_type?: string; name?: string }) =>
    request<Source>("/api/v1/sources", { method: "POST", body: JSON.stringify(body) }),
  deleteSource: (id: string) =>
    request<void>(`/api/v1/sources/${id}`, { method: "DELETE" }),
  generateDigest: () =>
    request<Digest>("/api/v1/digests/generate", { method: "POST" }),
};
