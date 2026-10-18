import { json, error } from "./common.ts";
import {
  providerItem,
  type ProviderEnvironment,
  type ResourceSource,
} from "./item-provider.ts";

interface SavedCard {
  id: string;
  status: string;
}
type Environment = ProviderEnvironment & { DB: D1Database };

// A replay retains the original card ID. This source key cannot create two
// cards even when a committed INSERT acknowledgement is lost or concurrent.
export async function collectResourceItem(
  env: Environment,
  item: string,
  source: ResourceSource,
  status: "draft" | "published" | "hidden",
): Promise<Response> {
  const eligible = await providerItem(env, item, source).catch(() => null);
  if (!eligible)
    return error(
      "Choose a currently approved public contribution from this resource.",
      409,
    );
  const existing = () =>
    env.DB.prepare(
      "SELECT id,status FROM cards WHERE provider=? AND item_id=? AND source_resource=? AND source_configuration=?",
    )
      .bind(env.PROVIDER_ID, item, source.resource, source.configuration)
      .first<SavedCard>();
  const receipt = (
    saved: SavedCard,
    outcome: "applied" | "unchanged",
    code = 200,
  ) =>
    saved.status === status
      ? json({ ...saved, source, outcome }, code)
      : error(
          "This source is already collected. Refresh and choose its existing card before changing visibility.",
          409,
        );
  let previous: SavedCard | null;
  try {
    previous = await existing();
  } catch {
    return json(
      {
        source,
        outcome: "refused",
        message:
          "The saved collection could not be checked. No collection request was sent.",
      },
      503,
    );
  }
  if (previous) return receipt(previous, "unchanged");
  const id = crypto.randomUUID();
  try {
    // Scoped metadata is resolved at each read; it is never copied into storage.
    const created = await env.DB.prepare(
      "INSERT INTO cards(id,title,description,url,provider,item_id,position,status,source_resource,source_configuration) SELECT ?1,'','',NULL,?2,?3,COUNT(*),?4,?5,?6 FROM cards HAVING COUNT(*)<64 RETURNING id,status",
    )
      .bind(
        id,
        env.PROVIDER_ID,
        item,
        status,
        source.resource,
        source.configuration,
      )
      .first<SavedCard>();
    if (created) return receipt(created, "applied", 201);
    return error(
      "This collection has 64 cards; remove one before adding another.",
      409,
    );
  } catch {
    try {
      const confirmed = await existing();
      if (confirmed)
        return receipt(
          confirmed,
          confirmed.id === id ? "applied" : "unchanged",
        );
    } catch {
      /* An unavailable read cannot prove whether the INSERT committed. */
    }
    return json(
      {
        id,
        source,
        outcome: "unknown",
        message:
          "This card may already be collected. Check the saved collection before trying again.",
      },
      503,
    );
  }
}
