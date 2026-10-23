// MIT. Deliberate activation of a deployed immutable image; no generation on reads.
import {
  imageDimensions,
  validateCardPNG,
} from "../public/brand/share-image.mjs";
import { replaceCollectionSetting } from "./settings-collection.ts";
export class ShareCardError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
type Image = {
  path: string;
  sha256: string;
  type: string;
  width: number;
  height: number;
  alt: string;
};
type SavedCard = {
  image: Image;
  sourceRevision: string;
  text: { name: string; handle: string; description: string };
};
type Previous = { shareImage: string; approved: SavedCard | null };
type Environment = {
  DB: D1Database;
  PUBLIC_ORIGIN: string;
  PROFILE_ORIGIN?: string;
  ASSETS?: Fetcher;
};
const digest = async (value: Uint8Array | string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      ),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ShareCardError("Choose a supported Launch Kit receipt.");
  return value as Record<string, unknown>;
};
function exact(value: unknown, keys: string[]) {
  const b = object(value);
  if (
    Object.keys(b).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(b, k))
  )
    throw new ShareCardError("Choose a supported Launch Kit receipt.");
  return b;
}
function validImage(value: unknown): Image {
  const b = exact(value, ["path", "sha256", "type", "width", "height", "alt"]);
  if (
    typeof b.sha256 !== "string" ||
    !/^\w{64}$/.test(b.sha256) ||
    !/^[a-f0-9]{64}$/.test(b.sha256) ||
    b.path !== "/brand/generated/profile-" + b.sha256 + ".png" ||
    b.type !== "image/png" ||
    b.width !== 1200 ||
    b.height !== 630 ||
    typeof b.alt !== "string" ||
    !b.alt.trim() ||
    b.alt.length > 500
  )
    throw new ShareCardError(
      "Use the inspected 1200 × 630 PNG and its original Launch Kit receipt.",
    );
  return b as Image;
}
async function read(env: Environment, defaults: Record<string, unknown>) {
  try {
    const row = await env.DB.prepare(
        "SELECT value FROM settings WHERE id='config'",
      ).first<{ value: string }>(),
      raw = row?.value ?? null;
    if (
      raw !== null &&
      (typeof raw !== "string" || new TextEncoder().encode(raw).length > 65536)
    )
      throw Error();
    const stored = raw === null ? {} : object(JSON.parse(raw)),
      config = { ...defaults, ...stored };
    for (const key of ["title", "intro", "handle", "shareImage"])
      if (typeof config[key] !== "string") throw Error();
    return {
      raw,
      stored,
      config,
      revision: await digest(raw ?? "linkarooie:default-profile-v1"),
    };
  } catch {
    throw new ShareCardError(
      "The saved profile needs review or is unavailable. Nothing was changed.",
      503,
    );
  }
}
function approved(config: Record<string, unknown>): SavedCard | null {
  try {
    const saved = object(config._shareCard) as unknown as SavedCard;
    validImage(saved.image);
    if (
      config.shareImage !== saved.image.path &&
      config.shareImage !==
        new URL(saved.image.path, String(config._shareCardOrigin)).href
    )
      return null;
    return saved;
  } catch {
    return null;
  }
}
function snapshot(
  env: Environment,
  state: Awaited<ReturnType<typeof read>>,
  base = "",
) {
  const origin = new URL(env.PUBLIC_ORIGIN).origin,
    card = approved(state.config),
    manual = String(state.config.shareImage),
    current = card ? origin + base + card.image.path : manual;
  const prev = state.config._shareCardPrevious;
  return {
    version: 1,
    profile: {
      id: new URL(env.PROFILE_ORIGIN ?? env.PUBLIC_ORIGIN).origin + "/",
      revision: state.revision,
      name: String(state.config.title),
      handle: String(state.config.handle),
      description: String(state.config.intro),
      shareImage:
        current || origin + base + "/brand/linkarooie-share-20261018.jpg",
    },
    approved: card?.image ?? null,
    previous: prev
      ? {
          shareImage: String(object(prev).shareImage ?? ""),
          approved: (object(prev).approved as SavedCard | null)?.image ?? null,
        }
      : null,
  };
}
export async function shareCardSnapshot(
  env: Environment,
  defaults: Record<string, unknown>,
  base = "",
) {
  return snapshot(env, await read(env, defaults), base);
}
export async function changeShareCard(
  env: Environment,
  input: unknown,
  defaults: Record<string, unknown>,
  base = "",
) {
  const command = object(input),
    action = command.action;
  exact(
    command,
    action === "adopt"
      ? ["action", "expectedRevision", "receipt"]
      : ["action", "expectedRevision"],
  );
  if (
    !["adopt", "rollback"].includes(String(action)) ||
    typeof command.expectedRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(command.expectedRevision)
  )
    throw new ShareCardError(
      "Review the current saved profile before changing its share image.",
    );
  const current = await read(env, defaults),
    origin = new URL(env.PUBLIC_ORIGIN).origin,
    identity = new URL(env.PROFILE_ORIGIN ?? env.PUBLIC_ORIGIN).origin;
  let image: Image | null = null,
    card: SavedCard | null = null;
  if (action === "adopt") {
    const receipt = exact(command.receipt, [
      "format",
      "version",
      "profile",
      "image",
      "text",
      "preset",
      "renderer",
    ]);
    const profile = exact(receipt.profile, ["id", "revision"]),
      text = exact(receipt.text, ["name", "handle", "description"]),
      preset = exact(receipt.preset, ["id", "version"]),
      renderer = exact(receipt.renderer, [
        "id",
        "version",
        "font",
        "fontSha256",
      ]);
    if (
      receipt.format !== "linkarooie.share-card" ||
      receipt.version !== 1 ||
      profile.id !== identity + "/" ||
      profile.revision !== command.expectedRevision ||
      typeof preset.id !== "string" ||
      !["typography", "portrait", "editorial", "music", "artwork"].includes(
        preset.id,
      ) ||
      preset.version !== 1 ||
      renderer.id !== "launch-kit-profile" ||
      renderer.version !== "1.0.0" ||
      renderer.font !== "Space Grotesk Latin 20261018" ||
      renderer.fontSha256 !==
        "61d00a1c57fcd7d4826c7a69cd85b61d15d133d5471d3c9c4731d70193d9f71f"
    )
      throw new ShareCardError(
        "Use a current Launch Kit receipt for this exact profile.",
      );
    image = validImage(receipt.image);
    if (
      text.name !== current.config.title ||
      text.handle !== current.config.handle ||
      text.description !== current.config.intro
    )
      throw new ShareCardError(
        "The saved profile text differs from this card. Save your intended profile text, then render a new card.",
        409,
      );
    const saved = approved(current.config);
    if (
      saved?.image.sha256 === image.sha256 &&
      saved.sourceRevision === command.expectedRevision
    )
      return {
        ...snapshot(env, current, base),
        ok: true,
        published: true,
        verified: false,
      };
    card = {
      image,
      sourceRevision: command.expectedRevision,
      text: text as SavedCard["text"],
    };
  }
  if (current.revision !== command.expectedRevision)
    throw new ShareCardError(
      "The profile or its media changed. Compare the saved profile and render again before replacing the image.",
      409,
    );
  let next: Record<string, unknown>;
  if (action === "rollback") {
    const previous = object(current.config._shareCardPrevious) as Previous;
    if (typeof previous.shareImage !== "string")
      throw new ShareCardError("No previous approved image is available.");
    if (previous.approved) validImage(previous.approved.image);
    next = {
      ...current.stored,
      shareImage: previous.shareImage,
      _shareCard: previous.approved,
      _shareCardPrevious: {
        shareImage: current.config.shareImage,
        approved: approved(current.config),
      },
    };
  } else {
    if (!env.ASSETS)
      throw new ShareCardError(
        "Deploy the prepared image through this app’s existing release route before applying it.",
        409,
      );
    let response: Response;
    try {
      response = await env.ASSETS.fetch(
        new Request(origin + image!.path, {
          redirect: "manual",
          signal: AbortSignal.timeout(10000),
        }),
      );
    } catch {
      throw new ShareCardError(
        "The prepared image is unavailable. Your approved image is unchanged.",
        503,
      );
    }
    if (
      response.status !== 200 ||
      Number(response.headers.get("content-length")) >= 5 * 1024 ** 2
    )
      throw new ShareCardError(
        "This immutable image is not deployed yet. Your approved image is unchanged.",
        409,
      );
    if (
      (response.headers.get("content-type") ?? "").split(";")[0].trim() !==
      image!.type
    )
      throw new ShareCardError(
        "The deployed image has an unexpected content type. Nothing was changed.",
        409,
      );
    if (!response.body)
      throw new ShareCardError(
        "The deployed image is empty. Nothing was changed.",
        409,
      );
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size >= 5 * 1024 ** 2)
          throw new ShareCardError(
            "The deployed image is too large. Nothing was changed.",
            409,
          );
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let dimensions;
    try {
      dimensions = imageDimensions(bytes);
      await validateCardPNG(bytes);
    } catch {
      throw new ShareCardError(
        "The deployed image could not be verified. Nothing was changed.",
        409,
      );
    }
    if (
      dimensions.format !== image!.type ||
      dimensions.width !== image!.width ||
      dimensions.height !== image!.height ||
      (await digest(bytes)) !== image!.sha256
    )
      throw new ShareCardError(
        "The deployed bytes differ from the inspected image. Nothing was changed.",
        409,
      );
    next = {
      ...current.stored,
      shareImage: identity + image!.path,
      _shareCardOrigin: identity,
      _shareCard: card,
      _shareCardPrevious: {
        shareImage: current.config.shareImage,
        approved: approved(current.config),
      },
    };
  }
  const raw = JSON.stringify(next);
  if (new TextEncoder().encode(raw).length > 65536)
    throw new ShareCardError(
      "The saved profile is too large. Nothing was changed.",
    );
  let saved;
  try {
    saved = await replaceCollectionSetting(env.DB, "config", current.raw, raw);
  } catch {
    throw new ShareCardError(
      "The result could not be confirmed. Read the saved profile before retrying.",
      503,
    );
  }
  if (!saved)
    throw new ShareCardError(
      "The profile changed during verification. Read the saved profile and compare before trying again.",
      409,
    );
  return {
    ...snapshot(
      env,
      {
        raw,
        stored: next,
        config: { ...defaults, ...next },
        revision: await digest(raw),
      },
      base,
    ),
    ok: true,
    published: true,
    verified: false,
  };
}
export function publicShareCardMetadata(config: Record<string, unknown>) {
  const card = approved(config);
  return card
    ? {
        _shareCard: { image: card.image },
        _shareCardOrigin: config._shareCardOrigin,
      }
    : {};
}
