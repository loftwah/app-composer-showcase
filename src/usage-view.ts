import { escape } from "./common.ts";
import {
  usageDefinition,
  usageWindowLabel,
  type UsageReport,
  type UsageSettings,
  type UsageTotals,
  type UsageWindow,
} from "./usage.ts";
const count = (value: number) =>
  String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export function usageProofSection(
  proof: UsageTotals & { window: UsageWindow },
) {
  const empty = proof.profileOpens === 0 && proof.linkActions === 0;
  return `<section class="usage-proof" data-usage-block aria-labelledby="usage-proof-title"><h2 id="usage-proof-title">Usage proof</h2><dl class="usage-proof-totals"><div><dt>Recorded profile visits</dt><dd>${count(proof.profileOpens)}</dd></div><div><dt>Recorded link actions</dt><dd>${count(proof.linkActions)}</dd></div></dl><p class="usage-proof-window">Last ${proof.window.days} complete UTC days: ${usageWindowLabel(proof.window)}.</p><p class="usage-proof-definition">${usageDefinition} Profile visits count successful public homepage responses; link actions count primary activations of published links. No visitor information is collected or shown.</p>${empty ? "<p>No counts were recorded in this complete-day window. Today's activity is recorded but appears after the UTC day ends.</p>" : "<p>Today's activity is recorded but appears after the UTC day ends.</p>"}</section>`;
}
export function usageStudio(
  settings: UsageSettings | null,
  report: UsageReport | null,
  base: string,
) {
  if (!settings || !report)
    return `<section class="usage-studio" aria-labelledby="usage-studio-title"><h2 id="usage-studio-title">Usage proof</h2><p>Usage storage is unavailable. Apply migration <code>0004_usage.sql</code> and reload before enabling counts. No usage was changed.</p></section>`;
  const max = Math.max(
    1,
    ...report.days.map((day) =>
      Math.max(day.profileOpens, day.linkActions, day.shareActions),
    ),
  );
  const bar = (value: number) =>
    `<span class="usage-bar" aria-hidden="true" style="width:${Math.round((value / max) * 100)}%"></span>`;
  const summary = `<dl class="usage-summary"><div><dt>Profile opens</dt><dd>${count(report.totals.profileOpens)}</dd></div><div><dt>Link actions</dt><dd>${count(report.totals.linkActions)}</dd></div><div><dt>Share actions</dt><dd>${count(report.totals.shareActions)}</dd></div></dl>`;
  const todayLine = `<p class="small" data-usage-today>Today so far, partial and not in this window: ${count(report.today.profileOpens)} profile opens, ${count(report.today.linkActions)} link actions, ${count(report.today.shareActions)} share actions. It appears in the window after the UTC day ends.</p>`;
  const empty =
    report.totals.profileOpens === 0 &&
    report.totals.linkActions === 0 &&
    report.totals.shareActions === 0;
  const links = report.links.length
    ? `<ol class="usage-links">${report.links.map((link) => `<li><span>${escape(link.title)}</span> <strong>${count(link.count)}</strong></li>`).join("")}</ol>`
    : `<p>${empty ? "No counts recorded in this window yet." : "No published link has recorded actions in this window."}</p>`;
  const table = `<details class="usage-daily"><summary>Daily counts</summary><table><caption>Recorded counts for each complete UTC day in this window</caption><thead><tr><th scope="col">Day</th><th scope="col">Profile opens</th><th scope="col">Link actions</th><th scope="col">Share actions</th></tr></thead><tbody>${report.days.map((day) => `<tr><th scope="row">${day.day}</th><td>${bar(day.profileOpens)}${count(day.profileOpens)}</td><td>${bar(day.linkActions)}${count(day.linkActions)}</td><td>${bar(day.shareActions)}${count(day.shareActions)}</td></tr>`).join("")}</tbody></table></details>`;
  const expected = escape(
    JSON.stringify({
      enabled: settings.enabled,
      publicBlock: settings.publicBlock,
    }),
  );
  return `<section class="usage-studio" aria-labelledby="usage-studio-title" data-usage-panel data-expected="${expected}" data-usage-api="${escape(base)}/api/usage"><div class="usage-heading"><h2 id="usage-studio-title">Usage proof</h2><nav class="usage-windows" aria-label="Usage window">${[7, 30, 90].map((days) => `<a href="${escape(base)}/owner?usage=${days}"${days === report.window.days ? ' aria-current="page"' : ""}>${days} days</a>`).join("")}</nav></div><p>Last ${report.window.days} complete UTC days: ${usageWindowLabel(report.window)}. Today is excluded until it ends.</p>${summary}${todayLine}<p class="small">${usageDefinition} Recorded only while recording is on. No IP address, user agent, referrer, cookie, session or visitor identifier is stored.</p>${links}${table}<form data-usage-settings><fieldset><legend>Recording and public proof</legend><label class="profile-check"><input type="checkbox" data-usage-enabled name="enabled" ${settings.enabled ? "checked" : ""}> Record aggregate usage</label><label class="profile-check"><input type="checkbox" data-usage-public name="publicBlock" ${settings.publicBlock ? "checked" : ""} ${settings.enabled ? "" : "disabled"}> Show the public usage proof</label><p class="small">Recording is off by default. Turning the public proof off removes it immediately; owner totals are retained. Counts are never people, and the public proof never shows share actions or per-link rankings.</p><button type="submit" class="secondary">Save usage settings</button><p role="status" aria-live="polite" data-usage-status></p></fieldset></form></section>`;
}
