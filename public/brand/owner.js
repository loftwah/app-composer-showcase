// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
// MIT. App-owned local owner login and profile configuration controls.
const client = document.querySelector("script[data-owner-client]");
const base = client?.dataset.base ?? "";
const output = document.querySelector("main [role=status]");
async function api(path, data) {
    const response = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    });
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("The server returned an invalid response.");
    const result = value;
    if (!response.ok)
        throw Error(typeof result.error === "string" ? result.error : "Request failed");
    return result;
}
function report(error) {
    if (output)
        output.textContent = error instanceof Error ? error.message : String(error);
}
const login = document.querySelector("#login");
login?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        await api("/api/login", { token: new FormData(login).get("token") });
        location.reload();
    }
    catch (error) {
        report(error);
    }
});
document.querySelector("#logout")?.addEventListener("click", async () => {
    try {
        await api("/api/logout", {});
        location.reload();
    }
    catch (error) {
        report(error);
    }
});
const config = document.querySelector("#config");
config?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = config.querySelector("button"), status = config.querySelector("[data-config-message]");
    button.disabled = true;
    config.dataset.saving = "true";
    status.textContent = "Saving configuration…";
    const submitted = Object.fromEntries(new FormData(config));
    try {
        const result = await api("/api/config", submitted);
        status.textContent = "Configuration saved.";
        delete config.dataset.saving;
        button.disabled = false;
        config.dispatchEvent(new CustomEvent("linkarooie:settings-saved", {
            detail: { submitted, saved: result.config },
        }));
        location.reload();
    }
    catch (error) {
        status.textContent =
            error instanceof Error
                ? error.message
                : "Could not save. Your entries are still here.";
    }
    finally {
        delete config.dataset.saving;
        button.disabled = false;
    }
});
const invitation = document.querySelector("#invitation");
invitation?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = invitation.querySelector("button"), status = invitation.querySelector("[data-invitation-message]"), operation = invitation.dataset.operation === "disable" ? "disable" : "enable", data = new FormData(invitation);
    button.disabled = true;
    status.textContent =
        operation === "disable"
            ? "Stopping invitations…"
            : "Linking this Guestbook…";
    try {
        const command = operation === "disable"
            ? { action: "disable" }
            : {
                action: "enable",
                source: JSON.parse(String(data.get("source"))),
            };
        await api("/api/invitation", command);
        location.reload();
    }
    catch (error) {
        status.textContent =
            error instanceof Error
                ? error.message
                : "Could not change the invitation. Nothing else was changed.";
    }
    finally {
        button.disabled = false;
    }
});
export {};
