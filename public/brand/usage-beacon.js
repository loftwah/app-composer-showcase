// MIT. Opt-in aggregate beacons: one published card id or one share method.
// Never the destination URL, page URL, query string or any visitor identifier.
// Navigation is never prevented, delayed or redirected: a failed beacon is silent.
const endpoint = new URL("../api/usage/action", import.meta.url).href;
function record(payload) {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator.sendBeacon === "function") {
      const queued = navigator.sendBeacon(
        endpoint,
        new Blob([body], { type: "application/json" }),
      );
      if (queued) return;
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {}
}
document.addEventListener("click", (event) => {
  if (
    !event.isTrusted ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest("a[data-usage-card]");
  const card = link?.getAttribute("data-usage-card");
  if (card) record({ kind: "link_action", card });
});
document.addEventListener("linkarooie:share", (event) => {
  const method =
    event instanceof CustomEvent ? event.detail?.method : undefined;
  if (method === "copy" || method === "native")
    record({ kind: "share_action", method });
});
export {};
