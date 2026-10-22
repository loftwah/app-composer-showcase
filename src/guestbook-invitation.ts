// The Guestbook owns contribution intake, review and revocation. Linkarooie
// stores only an exact source reference and asks the source whether it currently
// accepts postcards. This module validates that small public contract and the
// owner's saved reference; it never copies contribution content or credentials.
import { json } from './common.ts';
import {
  providerLocation,
  sourceSelection,
  type ProviderEnvironment,
  type ResourceSource,
} from './item-provider.ts';

export type InvitationState = 'open' | 'paused' | 'closed' | 'full' | 'unavailable';
export interface GuestInvitation {
  state: InvitationState;
  configuration: number;
  contribute: string;
  collection: string;
}
export interface InvitationSetting {
  version: 1;
  source: ResourceSource;
}
const states = new Set(['open', 'paused', 'closed', 'full']);
const limits = { message: 160, alias: 60, width: 1200, height: 900, bytes: 100000 };
const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const settingError = 'Check the saved Guestbook invitation.';

export function invitationSetting(raw: unknown): InvitationSetting {
  const value = asObject(raw);
  if (
    !value ||
    Object.keys(value).sort().join(',') !== 'source,version' ||
    value.version !== 1
  )
    throw Error(settingError);
  return { version: 1, source: sourceSelection(value.source) };
}

export async function readInvitationSetting(
  db: D1Database,
): Promise<InvitationSetting | null> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE id='invitation'")
    .first<{ value: string }>();
  if (!row) return null;
  if (typeof row.value !== 'string' || row.value.length > 2048)
    throw Error(settingError);
  return invitationSetting(JSON.parse(row.value));
}

export async function changeInvitation(
  db: D1Database,
  command: unknown,
): Promise<InvitationSetting | null> {
  const value = asObject(command);
  if (!value || !['enable', 'disable'].includes(String(value.action)))
    throw Error('Choose whether to invite Guestbook contributions.');
  if (value.action === 'disable') {
    if (Object.keys(value).length !== 1) throw Error(settingError);
    await db.prepare("DELETE FROM settings WHERE id='invitation'").run();
    return null;
  }
  if (
    Object.keys(value).sort().join(',') !== 'action,source' ||
    value.action !== 'enable'
  )
    throw Error(settingError);
  const setting = invitationSetting({ version: 1, source: value.source });
  const bytes = JSON.stringify(setting);
  if (new TextEncoder().encode(bytes).byteLength > 2048)
    throw Error(settingError);
  await db
    .prepare(
      "INSERT INTO settings(id,value) VALUES('invitation',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .bind(bytes)
    .run();
  return setting;
}

// The exact resource response is checked field by field. A partial, redirected
// or foreign response is unavailable, never a reason to show a send action.
export async function readGuestbookInvitation(
  env: ProviderEnvironment,
  source: ResourceSource,
): Promise<GuestInvitation | null> {
  if (env.PROVIDER_ID !== 'guestbook') return null;
  const { origin, base } = providerLocation(env);
  let response: Response;
  try {
    response = await env.ITEM_PROVIDER.fetch(
      new Request(`${origin}${base}/r/${source.resource}/api/invitation`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(4000),
      }),
    );
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  const value = asObject(body),
    invitation = asObject(value?.invitation);
  if (
    !value ||
    value.contract !== 1 ||
    value.provider !== env.PROVIDER_ID ||
    value.resource !== source.resource ||
    !invitation ||
    Object.keys(invitation).sort().join(',') !==
      'accepts,collection,configuration,contribute,kind,limits,state,version' ||
    invitation.version !== 1 ||
    invitation.kind !== 'postcard' ||
    typeof invitation.state !== 'string' ||
    !states.has(invitation.state) ||
    typeof invitation.accepts !== 'boolean' ||
    invitation.accepts !== (invitation.state === 'open') ||
    !Number.isSafeInteger(invitation.configuration) ||
    Number(invitation.configuration) < 1 ||
    !same(invitation.limits, limits) ||
    typeof invitation.contribute !== 'string' ||
    typeof invitation.collection !== 'string'
  )
    return null;
  let contribute: URL, collection: URL;
  try {
    contribute = new URL(invitation.contribute);
    collection = new URL(invitation.collection);
  } catch {
    return null;
  }
  const prefix = `${origin}${base}/r/${source.resource}/c/${invitation.configuration}/`;
  if (
    contribute.origin !== origin ||
    collection.origin !== origin ||
    contribute.username ||
    contribute.password ||
    collection.username ||
    collection.password ||
    contribute.href !== prefix + 'contribute' ||
    collection.href !== prefix
  )
    return null;
  return {
    state: invitation.state as InvitationState,
    configuration: Number(invitation.configuration),
    contribute: contribute.href,
    collection: collection.href,
  };
}

// Mounted Linkarooie keeps its app-relative route; standalone keeps the source's
// own public address. The source returns only its own validated origin.
export function invitationHref(
  env: ProviderEnvironment,
  value: string,
  base: string,
) {
  const mount = env.PROVIDER_MOUNT || '';
  if (!base || !mount) return value;
  const pathname = new URL(value).pathname;
  return pathname.startsWith(mount + '/') ? pathname : mount + pathname;
}

export function invitationReply(
  setting: InvitationSetting | null,
  invitation: GuestInvitation | { state: 'unavailable' } | null,
) {
  return json({
    contract: 1,
    configured: Boolean(setting),
    ...(setting ? { source: setting.source } : {}),
    ...(setting
      ? { invitation: invitation ?? { state: 'unavailable' } }
      : { state: 'none' }),
  });
}
