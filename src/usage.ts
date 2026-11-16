// Opt-in aggregate usage proof. The app owns one D1 table and one settings row.
// This module never accepts or stores request metadata: only a complete UTC day,
// an allowlisted kind, a bounded public key and a capped incrementing count.
export type UsageKind = "profile_open" | "link_action" | "share_action";
export type ShareMethod = "copy" | "native" | "download";
export interface UsageSettings {
  enabled: boolean;
  publicBlock: boolean;
  updatedAt: string;
}
export interface UsageWindow {
  days: number;
  start: string;
  end: string;
}
export interface UsageDay {
  day: string;
  profileOpens: number;
  linkActions: number;
  shareActions: number;
}
export interface UsageLink {
  id: string;
  title: string;
  count: number;
}
export interface UsageTotals {
  profileOpens: number;
  linkActions: number;
}
export interface UsageReport {
  settings: UsageSettings;
  window: UsageWindow;
  totals: UsageTotals & { shareActions: number };
  today: UsageDay;
  days: UsageDay[];
  links: UsageLink[];
  definition: string;
  quality: string[];
}
export class UsageError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export const usageCountLimit = 100000;
export const usageDefinition =
  "Counted requests/actions, not people. Each count is one recorded request or action, never a person.";
export const usageWindows = [7, 30, 90] as const;
const shareMethods: ShareMethod[] = ["copy", "native", "download"];
const cardKey = /^[a-zA-Z0-9-]{1,64}$/;
// Deliberately narrow: only user agents that identify themselves as automation
// are skipped. Missing or unfamiliar agents are still counted, because guessing
// would silently discard real readers. Synthetic release probes opt out below.
const automatedAgent =
  /(?:^|[^a-z])(?:bot|crawler|spider|headlesschrome|phantomjs)(?:[^a-z]|$)|googlebot|bingbot|duckduckbot|yandexbot|baiduspider|facebookexternalhit|twitterbot|linkedinbot|discordbot|telegrambot|slackbot|whatsapp|pinterestbot|applebot|semrushbot|ahrefsbot|mj12bot|curl\/|wget\//i;
