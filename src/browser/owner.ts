// MIT. App-owned local owner login and profile configuration controls.
const client = document.querySelector<HTMLScriptElement>(
  "script[data-owner-client]",
);
const base = client?.dataset.base ?? "";
const output = document.querySelector<HTMLElement>("main [role=status]");
async function api(
  path: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("The server returned an invalid response.");
  const result = value as Record<string, unknown>;
  if (!response.ok)
    throw Error(
      typeof result.error === "string" ? result.error : "Request failed",
    );
  return result;
}
function report(error: unknown) {
  if (output)
    output.textContent = error instanceof Error ? error.message : String(error);
}
const login = document.querySelector<HTMLFormElement>("#login");
login?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/login", { token: new FormData(login).get("token") });
    location.reload();
  } catch (error) {
    report(error);
  }
});
document.querySelector("#logout")?.addEventListener("click", async () => {
  try {
    await api("/api/logout", {});
    location.reload();
  } catch (error) {
    report(error);
  }
});
const config = document.querySelector<HTMLFormElement>("#config");
config?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = config.querySelector<HTMLButtonElement>("button")!,
    status = config.querySelector<HTMLElement>("[data-config-message]")!;
  button.disabled = true;
  config.dataset.saving = "true";
  status.textContent = "Saving configuration…";
  const submitted = Object.fromEntries(new FormData(config));
  try {
    const result = await api("/api/config", submitted);
    status.textContent = "Configuration saved.";
    delete config.dataset.saving;
    button.disabled = false;
    config.dispatchEvent(
      new CustomEvent("linkarooie:settings-saved", {
        detail: { submitted, saved: result.config },
      }),
    );
    location.reload();
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? error.message
        : "Could not save. Your entries are still here.";
  } finally {
    delete config.dataset.saving;
    button.disabled = false;
  }
});
export {};
