"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getToken } from "@/lib/auth";

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (
          extensionId: string,
          message: unknown,
          callback?: (response: unknown) => void,
        ) => void;
        lastError?: { message?: string };
      };
    };
  }
}

function ConnectHandler() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [message, setMessage] = useState("Connecting extension to your Briefly account…");

  useEffect(() => {
    const extId = searchParams.get("ext");
    const token = getToken();

    if (!extId) {
      setStatus("error");
      setMessage("Missing extension ID. Open this page from the Briefly extension.");
      return;
    }

    if (!token) {
      setStatus("error");
      setMessage("You're not signed in. Log in to Briefly first, then try again.");
      return;
    }

    if (typeof window.chrome === "undefined" || !window.chrome.runtime?.sendMessage) {
      setStatus("error");
      setMessage(
        "Could not reach the extension. Make sure the Briefly extension is installed and this site is allowed.",
      );
      return;
    }

    window.chrome.runtime.sendMessage(
      extId,
      { type: "BRIEFLY_AUTH", token },
      (response) => {
        if (window.chrome?.runtime?.lastError) {
          setStatus("error");
          setMessage(window.chrome.runtime.lastError.message ?? "Extension connection failed.");
          return;
        }
        const ok = response && typeof response === "object" && "ok" in response && response.ok;
        if (ok) {
          setStatus("success");
          setMessage("Extension connected. You can close this tab and start saving articles.");
        } else {
          setStatus("error");
          setMessage("Extension did not confirm the connection. Try again from the extension popup.");
        }
      },
    );
  }, [searchParams]);

  return (
    <div className="dash-page dash-page-centered" style={{ minHeight: "70vh" }}>
      <div className="dash-surface" style={{ maxWidth: 420, padding: "2rem", textAlign: "center" }}>
        <p className="dash-page-eyebrow">Browser extension</p>
        <h1 className="dash-page-title" style={{ fontSize: "1.5rem" }}>
          {status === "success" ? "Connected" : status === "error" ? "Connection failed" : "Connecting…"}
        </h1>
        <p className="dash-page-subtitle" style={{ marginTop: "0.75rem" }}>
          {message}
        </p>
        {status === "error" && (
          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.5rem", justifyContent: "center" }}>
            <Link href="/login" className="dash-btn dash-btn-primary">
              Sign in
            </Link>
            <Link href="/dashboard" className="dash-btn dash-btn-secondary">
              Dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExtensionConnectPage() {
  return (
    <Suspense>
      <ConnectHandler />
    </Suspense>
  );
}
