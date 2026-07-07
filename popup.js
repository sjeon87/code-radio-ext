// Popup UI logic for Code Radio Player.

const playBtn = document.getElementById("play");
const dot = document.getElementById("dot");
const bitrateSel = document.getElementById("bitrate");
const volumeSlider = document.getElementById("volume");
const volLabel = document.getElementById("volLabel");
const statusEl = document.getElementById("status");

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function setStatus(text, isError = false) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("error", isError);
}

function render(state) {
  const playing = !!state.playing;
  dot.classList.toggle("live", playing);
  playBtn.textContent = playing ? "Pause" : "Play";
  bitrateSel.value = state.bitrate === "low" ? "low" : "high";
  const v = Number.isFinite(state.volume) ? state.volume : 0.8;
  volumeSlider.value = v;
  volLabel.textContent = Math.round(v * 100) + "%";
  setStatus(playing ? "Streaming" : "");
}

async function load() {
  try {
    const res = await send({ type: "get-state" });
    if (res?.ok) render(res.data);
  } catch (err) {
    setStatus("Failed to load state", true);
  }
}

playBtn.addEventListener("click", async () => {
  playBtn.disabled = true;
  try {
    const res = await send({ type: "toggle" });
    if (res?.ok) render(res.data);
    else setStatus(res?.error || "Playback error", true);
  } catch (err) {
    setStatus(String(err), true);
  } finally {
    playBtn.disabled = false;
  }
});

bitrateSel.addEventListener("change", async () => {
  try {
    const res = await send({ type: "set-bitrate", bitrate: bitrateSel.value });
    if (res?.ok) render(res.data);
  } catch (err) {
    setStatus(String(err), true);
  }
});

volumeSlider.addEventListener("input", async () => {
  const v = Number(volumeSlider.value);
  volLabel.textContent = Math.round(v * 100) + "%";
  await send({ type: "set-volume", volume: v });
});

load();
