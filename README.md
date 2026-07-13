# Code Radio Player

- Chrome: https://chromewebstore.google.com/detail/code-radio-player/dmpebfmcjfeaooneleccgfhigfoekkio
- Firefox: https://addons.mozilla.org/en-US/firefox/addon/code-radio-player/

A Manifest V3 browser extension that plays [freeCodeCamp's Code Radio](https://coderadio-admin-v2.freecodecamp.org/) stream, with bitrate selection, volume control, and background playback.

## Features

- **Bitrate selector**: 128 kbps or 64 kbps streams
- **Volume control**
- **Background play**: uses an MV3 offscreen document so audio keeps playing after the popup closes
- **Courtesy link**: stream attributed to [freeCodeCamp Code Radio](https://coderadio.freecodecamp.org)
- **Buy Me a Coffee** link (handle: [lungo](https://www.buymeacoffee.com/lungo))

## Load it in Chrome / Edge

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Click the Code Radio toolbar icon to open the player

## How it works

```
popup.html/js  ──messages──▶  background.js (service worker)  ──messages──▶  offscreen.html/js (<audio>)
                  state + routing                                    owns the audio element
```

- `background.js` is the source of truth for playback state (persisted in `chrome.storage.local`) and manages the offscreen document lifecycle.
- `offscreen.js` owns the `<audio>` element, so playback survives popup close and runs in the background.
- Messages are routed with a `_to` field (`"background"` / `"offscreen"`) so only the intended listener responds.

## Files

- `manifest.json` — MV3 manifest (permissions: `offscreen`, `storage`)
- `background.js` — service worker
- `popup.html` / `popup.js` — toolbar popup UI
- `offscreen.html` / `offscreen.js` — offscreen audio document
- `icons/icon{16,32,48,128}.png` — toolbar/extension icons
