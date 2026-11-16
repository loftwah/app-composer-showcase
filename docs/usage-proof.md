# Opt-in usage proof contract

Reviewed 16 November 2026. This is the complete contract for Linkarooie's own
in-app, owner-facing aggregate usage surface. It replaces the previous “no
visitor/action tracker” statement only for this narrow, owner-operated proof:
no third-party service, no cross-site tracking and no visitor identity are
introduced. It is separate from the pre-existing optional server-only daily
publisher (`USAGE_ENDPOINT`, with no third-party default) described in README;
that publisher neither reads nor writes the tables and endpoints below.

## What is stored

Forward migration `0004_usage.sql` adds two tables. Both are app-owned D1 data.

```sql
usage_daily(day, kind, key, count)
  PRIMARY KEY(day, kind, key)
usage_settings(id = 1, enabled, public_block, updated_at)
```

- `day` is one real `YYYY-MM-DD` UTC day.
- `kind` is exactly `profile_open`, `link_action` or `share_action`.
- `key` is at most 64 characters: `profile`, a published card id, or a share
  method (`copy`, `native`, `download`). It is never a URL.
- `count` is a positive integer capped at 100,000 per day, kind and key.
- `usage_settings` is seeded with `enabled = 0` and `public_block = 0`, so a new
  deployment and every existing deployment record nothing until an owner opts in.

No column can store an IP address, user agent, referrer, cookie, session,
visitor identifier, raw URL or query string. This feature writes no request
metadata to logs and has no third-party endpoint or SDK. The existing IP-keyed
`rate_limits` table is deliberately not used by the public usage endpoint,
because a hashed client address would contradict this boundary. Abuse control
is bounded instead by the 1 KiB body limit, allowlisted fields and the daily cap.

There is no automatic retention or deletion job. Rows remain until the owner
removes them directly in the app's D1. Disabling recording or withdrawing the
public block deletes nothing.

## Recording rules

### Profile opens

The Worker records one `profile_open` after a response only when every condition
holds:

- method is `GET`, not `HEAD`;
- the route is the public homepage `/` in this app's mount, not owner studio,
  API, static asset, member profile, launch-kit example or an error;
- the response status is 200 and its content type is HTML;
- `Sec-Fetch-Dest`, when present, is `document`;
- `X-Composer-Verification: 1` is absent (synthetic release probes);
- the user agent does not identify itself as automation using a deliberately
  narrow reviewed pattern (`bot`, `crawler`, `spider`, `headlesschrome`,
  `phantomjs`, named search/social fetchers such as Googlebot, Bingbot,
  Twitterbot, LinkedInBot, Discordbot and Slackbot, and `curl`/`wget`).

Missing or unfamiliar user agents and missing `Sec-Fetch-Dest` are counted.
This is a request count: a reload counts again, the owner's own public visits
count too, some automation may still be counted and some real traffic may be
missed. The recording write is awaited after the response is produced and is
swallowed on failure, so storage trouble never changes the page response.

### Link and share actions

`POST /api/usage/action` is the only public write.

- Same-origin only: `Origin` must exactly match the request origin. A bearer
  token does not bypass this check.
- JSON body, maximum 1 KiB. Malformed JSON returns 400; an oversized body
  returns 413; another method returns 405; a foreign origin returns 403.
- `{kind:"link_action", card:"<card id>"}` records only when that exact card is
  currently published.
- `{kind:"share_action", method:"copy"|"native"|"download"}` records only an
  allowlisted method.
- Any other kind, missing field, unpublished/removed card, unsupported method
  or extra field is ignored without feedback. The response is still 204, so the
  public endpoint cannot be used to test whether a card is published.
- Recording is gated on `enabled = 1` inside the same UPSERT. A storage failure
  still returns 204.

Each accepted event is one SQL UPSERT. The conflict update stops at the cap:

```sql
INSERT INTO usage_daily(day,kind,key,count)
SELECT ?1,?2,?3,1 WHERE EXISTS(...enabled...)
ON CONFLICT(day,kind,key) DO UPDATE SET count=count+1 WHERE count<100000
```

Link actions also require `EXISTS(SELECT 1 FROM cards WHERE id=? AND status='published')`
in the same statement. No raw request data is accepted or logged.

### Client beacons

`public/brand/usage-beacon.js` is loaded on the public homepage only while
recording is enabled. It:

