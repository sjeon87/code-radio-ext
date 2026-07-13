// Background for Code Radio Player.
// Owns playback state. On Chrome it drives an offscreen document that holds the
// <audio> element (service workers can't host media). On Firefox, MV3 background
// scripts run in a page context with DOM access, so we host the <audio> element
// directly here instead of using the offscreen API (which Firefox lacks).
// The same file is loaded by both browsers; the OFFSCREEN_SUPPORTED flag routes
// audio commands to the correct backend.

const OFFSCREEN_SUPPORTED = !!(
  typeof chrome !== "undefined" &&
  chrome.offscreen &&
  typeof chrome.offscreen.createDocument === "function"
);
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

// ---- Firefox audio host (DOM available in MV3 background scripts) ----
let ffAudio = null;
function getFfAudio() {
  if (!ffAudio) {
    ffAudio = new Audio();
    ffAudio.crossOrigin = "anonymous";
    ffAudio.preload = "none";
    ffAudio.addEventListener("error", () => {
      console.warn("[code-radio] audio error:", ffAudio.error);
    });
  }
  return ffAudio;
}

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

// ---- Offscreen document lifecycle (Chrome only) ----
async function hasOffscreen() {
  if (!OFFSCREEN_SUPPORTED) return false;
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    return contexts.length > 0;
  }
  return await chrome.offscreen.hasDocument?.();
}

async function ensureOffscreen() {
  if (!OFFSCREEN_SUPPORTED) return;
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play Code Radio stream in the background."
  });
}

async function closeOffscreen() {
  if (!OFFSCREEN_SUPPORTED) return;
  if (!(await hasOffscreen())) return;
  await chrome.offscreen.closeDocument();
}

// ---- Audio command routing (works in both browsers) ----
function audioLoad(url) {
  if (OFFSCREEN_SUPPORTED) {
    sendToOffscreen({ type: "load", url });
    return;
  }
  const a = getFfAudio();
  if (a.src !== url) {
    a.src = url;
    a.load();
  }
}

function audioPlay() {
  if (OFFSCREEN_SUPPORTED) {
    sendToOffscreen({ type: "play" });
    return;
  }
  getFfAudio()
    .play()
    .catch((err) => console.warn("[code-radio] play failed:", String(err)));
}

function audioPause() {
  if (OFFSCREEN_SUPPORTED) {
    sendToOffscreen({ type: "pause" });
    return;
  }
  if (ffAudio) ffAudio.pause();
}

function audioSetVolume(v) {
  const vol = clamp(Number(v), 0, 1);
  if (OFFSCREEN_SUPPORTED) {
    sendToOffscreen({ type: "set-volume", volume: vol });
    return;
  }
  if (ffAudio) ffAudio.volume = vol;
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
      // Informational error forwarded from the offscreen document (Chrome only).
      console.warn("[code-radio] offscreen error:", msg.error);
      return { ack: true };

    case "get-state":
      return await getState();

    case "play": {
      const state = await setState({ playing: true });
      if (OFFSCREEN_SUPPORTED) await ensureOffscreen();
      audioLoad(state.url);
      audioSetVolume(state.volume);
      audioPlay();
      return state;
    }

    case "pause": {
      const state = await setState({ playing: false });
      audioPause();
      if (OFFSCREEN_SUPPORTED) await closeOffscreen();
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
        if (OFFSCREEN_SUPPORTED) await ensureOffscreen();
        audioLoad(url);
        audioSetVolume(state.volume);
        audioPlay();
      }
      return state;
    }

    case "set-volume": {
      const volume = clamp(Number(msg.volume) || 0, 0, 1);
      const state = await setState({ volume });
      audioSetVolume(volume);
      return state;
    }

    case "stream-status":
      if (OFFSCREEN_SUPPORTED) {
        try {
          return await chrome.runtime.sendMessage({
            type: "offscreen-status",
            _to: "offscreen"
          });
        } catch {
          return { paused: true };
        }
      }
      return {
        paused: !ffAudio || ffAudio.paused,
        src: ffAudio ? ffAudio.src : "",
        volume: ffAudio ? ffAudio.volume : 0
      };

    default:
      throw new Error(`Unknown message type: ${msg?.type}`);
  }
}

function sendToOffscreen(msg) {
  chrome.runtime.sendMessage({ ...msg, _to: "offscreen" }).catch(() => {
    // Offscreen may not be ready yet; ignore transient errors.
  });
}

// ---- Startup: reset transient playing flag ----
// State is persisted in chrome.storage.local, which outlives the audio backend
// (the offscreen document on Chrome, the <audio> element on Firefox). If the
// user was playing when the browser closed, `playing` would still be true on the
// next start even though no audio plays anymore — the popup would falsely show
// "Streaming". Reset the flag on startup so the UI reflects reality.
// onStartup fires once per browser session (not when the service worker respawns
// from idle, which must NOT reset an actively-playing Chrome offscreen doc).
async function resetPlayingOnStartup() {
  const state = await getState();
  if (state.playing) {
    await setState({ playing: false });
  }
}

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(resetPlayingOnStartup);
}
if (chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(resetPlayingOnStartup);
}

function clamp(v, lo, hi) {
  v = Number.isFinite(v) ? v : lo;
  return Math.max(lo, Math.min(hi, v));
}
