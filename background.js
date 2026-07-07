// Background service worker for Code Radio Player.
// Owns playback state and an offscreen document that holds the <audio> element,
// enabling continuous background playback across popup open/close.

const OFFSCREEN_URL = "offscreen.html";

const STREAMS = {
  low: "https://coderadio-admin-v2.freecodecamp.org/listen/coderadio/low.mp3",
  high: "https://coderadio-admin-v2.freecodecamp.org/listen/coderadio/radio.mp3"
};

const DEFAULT_STATE = {
  playing: false,
  bitrate: "high", // "low" (64kbps) | "high" (128kbps)
  volume: 0.8,
  url: STREAMS.high
};

// ---- State helpers ----

async function getState() {
  const stored = await chrome.storage.local.get("state");
  return { ...DEFAULT_STATE, ...(stored.state || {}) };
}

async function setState(patch) {
  const next = { ...(await getState()), ...patch };
  await chrome.storage.local.set({ state: next });
  return next;
}

// ---- Offscreen document lifecycle ----

async function hasOffscreen() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    return contexts.length > 0;
  }
  // Fallback for older Chrome versions.
  return await chrome.offscreen.hasDocument?.();
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play Code Radio stream in the background."
  });
}

async function closeOffscreen() {
  if (!(await hasOffscreen())) return;
  await chrome.offscreen.closeDocument();
}

// ---- Messaging ----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only handle messages addressed to the background (or unaddressed ones
  // from the popup). Forwarded messages addressed to "offscreen" are ignored.
  if (msg?._to && msg._to !== "background") return;
  (async () => {
    try {
      const res = await handle(msg);
      sendResponse({ ok: true, data: res });
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
  })();
  return true; // async
});

async function handle(msg) {
  switch (msg?.type) {
    case "error":
      // Informational error forwarded from the offscreen document.
      console.warn("[code-radio] offscreen error:", msg.error);
      return { ack: true };
    case "get-state":
      return await getState();

    case "play": {
      const state = await setState({ playing: true });
      await ensureOffscreen();
      sendToOffscreen({ type: "load", url: state.url });
      sendToOffscreen({ type: "set-volume", volume: state.volume });
      sendToOffscreen({ type: "play" });
      return state;
    }

    case "pause": {
      const state = await setState({ playing: false });
      sendToOffscreen({ type: "pause" });
      await closeOffscreen();
      return state;
    }

    case "toggle": {
      const current = await getState();
      if (current.playing) return await handle({ type: "pause" });
      return await handle({ type: "play" });
    }

    case "set-bitrate": {
      const bitrate = msg.bitrate === "low" ? "low" : "high";
      const url = STREAMS[bitrate];
      const state = await setState({ bitrate, url });
      if (state.playing) {
        await ensureOffscreen();
        sendToOffscreen({ type: "load", url });
        sendToOffscreen({ type: "set-volume", volume: state.volume });
        sendToOffscreen({ type: "play" });
      }
      return state;
    }

    case "set-volume": {
      const volume = clamp(Number(msg.volume) || 0, 0, 1);
      const state = await setState({ volume });
      sendToOffscreen({ type: "set-volume", volume });
      return state;
    }

    case "stream-status":
      // Forward query to offscreen (if alive) — used by popup on open.
      try {
        return await chrome.runtime.sendMessage({ type: "offscreen-status", _to: "offscreen" });
      } catch {
        return { paused: true };
      }

    default:
      throw new Error(`Unknown message type: ${msg?.type}`);
  }
}

function sendToOffscreen(msg) {
  chrome.runtime.sendMessage({ ...msg, _to: "offscreen" }).catch(() => {
    // Offscreen may not be ready yet; ignore transient errors.
  });
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