- sends a card id on an unmodified primary click (`button === 0`, no
  Meta/Ctrl/Shift/Alt) on a rendered published-card link;
- sends `copy` only after `navigator.clipboard.writeText` resolves, and `native`
  only after `navigator.share` resolves. A cancelled native share (`AbortError`)
  and its failure path send nothing;
- sends no destination URL, page URL, query string or visitor identifier;
- calls `navigator.sendBeacon` with a `fetch(..., {keepalive:true})` fallback,
  ignores all failures and never calls `preventDefault`, so navigation proceeds
  whether or not the beacon is accepted.

The sharing controller emits an app-local `linkarooie:share` event after a
successful copy or native share. Beacons are never sent for programmatic
prefetch, modified/middle-click activation or the manual-copy fallback. No
owner-only local opt-out is added.

## Owner analytics

`GET /api/usage?window=7|30|90` requires the owner session. An invalid window is
400. The response contains:

```json
{
  "contract": 1,
  "settings": {"enabled": true, "publicBlock": false, "updatedAt": "..."},
  "window": {"days": 30, "start": "2026-10-17", "end": "2026-11-16"},
  "totals": {"profileOpens": 0, "linkActions": 0, "shareActions": 0},
  "days": [{"day": "2026-10-17", "profileOpens": 0, "linkActions": 0, "shareActions": 0}],
  "links": [{"id": "published-card", "title": "Published link", "count": 2}],
  "definition": "Counted requests/actions, not people. ...",
  "quality": ["..."]
}
```

- `window.end` is today's UTC date and is exclusive, so only complete UTC days
  appear in `days` or contribute to totals.
- `links` contains only currently published cards with at least one action in
  the window. Actions recorded before a card was hidden or removed remain in
  aggregate link actions but are not ranked.
- Share actions are owner-only. Public responses never expose them.

`POST /api/usage` requires the owner session and an exactly matching `Origin`.
It accepts exactly `{enabled, publicBlock, expected:{enabled, publicBlock}}`.
All four values are booleans. The write is one compare-and-swap `UPDATE` against
the stored row; a stale `expected` returns 409, and `publicBlock: true` with
`enabled: false` returns 400. A missing settings row or missing table returns
503 with a safe message.

The owner studio renders a compact panel with the selected 7/30/90 window, three
totals, top links, an accessible `<details>` daily table with simple inline bars
(no chart library), the exact definition, an empty state, and two toggles with
saved/failed status. The public proof is independent: recording can stay enabled
while the block is withdrawn.

## Public proof

`GET /api/usage/public` returns only complete-day totals when both flags are on:

```json
{
  "contract": 1,
  "window": {"days": 30, "start": "2026-10-17", "end": "2026-11-16"},
  "totals": {"profileOpens": 12, "linkActions": 3},
  "definition": "Counted requests/actions, not people. ..."
}
```

Otherwise it returns 404. The homepage renders the same two numbers in a
`<section data-usage-block>` with an accessible `<h2>Usage proof</h2>`, the exact
30-complete-UTC-day window, the definition “Counted requests/actions, not
people”, and a zero state. It never renders share actions, per-link rankings,
draft/private card content or any visitor information. Withdrawal removes the
section immediately and retains owner totals.

## Definitions and limitations

**Counted requests/actions, not people.** A profile open is one successful
public homepage HTML response, not a person or a browser. A link action is one
primary activation of a currently published card link. A share action is one
successful copy or native share of the public profile. Multiple opens and
actions by the same reader count separately, and unique visitors cannot be
derived.

This proof cannot report acquisition, funnels, conversion, revenue, returning
readers, geography, devices, referrers or per-person journeys. It ignores Do Not
Track and Global Privacy Control, requires JavaScript for link/share actions,
depends on the browser sending `Origin` on same-origin POST, and relies on
conservative rather than exhaustive automation filtering. It is not a
replacement for provider-side or platform-side measurement.

## Operator steps

1. Apply forward migration `0004_usage.sql` before deploying the Worker.
2. Deploy with no new secret or third-party configuration.
3. In the owner studio, enable recording; the public block stays off until it is
   separately enabled.
4. Check `/api/usage?window=7` for complete-day totals and quality notes, and
   `/api/usage/public` for the exact public contract.
5. To withdraw the public proof, disable `publicBlock`; owner totals remain. To
   stop recording, disable `enabled`.
