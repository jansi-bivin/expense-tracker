"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PwaPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // Listen for a new SW waiting to activate
          const onUpdateFound = () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateReady(true);
              }
            });
          };
          reg.addEventListener("updatefound", onUpdateFound);

          // Check for updates every 30 minutes while the app is open
          const interval = setInterval(() => reg.update(), 30 * 60 * 1000);
          return () => {
            clearInterval(interval);
            reg.removeEventListener("updatefound", onUpdateFound);
          };
        })
        .catch(() => {/* SW registration failed silently */});
    }

    // Capture the install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setInstallEvent(null);
  };

  const handleUpdate = () => {
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.waiting?.postMessage({ type: "SKIP_WAITING" });
    });
    window.location.reload();
  };

  if (dismissed) return null;

  // Update banner takes priority
  if (updateReady) {
    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg bg-blue-600 text-white text-sm max-w-xs w-full mx-4">
        <span className="flex-1">A new version is ready!</span>
        <button
          onClick={handleUpdate}
          className="font-semibold bg-white text-blue-600 rounded-lg px-3 py-1 text-xs"
        >
          Update
        </button>
        <button onClick={() => setDismissed(true)} className="opacity-70 hover:opacity-100 text-lg leading-none">
          ×
        </button>
      </div>
    );
  }

  // Install prompt
  if (installEvent) {
    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg bg-gray-900 text-white text-sm max-w-xs w-full mx-4">
        <span className="text-xl">📲</span>
        <span className="flex-1">Install ExpTrack for quick access</span>
        <button
          onClick={handleInstall}
          className="font-semibold bg-blue-500 hover:bg-blue-400 rounded-lg px-3 py-1 text-xs"
        >
          Install
        </button>
        <button onClick={() => setDismissed(true)} className="opacity-70 hover:opacity-100 text-lg leading-none">
          ×
        </button>
      </div>
    );
  }

  return null;
}