export function usageDay(now: Date = new Date()) {
  return now.toISOString().slice(0, 10);
}
export function addUsageDays(day: string, amount: number) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount))
    .toISOString()
    .slice(0, 10);
}
// Today is incomplete, so it is never part of a report or public proof.
export function usageWindow(days: number, now: Date = new Date()): UsageWindow {
  if (!usageWindows.includes(days as (typeof usageWindows)[number]))
    throw new UsageError("Choose a 7, 30 or 90 complete-day window.");
  const end = usageDay(now);
  return { days, start: addUsageDays(end, -days), end };
}
export function countsAsProfileOpen(req: Request) {
  if (req.method !== "GET") return false;
  if (req.headers.get("X-Composer-Verification") === "1") return false;
  const destination = req.headers.get("Sec-Fetch-Dest");
  if (destination && destination !== "document") return false;
  return !automatedAgent.test(req.headers.get("User-Agent") ?? "");
}
export async function readUsageSettings(db: D1Database): Promise<UsageSettings> {
  let row:
    | { enabled: number; public_block: number; updated_at: string }
    | null;
  try {
    row = await db
      .prepare(
        "SELECT enabled,public_block,updated_at FROM usage_settings WHERE id=1",
      )
      .first<{ enabled: number; public_block: number; updated_at: string }>();
  } catch {
    throw new UsageError(
      "Usage settings are unavailable. Apply migration 0004_usage.sql first.",
      503,
    );
  }
  if (!row)
    throw new UsageError(
      "Usage settings are unavailable. Apply migration 0004_usage.sql first.",
      503,
    );
  return {
    enabled: row.enabled === 1,
    publicBlock: row.public_block === 1,
    updatedAt: row.updated_at,
  };
}
// One UPSERT per event. The INSERT only applies while the owner has recording
// enabled, and the conflict update stops at the per-day/key cap instead of
// growing a row without bound.
export function incrementUsage(
  db: D1Database,
  day: string,
  kind: UsageKind,
  key: string,
) {
  return db
    .prepare(
      "INSERT INTO usage_daily(day,kind,key,count) SELECT ?1,?2,?3,1 WHERE EXISTS(SELECT 1 FROM usage_settings WHERE id=1 AND enabled=1) ON CONFLICT(day,kind,key) DO UPDATE SET count=count+1 WHERE count<?4",
    )
    .bind(day, kind, key, usageCountLimit)
    .run();
}
export async function recordProfileOpen(
  db: D1Database,
  now: Date = new Date(),
) {
  await incrementUsage(db, usageDay(now), "profile_open", "profile");
}
// Accepted events are silent: an unknown kind, a draft/removed card or an
// unlisted method records nothing. The endpoint still returns 204 so the page
// never learns whether a card is published from this public surface.
export async function recordUsageAction(
  db: D1Database,
  input: unknown,
  now: Date = new Date(),
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const body = input as Record<string, unknown>;
  const day = usageDay(now);
  if (body.kind === "link_action") {
    if (typeof body.card !== "string" || !cardKey.test(body.card)) return false;
    await db
      .prepare(
        "INSERT INTO usage_daily(day,kind,key,count) SELECT ?1,'link_action',?2,1 WHERE EXISTS(SELECT 1 FROM usage_settings WHERE id=1 AND enabled=1) AND EXISTS(SELECT 1 FROM cards WHERE id=?2 AND status='published') ON CONFLICT(day,kind,key) DO UPDATE SET count=count+1 WHERE count<?3",
      )
      .bind(day, body.card, usageCountLimit)
      .run();
    return true;
  }
  if (body.kind === "share_action") {
    if (
      typeof body.method !== "string" ||
      !shareMethods.includes(body.method as ShareMethod)
    )
      return false;
    await incrementUsage(db, day, "share_action", body.method);
    return true;
  }
  return false;
}
export async function changeUsageSettings(db: D1Database, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new UsageError("Choose usage settings.");
  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).length !== 3 ||
    !Object.hasOwn(body, "enabled") ||
    !Object.hasOwn(body, "publicBlock") ||
    !Object.hasOwn(body, "expected")
  )
    throw new UsageError("Use the current usage settings and expected values.");
  const expected = body.expected;
  if (
    typeof body.enabled !== "boolean" ||
    typeof body.publicBlock !== "boolean" ||
    !expected ||
    typeof expected !== "object" ||
    Array.isArray(expected) ||
    Object.keys(expected).length !== 2 ||
    typeof (expected as Record<string, unknown>).enabled !== "boolean" ||
    typeof (expected as Record<string, unknown>).publicBlock !== "boolean"
  )
    throw new UsageError("Use the current usage settings and expected values.");
  const current = expected as { enabled: boolean; publicBlock: boolean };
  if (body.publicBlock && !body.enabled)
    throw new UsageError(
      "Turn usage recording on before showing a public usage proof.",
    );
  const updatedAt = new Date().toISOString();
  let saved:
    | { enabled: number; public_block: number; updated_at: string }
    | null;
  try {
    saved = await db
      .prepare(
        "UPDATE usage_settings SET enabled=?,public_block=?,updated_at=? WHERE id=1 AND enabled=? AND public_block=? RETURNING enabled,public_block,updated_at",
      )
      .bind(
        body.enabled ? 1 : 0,
        body.publicBlock ? 1 : 0,
        updatedAt,
        current.enabled ? 1 : 0,
        current.publicBlock ? 1 : 0,
      )
      .first<{ enabled: number; public_block: number; updated_at: string }>();
  } catch {
    throw new UsageError(
      "Usage settings could not be saved. Apply migration 0004_usage.sql and try again.",
      503,
    );
  }
  if (!saved)
    throw new UsageError(
      "Usage settings changed. Refresh and compare before saving again.",
      409,
    );
  return {
    enabled: saved.enabled === 1,
    publicBlock: saved.public_block === 1,
    updatedAt: saved.updated_at,
  } satisfies UsageSettings;
}
function emptyDay(day: string): UsageDay {
  return { day, profileOpens: 0, linkActions: 0, shareActions: 0 };
}
export async function usageTotals(
  db: D1Database,
  days: number,
  now: Date = new Date(),
): Promise<UsageTotals & { window: UsageWindow }> {
  const window = usageWindow(days, now);
  const { results } = await db
    .prepare(
      "SELECT kind,SUM(count) AS n FROM usage_daily WHERE day>=? AND day<? AND kind IN ('profile_open','link_action') GROUP BY kind",
    )
    .bind(window.start, window.end)
    .all<{ kind: UsageKind; n: number }>();
  const total = (kind: UsageKind) =>
    Number(results.find((row) => row.kind === kind)?.n ?? 0);
  return {
    window,
    profileOpens: total("profile_open"),
    linkActions: total("link_action"),
  };
}
// Complete UTC days only. Share actions and per-link totals stay owner-only.
export async function publicUsageProof(
  db: D1Database,
  now: Date = new Date(),
) {
  const settings = await readUsageSettings(db);
  if (!settings.enabled || !settings.publicBlock) return null;
  return usageTotals(db, 30, now);
}
export async function usageReport(
  db: D1Database,
  days: number,
  now: Date = new Date(),
): Promise<UsageReport> {
  const window = usageWindow(days, now);
  const settings = await readUsageSettings(db);
  const { results } = await db
    .prepare(
      "SELECT day,kind,SUM(count) AS n FROM usage_daily WHERE day>=? AND day<? GROUP BY day,kind",
    )
    .bind(window.start, window.end)
    .all<{ day: string; kind: UsageKind; n: number }>();
  const series: UsageDay[] = [];
  for (let day = window.start; day < window.end; day = addUsageDays(day, 1))
    series.push(emptyDay(day));
  const byDay = new Map(series.map((entry) => [entry.day, entry]));
  const totals = { profileOpens: 0, linkActions: 0, shareActions: 0 };
  for (const row of results) {
    const entry = byDay.get(row.day);
    if (!entry) continue;
    const count = Number(row.n ?? 0);
    if (row.kind === "profile_open") {
      entry.profileOpens += count;
      totals.profileOpens += count;
    } else if (row.kind === "link_action") {
      entry.linkActions += count;
      totals.linkActions += count;
    } else {
      entry.shareActions += count;
      totals.shareActions += count;
    }
  }
  // Today is excluded from the complete-day window, but the owner still needs
  // to see that recording is working. This partial day is never public.
  const today = emptyDay(usageDay(now));
  const { results: todayRows } = await db
    .prepare(
      "SELECT kind,SUM(count) AS n FROM usage_daily WHERE day=? GROUP BY kind",
    )
    .bind(today.day)
    .all<{ kind: UsageKind; n: number }>();
  for (const row of todayRows) {
    const count = Number(row.n ?? 0);
    if (row.kind === "profile_open") today.profileOpens += count;
    else if (row.kind === "link_action") today.linkActions += count;
    else today.shareActions += count;
  }
  const { results: cards } = await db
    .prepare(
      "SELECT id,title FROM cards WHERE status='published' ORDER BY position,id LIMIT 64",
    )
    .all<{ id: string; title: string }>();
  const { results: savedLinks } = await db
    .prepare(
      "SELECT key,SUM(count) AS n FROM usage_daily WHERE kind='link_action' AND day>=? AND day<? GROUP BY key",
    )
    .bind(window.start, window.end)
    .all<{ key: string; n: number }>();
  const linkCounts = new Map(
    savedLinks.map((row) => [row.key, Number(row.n ?? 0)]),
  );
  const links = cards
    .map((card, index) => ({
      id: card.id,
      title: card.title,
      count: linkCounts.get(card.id) ?? 0,
      index,
    }))
    .filter((link) => link.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map(({ id, title, count }) => ({ id, title, count }));
  return {
    settings,
    window,
    totals,
    today,
    days: series,
    links,
    definition: usageDefinition,
    quality: [
      "Only complete UTC days are included. Today is excluded until it ends.",
      "No IP address, user agent, referrer, cookie, session or visitor identifier is stored.",
      "Only successful public homepage HTML responses count as profile opens; owner studio, API, asset, member-profile, bot-prefetch, HEAD and error responses are excluded.",
      "Automated user agents that identify themselves and synthetic release probes are skipped conservatively. Some automated traffic may still be counted, and some real traffic may be missing.",
      `Counts stop at ${usageCountLimit} per day, kind and key.`,
      `Recording is ${settings.enabled ? "on" : "off"}. Existing totals are retained when recording is off or the public proof is withdrawn.`,
      "Per-link totals cover currently published cards only; totals for cards later hidden or removed remain in the aggregate link actions.",
      "No third-party analytics service is used.",
    ],
  };
}
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export function usageDateLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${months[month - 1]} ${year}`;
}
export function usageWindowLabel(window: UsageWindow) {
  return `${usageDateLabel(window.start)} – ${usageDateLabel(addUsageDays(window.end, -1))}`;
}
