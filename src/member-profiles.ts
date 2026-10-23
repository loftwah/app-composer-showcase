// MIT. App-owned profile documents behind a narrow, server-to-server bridge.
// Membership/authentication are Composer's responsibility; stable ownership and
// every app resource comparison are enforced again here. No browser actor path.
import { json, error, readJSON, html, escape, safeURL } from "./common.ts";
import {
  profileConfiguration,
  profileFields,
  decoration,
  presentation,
  decorateCards,
  cardLimit,
  type Decoration,
} from "./profile.ts";
import { creatorProfile } from "./creator-profile.ts";
import { changeAchievements, readAchievements } from "./achievements.ts";
import { changeTags, readTags } from "./tags.ts";
import { publicAchievements } from "./achievement-view.ts";
import { publicTags } from "./tag-view.ts";
import {
  changeProfileSettings,
  exportProfileSettings,
} from "./profile-portability.ts";
import {
  shareCardSnapshot,
  changeShareCard,
  publicShareCardMetadata,
} from "./share-card.ts";
import {
  providerItem,
  resolveCard,
  exportCard,
  sourceSelection,
  type ProviderEnvironment,
} from "./item-provider.ts";
import {
  invitationSetting,
  readGuestbookInvitation,
  invitationHref,
  type InvitationSetting,
} from "./guestbook-invitation.ts";
import { contributionSection } from "./contribution-view.ts";
import { cardDestination } from "./card-view.ts";

