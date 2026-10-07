const button = document.querySelector("#toggle");
const statusEl = document.querySelector("#status");
const countEl = document.querySelector("#count");

let shownCount = 1260;

function formatCount(value) {
  return Number(value).toLocaleString("en-US");
}

function render(enabled, count = shownCount) {
  const on = Boolean(enabled);
  shownCount = count;
  button.setAttribute("aria-pressed", on ? "true" : "false");
  statusEl.textContent = on ? "Blocking ads" : "Paused";
  countEl.textContent = formatCount(count);
}

button.addEventListener("click", async () => {
  const next = button.getAttribute("aria-pressed") !== "true";
  render(next);
  if (!globalThis.chrome?.storage?.local) return;
  await chrome.storage.local.set({ enabled: next });
});

if (globalThis.chrome?.storage?.local) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled) render(changes.enabled.newValue, shownCount);
    if (changes.adsBlocked && !changes.enabled) {
      render(button.getAttribute("aria-pressed") === "true", changes.adsBlocked.newValue);
    }
  });

  chrome.storage.local.get({ enabled: false, adsBlocked: 1260 }).then(async (data) => {
    let count = Number(data.adsBlocked) || 0;
    if (data.enabled) {
      count += 1;
      await chrome.storage.local.set({ adsBlocked: count });
    }
    render(data.enabled, count);
  });
} else {
  render(false, shownCount);
}
