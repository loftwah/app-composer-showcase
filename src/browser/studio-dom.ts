// MIT. DOM contracts and private owner-editor services; values remain inert data.
export type ValueControl =
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export type Control = ValueControl | HTMLButtonElement;
export type FormValues = Record<string, string | boolean>;
export type Watch = (
  form: HTMLFormElement,
  keys: readonly string[],
) => (saved: FormValues) => void;
export interface StudioServices {
  base: string;
  watch: Watch;
  lock: () => null | (() => void);
  request: (path: string, data: unknown) => Promise<Record<string, unknown>>;
  isBusy: () => boolean;
}
export type StudioCommand =
  | { action: "create" | "edit"; item: unknown }
  | { action: "delete" | "visibility"; id: string; status?: string }
  | { action: "reorder"; ids: string[] };
export type AchievementValues = Record<
  "title" | "description" | "date" | "url" | "icon" | "status",
  string
>;
export type Achievement = AchievementValues & { id: string };
export interface AchievementCollection {
  version: 1;
  revision: number;
  items: Achievement[];
}
export function field(form: HTMLFormElement, key: string): ValueControl {
  const control = form.elements.namedItem(key);
  if (!(
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLTextAreaElement
  ))
    throw Error("Missing editor field: " + key);
  return control;
}
export function failure(cause: unknown): {
  message: string;
  name: string;
  status?: number;
  field?: string;
} {
  if (!cause || typeof cause !== "object")
    return { message: String(cause), name: "Error" };
  const value = cause as Record<string, unknown>;
  return {
    message:
      typeof value.message === "string"
        ? value.message
        : "The request could not be confirmed.",
    name: typeof value.name === "string" ? value.name : "Error",
    ...(typeof value.status === "number" ? { status: value.status } : {}),
    ...(typeof value.field === "string" ? { field: value.field } : {}),
  };
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("The response needs owner review.");
  return value as Record<string, unknown>;
}
export function achievements(value: unknown): AchievementCollection {
  const collection = record(value);
  if (
    collection.version !== 1 ||
    typeof collection.revision !== "number" ||
    !Number.isSafeInteger(collection.revision) ||
    collection.revision < 0 ||
    !Array.isArray(collection.items) ||
    collection.items.length > 8
  )
    throw Error(
      "Saved achievements need owner review. Your edits are kept here.",
    );
  const items = collection.items.map((value) => {
    const item = record(value);
    if (
      !["id", "title", "description", "date", "url", "icon", "status"].every(
        (key) => typeof item[key] === "string",
      )
    )
      throw Error(
        "Saved achievements need owner review. Your edits are kept here.",
      );
    return item as Achievement;
  });
  return { version: 1, revision: collection.revision, items };
}
export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}
