// A source reference chooses records inside the one configured app binding.
// It never supplies an origin, request header, account or execution authority.
export interface ProviderEnvironment {
  ITEM_PROVIDER: Fetcher;
  PROVIDER_ORIGIN: string;
  PROVIDER_ID: string;
  PROVIDER_BASE?: string;
  PROVIDER_MOUNT?: string;
}
export interface ResourceSource {
  kind: "guestbook.resource";
  version: 1;
  resource: string;
  configuration: number;
}
export interface ProviderItem {
  contract: 1;
  provider: string;
  id: string;
  title: string;
  description: string;
  visibility: "public";
  image: string;
  url: string;
  resource?: string;
}
type Row = Record<string, unknown>;
export interface SourceCard extends Row {
  id: string;
}
const record = (value: unknown): Row | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
const resourceID = /^[a-z0-9-]{6,64}$/;
const itemID = /^[A-Za-z0-9-]{1,64}$/;

export class SourceSelectionError extends Error {}

export function sourceSelection(value: unknown): ResourceSource {
  const source = record(value);
  if (
    !source ||
    Object.keys(source).sort().join(",") !==
      "configuration,kind,resource,version" ||
    source.kind !== "guestbook.resource" ||
    source.version !== 1 ||
    typeof source.resource !== "string" ||
    !resourceID.test(source.resource) ||
    !Number.isSafeInteger(source.configuration) ||
    Number(source.configuration) < 1
  )
    throw new SourceSelectionError(
      "Choose an exact supported Guestbook resource and activated configuration.",
    );
  return {
    kind: "guestbook.resource",
    version: 1,
    resource: source.resource,
    configuration: Number(source.configuration),
  };
}

export function querySource(
  params: URLSearchParams,
): ResourceSource | undefined {
  if (!params.has("source")) {
    if (params.size)
      throw new SourceSelectionError("The source selection is invalid.");
    return undefined;
  }
  const value = params.get("source")!;
  if (
    value.length > 512 ||
    params.size !== 1 ||
    params.getAll("source").length !== 1
  )
    throw new SourceSelectionError("The source selection is invalid.");
  try {
    return sourceSelection(JSON.parse(value));
  } catch {
    throw new SourceSelectionError(
      "Choose an exact supported Guestbook resource and activated configuration.",
    );
  }
}

// Only a wholly absent reference is legacy. Partial or corrupt stored authority
// must not silently resolve the same item ID through the global provider.
export function storedSource(row: Row): ResourceSource | undefined {
  if (row.source_resource == null && row.source_configuration == null)
    return undefined;
  return sourceSelection({
    kind: "guestbook.resource",
    version: 1,
    resource: row.source_resource,
    configuration: row.source_configuration,
  });
}

export function providerLocation(env: ProviderEnvironment) {
  const origin = new URL(env.PROVIDER_ORIGIN);
  const base = env.PROVIDER_BASE ?? "";
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (origin.pathname !== "/" && origin.pathname !== "") ||
    (base !== "" && !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(base))
  )
    throw Error("The configured provider location is invalid.");
  return { origin: origin.origin, base };
}

function prefix(source?: ResourceSource) {
  return source ? `/r/${source.resource}/c/${source.configuration}` : "";
}

async function readProvider(
  env: ProviderEnvironment,
  path: string,
  source?: ResourceSource,
): Promise<Row | null> {
  if (source && env.PROVIDER_ID !== "guestbook") return null;
  const { origin, base } = providerLocation(env);
  const response = await env.ITEM_PROVIDER.fetch(
    new Request(origin + base + prefix(source) + path, {
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    }),
  );
  if (!response.ok) return null;
  const body = record(await response.json());
  if (
    !body ||
    body.contract !== 1 ||
    body.provider !== env.PROVIDER_ID ||
    (source ? body.resource !== source.resource : body.resource !== undefined)
  )
    return null;
  return body;
}

