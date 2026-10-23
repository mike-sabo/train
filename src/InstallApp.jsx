import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Smartphone, X } from "lucide-react";

export function InstallApp() {
  const dialog = useRef(null);
  const installPrompt = useRef(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true,
  );
  const [phone, setPhone] = useState(() =>
    /Android/i.test(navigator.userAgent) ? "android" : "ios",
  );
  const [message, setMessage] = useState("");
  const localPreview = ["localhost", "127.0.0.1", "[::1]"].includes(
    window.location.hostname,
  );

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const ready = (event) => {
      event.preventDefault();
      installPrompt.current = event;
      setCanPrompt(true);
    };
    const complete = () => {
      installPrompt.current = null;
      setCanPrompt(false);
      setInstalled(true);
    };
    const changed = () => {
      if (displayMode.matches) complete();
    };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", complete);
    displayMode.addEventListener("change", changed);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", complete);
      displayMode.removeEventListener("change", changed);
    };
  }, []);

  async function install() {
    const prompt = installPrompt.current;
    if (!prompt) return;
    // Each browser prompt can be used only once, even when it is dismissed.
    installPrompt.current = null;
    setCanPrompt(false);
    setInstalling(true);
    setMessage("");
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(
        choice.outcome === "accepted"
          ? "Your browser is adding Train Together. Follow any remaining prompts."
          : "No problem. You can add it later using your browser’s menu.",
      );
    } catch {
      setMessage(
        "Use your browser’s menu to add Train Together. The steps are below.",
      );
    } finally {
      setInstalling(false);
    }
  }

  return (
    <>
      {!installed && (
        <button
          className="install-trigger"
          onClick={() => dialog.current.showModal()}
        >
          <Smartphone size={16} /> Add to Home Screen
        </button>
      )}
      <dialog
        ref={dialog}
        className="modal install-dialog"
        aria-labelledby="install-title"
      >
        <button
          className="close"
          aria-label="Close install instructions"
          onClick={() => dialog.current.close()}
        >
          <X />
        </button>
        <img
          className="install-icon"
          src="/workout-plan/icons/app-192.png"
          width="64"
          height="64"
          alt=""
        />
        <p className="eyebrow">TRAIN TOGETHER</p>
        <h2 id="install-title">One tap. Ready to train.</h2>
        <p className="muted">
          Add your workouts to your Home Screen. Free to add, with the same
          invite-only account.
        </p>
        {installed ? (
          <p className="install-success" role="status">
            <CheckCircle2 size={20} /> Train Together is installed on this
            device.
          </p>
        ) : (
          <>
            {localPreview ? (
              <p className="install-note">
                This is a computer preview. Open the published HTTPS address on
                your phone to add it.
              </p>
            ) : (
              !window.isSecureContext && (
                <p className="install-note">
                  Open the secure (https://) address in your browser before
                  installing.
                </p>
              )
            )}
            {canPrompt && !localPreview && window.isSecureContext && (
              <button
                className="solid full"
                disabled={installing}
                onClick={install}
              >
                <Download size={18} /> Install on this device
              </button>
            )}
            {message && (
              <p className="install-message" role="status">
                {message}
              </p>
            )}
            <div
              className="install-platforms"
              role="group"
              aria-label="Choose your phone"
            >
              <button
                aria-pressed={phone === "ios"}
                onClick={() => setPhone("ios")}
              >
                iPhone / iPad
              </button>
              <button
                aria-pressed={phone === "android"}
                onClick={() => setPhone("android")}
              >
                Android
              </button>
            </div>
            {phone === "ios" ? (
              <ol className="install-steps">
                <li>
                  Open Train Together in <strong>Safari</strong> on your phone.
                </li>
                <li>
                  Tap <strong>Share</strong> (you may need to open the page menu
                  first), then <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  Keep <strong>Open as Web App</strong> turned on if shown, then
                  tap <strong>Add</strong>.
                </li>
              </ol>
            ) : (
              <ol className="install-steps">
                <li>
                  Open Train Together in <strong>Chrome</strong> on your phone.
                </li>
                <li>
                  Tap the <strong>⋮ menu</strong>, then{" "}
                  <strong>Install and create shortcut</strong> or{" "}
                  <strong>Add to Home screen</strong>.
                </li>
                <li>
                  Choose <strong>Install</strong> and follow the prompts. Some
                  versions show <strong>Install app</strong> directly in the
                  menu.
                </li>
              </ol>
            )}
          </>
        )}
        <p className="install-footnote">
          Connect to the internet to load and save workouts. You may need to
          sign in the first time you open the app.
        </p>
        <button className="outline full" onClick={() => dialog.current.close()}>
          Got it
        </button>
      </dialog>
    </>
  );
}
