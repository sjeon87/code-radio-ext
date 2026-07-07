// Offscreen document: owns the <audio> element used for background playback.
// Receives commands from the service worker.

const audio = document.getElementById("audio");
audio.crossOrigin = "anonymous";

function sendBackground(msg) {
  chrome.runtime.sendMessage({ ...msg, _to: "background" }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Only handle messages explicitly addressed to the offscreen document.
  // All other messages (popup -> background, background's own) are ignored here.
  if (msg?._to !== "offscreen") return;

  switch (msg?.type) {
    case "load":
      if (audio.src !== msg.url) {
        audio.src = msg.url;
        audio.load();
      }
      sendResponse({ ok: true });
      break;

    case "play":
      audio.play().catch((err) => sendBackground({ type: "error", error: String(err) }));
      sendResponse({ ok: true });
      break;

    case "pause":
      audio.pause();
      sendResponse({ ok: true });
      break;

    case "set-volume":
      audio.volume = clamp(Number(msg.volume), 0, 1);
      sendResponse({ ok: true });
      break;

    case "offscreen-status":
      sendResponse({ ok: true, paused: audio.paused, src: audio.src, volume: audio.volume });
      break;

    default:
      sendResponse({ ok: false, error: "unknown" });
  }
});

function clamp(v, lo, hi) {
  v = Number.isFinite(v) ? v : 0;
  return Math.max(lo, Math.min(hi, v));
}

// Report errors back to the background for visibility.
audio.addEventListener("error", () => {
  const e = audio.error;
  sendBackground({ type: "error", error: `audio error code ${e ? e.code : "unknown"}` });
});
