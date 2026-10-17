// App-owned theme/gallery behaviour. Common launcher: /brand/launcher.js.
const theme = document.querySelector<HTMLButtonElement>("#reader-theme")!;
const app = document.documentElement.dataset.app;
const key = document.documentElement.dataset.themeKey || app + ":reader-theme";
function themeLabel() {
  const control = theme;
  const dark = document.documentElement.dataset.theme !== "light";
  control.setAttribute("aria-label", "Dark theme");
  control.setAttribute("aria-pressed", String(dark));
  control.title = dark ? "Switch to light theme" : "Switch to dark theme";
}
themeLabel();
theme.addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(key, next);
  } catch {}
  themeLabel();
});

const gallerySearch =
  document.querySelector<HTMLInputElement>("#gallery-search")!;
if (gallerySearch) {
  const items = [
      ...document.querySelectorAll<HTMLElement>("[data-gallery-item]"),
    ],
    unique = new Set(items.map((item) => item.dataset.galleryId ?? item)),
    type = document.querySelector<HTMLSelectElement>("#gallery-type")!,
    status = document.querySelector<HTMLElement>("#gallery-count")!,
    empty = document.querySelector<HTMLElement>("#gallery-empty")!;
  function filterGallery() {
    const query = gallerySearch.value.trim().toLowerCase(),
      kind = type?.value || "";
    const shown = new Set();
    for (const item of items) {
      item.hidden = !(
        (item.textContent ?? "").toLowerCase().includes(query) &&
        (!kind || item.dataset.kind === kind)
      );
      if (!item.hidden) shown.add(item.dataset.galleryId ?? item);
    }
    const count = shown.size;
    // Silence is the honest default: a count only means something once filtered.
    status.textContent =
      query || kind
        ? `${count} of ${unique.size} ${unique.size === 1 ? "item" : "items"} shown`
        : "";
    empty.hidden = items.length === 0 || count !== 0;
  }
  gallerySearch.addEventListener("input", filterGallery);
  type?.addEventListener("change", filterGallery);
  filterGallery();
}
