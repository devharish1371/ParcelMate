import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallApp() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [installed, setInstalled] = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true,
  );

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  async function install() {
    if (!promptEvent) {
      setShowHelp((value) => !value);
      return;
    }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === "dismissed") setShowHelp(true);
  }

  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return <div className="install-app">
    <button type="button" className="text-link" onClick={() => void install()}>Install ParcelMate</button>
    {showHelp && <p className="install-help" role="status">
      {isAppleMobile
        ? "Open this page in Safari, tap Share, then Add to Home Screen."
        : "Open this page in Chrome, then use its menu to choose Install app or Add to Home screen."}
    </p>}
  </div>;
}