export interface MemberProfileEnvironment extends ProviderEnvironment {
  DB: D1Database;
  PUBLIC_ORIGIN: string;
  PROFILE_ORIGIN?: string;
  ASSETS?: Fetcher;
  COMPOSER_ISSUER?: string;
  COMPOSER_PROFILE_BRIDGE_TOKEN?: string;
}
type Card = {
  id: string;
  title: string;
  description: string;
  url: string | null;
  provider: string | null;
  item_id: string | null;
  position: number;
  status: "draft" | "published" | "hidden";
  source_resource?: string;
  source_configuration?: number;
};
type Document = {
  version: 1;
  settings: Record<string, string>;
  cards: Card[];
  presentation: Record<string, Decoration>;
  invitation: InvitationSetting | null;
};
type Row = {
  id: string;
  owner_issuer: string;
  owner_subject: string;
  revision: number;
  handle: string | null;
  draft: string;
  published: string | null;
  published_revision: number | null;
  visibility: "draft" | "published" | "hidden";
};
class ProfileError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
const object = (input: unknown): Record<string, unknown> => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ProfileError("Use a supported profile command.");
  return input as Record<string, unknown>;
};
function keys(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new ProfileError("Use only the supported profile fields.");
}
function string(input: unknown, max: number) {
  if (
    typeof input !== "string" ||
    input.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)
  )
    throw new ProfileError("Check the profile text.");
  return input;
}
const identifier = (input: unknown): input is string =>
  typeof input === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input);
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const blankConfig = () => ({
  title: "Your profile",
  intro: "",
  theme: "daylight",
  layout: "profile",
  bluesky: "",
  ...Object.fromEntries(
    profileFields.map((field) => [field.key, field.default]),
  ),
});
const blank = (): Document => ({
  version: 1,
  settings: { config: JSON.stringify(blankConfig()) },
  cards: [],
  presentation: {},
  invitation: null,
});
function document(raw: string): Document {
  try {
    if (
      typeof raw !== "string" ||
      new TextEncoder().encode(raw).length > 512 * 1024
    )
      throw Error();
    const value = object(JSON.parse(raw));
    keys(value, ["version", "settings", "cards", "presentation", "invitation"]);
    const settings = object(value.settings);
    keys(settings, ["config", "profile-tags-v1", "profile-achievements-v1"]);
    if (
      value.version !== 1 ||
      typeof settings.config !== "string" ||
      Object.values(settings).some((value) => typeof value !== "string") ||
      !Array.isArray(value.cards) ||
      value.cards.length > cardLimit
    )
      throw Error();
    profileConfiguration(object(JSON.parse(settings.config)));
    const cards = value.cards.map((input) => {
      const card = object(input);
      keys(card, [
        "id",
        "title",
        "description",
        "url",
        "provider",
        "item_id",
        "position",
        "status",
        "source_resource",
        "source_configuration",
      ]);
      if (
        !identifier(card.id) ||
        typeof card.title !== "string" ||
        card.title.length > 100 ||
        typeof card.description !== "string" ||
        card.description.length > 240 ||
        !Number.isSafeInteger(card.position) ||
        Number(card.position) < 0 ||
        Number(card.position) >= cardLimit ||
        !["draft", "published", "hidden"].includes(String(card.status))
      )
        throw Error();
      if (card.provider === null) {
        if (
          !card.title.trim() ||
          card.item_id !== null ||
          card.source_resource !== undefined ||
          card.source_configuration !== undefined ||
          typeof card.url !== "string" ||
          safeURL(card.url) !== card.url
        )
          throw Error();
      } else {
        if (
          typeof card.provider !== "string" ||
          !card.provider ||
          card.provider.length > 80 ||
          typeof card.item_id !== "string" ||
          !/^[A-Za-z0-9-]{1,64}$/.test(card.item_id) ||
          card.url !== null
        )
          throw Error();
        sourceSelection({
          kind: "guestbook.resource",
          version: 1,
          resource: card.source_resource,
          configuration: card.source_configuration,
        });
      }
      return card as Card;
    });
    if (new Set(cards.map((card) => card.id)).size !== cards.length)
      throw Error();
    return {
      version: 1,
      settings: settings as Record<string, string>,
      cards,
      presentation: presentation(value.presentation),
      invitation:
        value.invitation === null ? null : invitationSetting(value.invitation),
    };
  } catch {
    throw new ProfileError(
      "The saved profile needs review. Nothing was changed.",
      503,
    );
  }
}
// Existing collection helpers operate on three exact settings rows. This local
// view never executes input SQL and never receives a global app DB. The complete
// document is committed once with a real SQLite CAS below, including helper writes.
function settingsView(doc: Document): D1Database {
  function statement(sql: string, bindings: unknown[] = []): unknown {
    return {
      bind: (...values: unknown[]) => statement(sql, values),
      async first() {
        if (/^SELECT value FROM settings WHERE id=/.test(sql)) {
          const key = sql.includes("id='config'")
            ? "config"
            : String(bindings[0]);
          return Object.hasOwn(doc.settings, key)
            ? { value: doc.settings[key] }
            : null;
        }
        if (sql.startsWith("INSERT INTO settings(id,value) SELECT ?1,?2")) {
          const [key, value, expected] = bindings;
          if (
            !["config", "profile-achievements-v1", "profile-tags-v1"].includes(
              String(key),
            )
          )
            throw Error("Unsupported profile setting.");
          if ((doc.settings[String(key)] ?? null) !== expected) return null;
          doc.settings[String(key)] = String(value);
          return { value };
        }
        throw Error("Unsupported profile setting operation.");
      },
    };
  }
  return { prepare: statement } as unknown as D1Database;
}
function config(doc: Document) {
  return JSON.parse(doc.settings.config) as Record<string, unknown>;
}
function cardEnv(env: MemberProfileEnvironment, doc: Document, id: string) {
  return {
    ...env,
    DB: settingsView(doc),
    PROFILE_ID:
      new URL(env.PROFILE_ORIGIN ?? env.PUBLIC_ORIGIN).origin +
      "/profiles/" +
      id,
  };
}
function safeConfig(
  input: unknown,
  current = blankConfig(),
): Record<string, unknown> {
  const value = object(input);
  keys(value, [
    "title",
    "intro",
    "theme",
    "layout",
    "bluesky",
    ...profileFields.map((field) => field.key),
  ]);
  return profileConfiguration({ ...current, ...value }, current);
}
function normalHandle(value: unknown) {
  const handle = string(value, 40).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(handle))
    throw new ProfileError(
      "Choose a public handle using letters, numbers, dots, underscores or hyphens.",
    );
  return handle;
}
async function publicDocument(doc: Document): Promise<Document> {
  const copy = structuredClone(doc),
    db = settingsView(copy);
  copy.cards = copy.cards.filter((card) => card.status === "published");
  copy.presentation = Object.fromEntries(
    Object.entries(copy.presentation).filter(([id]) =>
      copy.cards.some((card) => card.id === id),
    ),
  );
  const achievements = (await readAchievements(db)).collection,
    tags = (await readTags(db)).collection;
  achievements.items = achievements.items.filter(
    (item) => item.status === "published",
  );
  tags.items = tags.items.filter((item) => item.status === "published");
  copy.settings = {
    config: JSON.stringify({
      ...profileConfiguration(config(copy)),
      ...publicShareCardMetadata(config(copy)),
    }),
    "profile-achievements-v1": JSON.stringify(achievements),
    "profile-tags-v1": JSON.stringify(tags),
  };
  return copy;
}
async function privateReply(
  env: MemberProfileEnvironment,
  row: Row,
  doc = document(row.draft),
  base = "",
) {
  const db = settingsView(doc),
    shareCard = await shareCardSnapshot(
      cardEnv(env, doc, row.id),
      blankConfig(),
      base,
    );
  const publicURL = row.handle
    ? new URL(env.PUBLIC_ORIGIN).origin + base + "/p/" + row.handle + "/"
    : null;
  const publicConfig = config(doc),
    approved = (publicConfig._shareCard as { text?: unknown } | undefined)
      ?.text;
  return {
    ok: true,
    version: 1,
    resource: row.id,
    revision: row.revision,
    handle: row.handle,
    visibility: row.visibility,
    publishedRevision: row.published_revision,
    publicURL,
    hasUnpublishedChanges:
      row.published !== JSON.stringify(await publicDocument(doc)),
    draft: {
      config: profileConfiguration(publicConfig),
      cards: doc.cards,
      presentation: doc.presentation,
      tags: (await readTags(db)).collection,
      achievements: (await readAchievements(db)).collection,
      invitation: doc.invitation,
    },
    shareCard: {
      ...shareCard,
      stale: Boolean(
        shareCard.approved &&
        approved &&
        !equal(approved, {
          name: publicConfig.title,
          handle: publicConfig.handle,
          description: publicConfig.intro,
        }),
      ),
    },
  };
}
async function actorRow(
  env: MemberProfileEnvironment,
  actor: { issuer: string; subject: string },
  resource: unknown,
) {
  if (resource !== undefined && !identifier(resource))
    throw new ProfileError("Profile not found.", 404);
  const row = await env.DB.prepare(
    "SELECT * FROM member_profiles WHERE owner_issuer=? AND owner_subject=?" +
      (resource === undefined ? "" : " AND id=?"),
  )
    .bind(
      ...[
        actor.issuer,
        actor.subject,
        ...(resource === undefined ? [] : [resource]),
      ],
    )
    .first<Row>();
  if (!row && resource !== undefined)
    throw new ProfileError("Profile not found.", 404);
  return row;
}
async function mutateCard(
  doc: Document,
  input: unknown,
  env: MemberProfileEnvironment,
) {
  const b = object(input);
  keys(b, [
    "action",
    "id",
    "title",
    "description",
    "url",
    "status",
    "source",
    "item",
    "ids",
  ]);
  if (b.action === "reorder") {
    if (
      !Array.isArray(b.ids) ||
      b.ids.length !== doc.cards.length ||
      new Set(b.ids).size !== doc.cards.length ||
      b.ids.some((id) => !doc.cards.some((card) => card.id === id))
    )
      throw new ProfileError("Include every current link exactly once.");
    const ids = b.ids;
    doc.cards.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    doc.cards.forEach((card, i) => (card.position = i));
    return;
  }
  const existing =
    b.id === undefined ? undefined : doc.cards.find((card) => card.id === b.id);
  if (b.id !== undefined && !existing)
    throw new ProfileError("Link not found.", 404);
  if (b.action === "delete") {
    if (!existing) throw new ProfileError("Choose a current link.");
    doc.cards = doc.cards.filter((card) => card.id !== existing.id);
    delete doc.presentation[existing.id];
    return;
  }
  if (!["create", "edit", "visibility"].includes(String(b.action)))
    throw new ProfileError("Choose a supported link action.");
  if ((b.action === "create") === Boolean(existing))
    throw new ProfileError("Choose a new or current link.");
  const status = b.status ?? existing?.status ?? "draft";
  if (!["draft", "published", "hidden"].includes(String(status)))
    throw new ProfileError("Choose a supported link visibility.");
  if (b.action === "visibility") {
    if (!existing) throw new ProfileError("Choose a current link.");
    existing.status = status as Card["status"];
    return;
  }
  if (existing?.provider)
    throw new ProfileError(
      "The Guestbook owns this link text. Change its visibility or remove it here.",
    );
  if (existing && (b.source !== undefined || b.item !== undefined))
    throw new ProfileError("A source belongs to a new contribution card.");
  if (!existing && doc.cards.length >= cardLimit)
    throw new ProfileError("Keep up to 64 links.", 409);
  let next: Card;
  if (b.source !== undefined) {
    const source = sourceSelection(b.source),
      item = string(b.item, 64),
      current = await providerItem(env, item, source).catch(() => null);
    if (!current)
      throw new ProfileError(
        "Choose a currently approved public Guestbook contribution.",
        409,
      );
    if (
      doc.cards.some(
        (card) =>
          card.provider === current.provider &&
          card.item_id === item &&
          card.source_resource === source.resource &&
          card.source_configuration === source.configuration,
      )
    )
      throw new ProfileError(
        "This contribution is already in your collection.",
        409,
      );
    next = {
      id: crypto.randomUUID(),
      title: "",
      description: "",
      url: null,
      provider: current.provider,
      item_id: item,
      source_resource: source.resource,
      source_configuration: source.configuration,
      position: doc.cards.length,
      status: status as Card["status"],
    };
  } else {
    if (b.item !== undefined)
      throw new ProfileError("Choose an exact Guestbook source.");
    const title = string(b.title ?? existing?.title, 100).trim(),
      description = string(b.description ?? existing?.description ?? "", 240),
      url = safeURL(string(b.url ?? existing?.url, 2048));
    if (!title || url.length > 2048)
      throw new ProfileError(
        "Give the link a title and a public HTTPS destination.",
      );
    next = {
      id: existing?.id ?? crypto.randomUUID(),
      title,
      description,
      url,
      provider: null,
      item_id: null,
      position: existing?.position ?? doc.cards.length,
      status: status as Card["status"],
    };
  }
  if (existing) doc.cards[doc.cards.indexOf(existing)] = next;
  else doc.cards.push(next);
}
async function tokenEqual(actual: string, expected: string) {
  const hash = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export async function memberProfileBridge(
  req: Request,
  env: MemberProfileEnvironment,
  base: string,
  source: string,
) {
  if (!env.COMPOSER_PROFILE_BRIDGE_TOKEN || !env.COMPOSER_ISSUER)
    return error("Not found", 404);
  if (req.method !== "POST")
    return new Response(null, {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  const url = new URL(req.url);
  if (
    !(await tokenEqual(
      req.headers.get("Authorization") ?? "",
      "Bearer " + env.COMPOSER_PROFILE_BRIDGE_TOKEN,
    ))
  )
    return error("Profile service authority required.", 403);
  if (
    req.headers.get("X-Composer-Source") !== source ||
    req.headers.get("X-Composer-Target") !== url.origin + base
  )
    return error(
      "The profile service source or target changed. Review the active app before retrying.",
      409,
    );
  try {
    const b = object(await readJSON(req, 192 * 1024));
    keys(b, [
      "version",
      "actor",
      "operation",
      "resource",
      "expectedRevision",
      "command",
    ]);
    const who = object(b.actor);
    keys(who, ["issuer", "subject"]);
    if (
      b.version !== 1 ||
      who.issuer !== env.COMPOSER_ISSUER ||
      typeof who.subject !== "string" ||
      !who.subject ||
      who.subject.length > 200 ||
      /[\u0000-\u001f]/.test(who.subject)
    )
      throw new ProfileError(
        "The authenticated installation account is invalid.",
        403,
      );
    const actor = { issuer: who.issuer as string, subject: who.subject },
      operation = String(b.operation);
    if (
      ![
        "create",
        "read",
        "config",
        "cards",
        "presentation",
        "tags",
        "achievements",
        "invitation",
        "share-card",
        "profile-settings",
        "export",
        "publish",
        "hide",
      ].includes(operation)
    )
      throw new ProfileError("Choose a supported profile action.");
    let row = await actorRow(env, actor, b.resource);
    if (operation === "create") {
      if (
        b.resource !== undefined ||
        b.expectedRevision !== undefined ||
        b.command !== undefined
      )
        throw new ProfileError("Create uses only the authenticated account.");
      if (row) return json(await privateReply(env, row, undefined, base));
      const id = crypto.randomUUID(),
        draft = JSON.stringify(blank());
      try {
        row = await env.DB.prepare(
          "INSERT INTO member_profiles(id,owner_issuer,owner_subject,draft) VALUES(?,?,?,?) ON CONFLICT(owner_issuer,owner_subject) DO NOTHING RETURNING *",
        )
          .bind(id, actor.issuer, actor.subject, draft)
          .first<Row>();
      } catch {
        throw new ProfileError(
          "Profile creation could not be confirmed. Check your saved profile before trying again.",
          503,
        );
      }
      row ??= await actorRow(env, actor, undefined);
      if (!row)
        throw new ProfileError(
          "Profile creation could not be confirmed. Read your saved profile.",
          503,
        );
      return json(await privateReply(env, row, undefined, base), 201);
    }
    if (!row) {
      if (operation !== "read")
        throw new ProfileError("Create your profile first.", 404);
      return json({ ok: true, version: 1, profile: null });
    }
    const doc = document(row.draft);
    if (operation === "read")
      return json(await privateReply(env, row, doc, base));
    if (operation === "export") {
      return json({
        ok: true,
        version: 1,
        format: "linkarooie.profile-collection",
        resource: row.id,
        config: profileConfiguration(config(doc)),
        cards: await Promise.all(
          doc.cards.map((card) => exportCard(env, card)),
        ),
        presentation: doc.presentation,
        tagCollection: (await readTags(settingsView(doc))).collection,
        achievementCollection: (await readAchievements(settingsView(doc)))
          .collection,
        invitation: doc.invitation,
      });
    }
    if (
      operation === "profile-settings" &&
      object(b.command).action === "export"
    ) {
      keys(object(b.command), ["action"]);
      return json({
        ...(await privateReply(env, row, doc, base)),
        result: {
          file: await exportProfileSettings(settingsView(doc), blankConfig()),
        },
      });
    }
    if (
      !Number.isSafeInteger(b.expectedRevision) ||
      b.expectedRevision !== row.revision
    )
      throw new ProfileError(
        "Your profile changed. Compare the saved version before trying again.",
        409,
      );
    let result: unknown;
    if (operation === "config")
      doc.settings.config = JSON.stringify({
        ...config(doc),
        ...safeConfig(b.command, config(doc) as ReturnType<typeof blankConfig>),
      });
    if (operation === "cards") await mutateCard(doc, b.command, env);
    if (operation === "presentation") {
      const input = object(b.command);
      keys(input, ["id", "pinned", "icon", "group"]);
      if (!doc.cards.some((card) => card.id === input.id))
        throw new ProfileError("Link not found.", 404);
      const { id, ...fields } = input;
      doc.presentation[String(id)] = decoration(fields);
      if (
        Object.values(doc.presentation).filter((value) => value.pinned).length >
        8
      )
        throw new ProfileError("Feature up to eight links.", 409);
    }
    if (operation === "tags")
      result = await changeTags(settingsView(doc), b.command);
    if (operation === "achievements")
      result = await changeAchievements(settingsView(doc), b.command);
    if (operation === "share-card")
      result = await changeShareCard(
        cardEnv(env, doc, row.id),
        b.command,
        blankConfig(),
        base,
      );
    if (operation === "profile-settings")
      result = await changeProfileSettings(
        settingsView(doc),
        b.command,
        blankConfig(),
      );
    if (operation === "invitation") {
      const input = object(b.command);
      keys(
        input,
        input.action === "disable" ? ["action"] : ["action", "source"],
      );
      if (input.action === "disable") doc.invitation = null;
      else if (input.action === "enable") {
        const setting = invitationSetting({ version: 1, source: input.source });
        if (
          !(await readGuestbookInvitation(env, setting.source).catch(
            () => null,
          ))
        )
          throw new ProfileError("The selected Guestbook is unavailable.", 503);
        doc.invitation = setting;
      } else throw new ProfileError("Choose whether to invite notes.");
    }
    const raw = JSON.stringify(doc);
    if (new TextEncoder().encode(raw).length > 512 * 1024)
      throw new ProfileError("Your profile exceeds the supported size.");
    const publish = operation === "publish",
      hide = operation === "hide",
      handle = publish ? normalHandle(config(doc).handle) : row.handle;
    const published = publish
      ? JSON.stringify(await publicDocument(doc))
      : row.published;
    // Read-only settings review stays read-only, including its outer revision.
    if (
      operation === "profile-settings" &&
      object(b.command).action === "review"
    )
      return json({
        ...(await privateReply(env, row, document(row.draft), base)),
        result,
      });
    let saved: Row | null;
    try {
      saved = await env.DB.prepare(
        "UPDATE member_profiles SET draft=?,revision=revision+1,handle=?,published=?,published_revision=?,visibility=? WHERE id=? AND owner_issuer=? AND owner_subject=? AND revision=? AND draft=? RETURNING *",
      )
        .bind(
          raw,
          handle,
          published,
          publish ? row.revision + 1 : row.published_revision,
          publish ? "published" : hide ? "hidden" : row.visibility,
          row.id,
          actor.issuer,
          actor.subject,
          row.revision,
          row.draft,
        )
        .first<Row>();
    } catch (failure) {
      if (
        failure instanceof Error &&
        /UNIQUE constraint.*handle/i.test(failure.message)
      )
        throw new ProfileError(
          "This public handle is already in use. Choose another.",
          409,
        );
      throw new ProfileError(
        "The save could not be confirmed. Read your saved profile before retrying.",
        503,
      );
    }
    if (!saved)
      throw new ProfileError(
        "Your profile changed during this operation. Compare the saved version.",
        409,
      );
    return json({
      ...(await privateReply(env, saved, doc, base)),
      ...(result === undefined ? {} : { result }),
    });
  } catch (failure) {
    const code =
      failure && typeof failure === "object" && "status" in failure
        ? Number(failure.status)
        : 400;
    return error(
      failure instanceof Error
        ? failure.message
        : "The profile command failed.",
      [400, 403, 404, 409, 503].includes(code) ? code : 400,
    );
  }
}
export async function publicMemberProfile(
  req: Request,
  env: MemberProfileEnvironment,
  base: string,
  path: string,
) {
  if (!["GET", "HEAD"].includes(req.method))
    return new Response(null, {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  const match = /^\/p\/([a-z0-9][a-z0-9._-]{0,39})\/(api\/profile)?$/.exec(
    path,
  );
  if (!match) return error("Profile not found.", 404);
  const row = await env.DB.prepare(
    "SELECT id,handle,published,published_revision FROM member_profiles WHERE handle=? AND visibility='published'",
  )
    .bind(match[1])
    .first<Pick<Row, "id" | "handle" | "published" | "published_revision">>();
  if (!row?.published) return error("Profile not found.", 404);
  const doc = document(row.published),
    db = settingsView(doc),
    profile: Record<string, unknown> = {
      ...profileConfiguration(config(doc)),
      ...publicShareCardMetadata(config(doc)),
    };
  const resolved = decorateCards(
    (
      await Promise.all(
        doc.cards.map((card) => resolveCard(env, card).catch(() => null)),
      )
    ).filter((card) => card !== null),
    doc.presentation,
  );
  const url =
    new URL(env.PUBLIC_ORIGIN).origin + base + "/p/" + row.handle + "/";
  let response: Response;
  if (match[2])
    response = json({
      version: 1,
      profile: {
        resource: row.id,
        revision: row.published_revision,
        config: profile,
        cards: resolved,
        tags: (await readTags(db)).collection.items,
        achievements: (await readAchievements(db)).collection.items,
      },
      canonical: url,
    });
  else {
    const invitation = doc.invitation
      ? await readGuestbookInvitation(env, doc.invitation.source).catch(
          () => null,
        )
      : null;
    const contribution = contributionSection(
      doc.invitation ? (invitation ?? { state: "unavailable" }) : null,
      (value) => invitationHref(env, value, base),
    );
    const share = `<div class="profile-share"><button type="button" class="secondary" data-share-profile hidden>Share profile</button><button type="button" class="secondary" data-copy-profile hidden>Copy profile link</button><p role="status" aria-live="polite" data-share-status></p><label data-share-fallback hidden>Published profile URL<input readonly value="${escape(url)}"></label></div><script type="module" src="${base}/brand/profile-share.js"></script>`;
    const body = creatorProfile(
      profile,
      resolved,
      base,
      share,
      publicTags((await readTags(db)).collection, base),
      publicAchievements((await readAchievements(db)).collection),
      (card) => cardDestination(card, base, env.PROVIDER_MOUNT ?? "/guestbook"),
      contribution,
    ).replace(
      `href="${base}/owner"`,
      `href="${escape(env.COMPOSER_ISSUER ?? "https://composer.loftwah.com")}/me"`,
    );
    response = html(
      String(profile.title),
      body,
      base,
      "showcase",
      String(profile.theme),
      String(profile.intro),
      env.PUBLIC_ORIGIN,
      "/p/" + row.handle + "/",
      env.PROVIDER_ORIGIN,
      profile,
    );
    const content = await response.text();
    response = new Response(
      content.replace(
        "</head>",
        `<meta name="linkarooie:profile-revision" content="${row.published_revision}"></head>`,
      ),
      { status: response.status, headers: response.headers },
    );
  }
  response.headers.set("Cache-Control", "no-store");
  return req.method === "HEAD"
    ? new Response(null, { headers: response.headers })
    : response;
}
