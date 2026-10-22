// Getting the play log out of the browser (Shift+L). The log itself lives in the save (src/save.js: logWave, logHeat,
// exportPlayLog). Nothing here sends anything anywhere: it downloads a JSON file and also copies the same text to the
// clipboard, then says what it did on screen.
import { exportPlayLog } from "./save.js";

function stamp(ms) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}

let toastEl = null;
let toastTimer = 0;

function toast(text) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.setAttribute("role", "status");
    toastEl.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:50;max-width:min(92vw,560px);padding:10px 16px;border-radius:8px;background:rgba(8,20,32,.92);color:#e8f4fa;font:14px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 4px 18px rgba(0,0,0,.4)";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.display = "none";
  }, 6000);
}

/**
 * Shift+L. Downloads the play log as endless-swell-playlog-<date>.json and copies the same text to the clipboard. With
 * `dryRun` it only returns the object (the test hook uses that). Returns the exported object.
 */
export function exportLog(save, { dryRun = false } = {}) {
  const data = exportPlayLog(save);
  if (dryRun) return data;
  const text = JSON.stringify(data, null, 1);
  const name = `endless-swell-playlog-${stamp(data.exportedAt)}.json`;
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  const summary = `${data.waves.length} waves, ${data.heats.length} heats`;
  toast(`Play log saved to your Downloads: ${name} (${summary}).`);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast(`Play log saved to your Downloads: ${name} (${summary}), and copied to the clipboard.`),
      (e) => console.warn("playlog: the clipboard copy was refused; the file was still downloaded", e),
    );
  } else console.warn("playlog: no clipboard in this browser; the file was still downloaded");
  return data;
}