function eligibleItem(
  env: ProviderEnvironment,
  value: unknown,
  source?: ResourceSource,
): ProviderItem | null {
  const item = record(value);
  if (
    !item ||
    item.contract !== 1 ||
    item.provider !== env.PROVIDER_ID ||
    item.visibility !== "public" ||
    typeof item.id !== "string" ||
    !itemID.test(item.id) ||
    typeof item.title !== "string" ||
    item.title.length > 160 ||
    typeof item.description !== "string" ||
    item.description.length > 240 ||
    typeof item.url !== "string" ||
    typeof item.image !== "string" ||
    (source ? item.resource !== source.resource : item.resource !== undefined)
  )
    return null;
  const { origin, base } = providerLocation(env);
  let url: URL, image: URL;
  try {
    url = new URL(item.url);
    image = new URL(item.image);
  } catch {
    return null;
  }
  if (
    url.origin !== origin ||
    image.origin !== origin ||
    url.username ||
    url.password ||
    image.username ||
    image.password
  )
    return null;
  if (
    source &&
    (url.href !== origin + base + prefix(source) + "/item/" + item.id ||
      image.href !== origin + base + `/r/${source.resource}/media/${item.id}`)
  )
    return null;
  return {
    contract: 1,
    provider: env.PROVIDER_ID,
    id: item.id,
    title: item.title,
    description: item.description,
    visibility: "public",
    image: image.href,
    url: url.href,
    ...(source ? { resource: source.resource } : {}),
  };
}

export async function providerItem(
  env: ProviderEnvironment,
  id: string,
  source?: ResourceSource,
) {
  if (!itemID.test(id)) return null;
  const body = await readProvider(env, "/api/items/" + id, source);
  const item = eligibleItem(env, body, source);
  return item?.id === id ? item : null;
}

export async function providerItems(
  env: ProviderEnvironment,
  source?: ResourceSource,
) {
  const body = await readProvider(env, "/api/items", source);
  if (!body || !Array.isArray(body.items) || body.items.length > 200)
    return null;
  const items = body.items.map((item) => eligibleItem(env, item, source));
  if (
    items.some((item) => item === null) ||
    new Set(items.map((item) => item?.id)).size !== items.length
  )
    return null;
  return {
    contract: 1,
    provider: env.PROVIDER_ID,
    ...(source ? { source, resource: source.resource } : {}),
    items: items.filter((item): item is ProviderItem => item !== null),
  };
}

export async function resolveCard(
  env: ProviderEnvironment,
  value: unknown,
): Promise<SourceCard | null> {
  const card = record(value);
  if (!card || typeof card.id !== "string") return null;
  if (!card.provider) {
    if (card.source_resource != null || card.source_configuration != null)
      return null;
    return { ...card, id: card.id, image: null };
  }
  if (card.provider !== env.PROVIDER_ID || typeof card.item_id !== "string")
    return null;
  const source = storedSource(card);
  const item = await providerItem(env, card.item_id, source);
  return item
    ? {
        ...card,
        id: card.id,
        title: item.title,
        description: item.description,
        url: item.url,
        image: item.image,
        ...(source ? { source } : {}),
      }
    : null;
}

export async function exportCard(
  env: ProviderEnvironment,
  value: unknown,
): Promise<SourceCard | null> {
  const card = record(value);
  if (!card || typeof card.id !== "string") return null;
  // Legacy owner records retain their existing portable representation.
  if (card.source_resource == null && card.source_configuration == null)
    return { ...card, id: card.id };
  const resolved = await resolveCard(env, card).catch(() => null);
  if (resolved) return { ...resolved, sourceState: "available" };
  let source: ResourceSource | undefined;
  try {
    source = storedSource(card);
  } catch {
    /* Preserve corrupt reference for owner review without resolving legacy. */
  }
  return {
    ...(source ? { source } : {}),
    id: card.id,
    provider: card.provider,
    item_id: card.item_id,
    source_resource: card.source_resource,
    source_configuration: card.source_configuration,
    position: card.position,
    status: card.status,
    sourceState: "unavailable",
  };
}
