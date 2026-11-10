"use client";

import { useEffect } from "react";

const RELOAD_KEY = "exptrack-error-reload";

/**
 * Replaces Next's bare "Application error: a client-side exception has occurred".
 * The usual cause is a page from the previous deploy asking for app files that no
 * longer exist: reload once to get the current version. If it fails again within
 * half a minute, stop and show the error so it can be reported.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
      }
    } catch {
      /* storage blocked: show the message below */
    }
  }, []);

  const detail = `${error?.name ?? "Error"}: ${error?.message ?? ""}${error?.digest ? ` (${error.digest})` : ""}`;

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#0b0b14", color: "#e8e8f0", fontFamily: "system-ui, -apple-system, sans-serif", padding: 16 }}>
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>ExpTrack couldn&apos;t load</div>
          <div style={{ fontSize: 13, color: "#9a9ab0", marginBottom: 16 }}>
            Reloading usually fixes this right after an update.
          </div>
          <button onClick={() => window.location.reload()}
            style={{ background: "#7b6cf6", color: "#fff", border: 0, borderRadius: 12, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Reload
          </button>
          <div style={{ fontSize: 10, color: "#6a6a80", marginTop: 16, wordBreak: "break-word" }}>{detail}</div>
        </div>
      </body>
    </html>
  );
}
