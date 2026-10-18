// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
import { field, failure, record, } from "./studio-dom.js";
import { setupAchievements } from "./achievements-studio.js";
import { setupTags } from "./tags-studio.js";
import { setupProfileSettings } from "./profile-settings-studio.js";
// Owner-only native controls. Preview uses text nodes and never fetches a destination.
const cards = document.querySelector("#cards");
if (cards) {
    const base = cards.dataset.base ?? "";
    const output = document.querySelector("main > .message");
    let busy = false;
    const draftChecks = [];
    const fields = (form, keys) => Object.fromEntries(keys.map((key) => {
        const control = field(form, key);
        return [
            key,
            control instanceof HTMLInputElement && control.type === "checkbox"
                ? control.checked
                : control.value,
        ];
    }));
    const watch = (form, keys) => {
        let saved = fields(form, keys);
        draftChecks.push(() => JSON.stringify(fields(form, keys)) !== JSON.stringify(saved));
        return (values) => {
            saved = Object.fromEntries(keys.map((key) => {
                const control = field(form, key).cloneNode(true);
                if (control instanceof HTMLInputElement &&
                    control.type === "checkbox")
                    control.checked = Boolean(values[key]);
                else
                    control.value = String(values[key]);
                return [
                    key,
                    control instanceof HTMLInputElement && control.type === "checkbox"
                        ? control.checked
                        : control.value,
                ];
            }));
        };
    };
    window.addEventListener("beforeunload", (event) => {
        if (busy || draftChecks.some((changed) => changed())) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
    const reloadSaved = () => {
        busy = false;
        location.reload();
    };
    const lock = () => {
        if (busy)
            return null;
        busy = true;
        if (document.querySelector("#config")?.dataset.saving ===
            "true") {
            busy = false;
            output.textContent =
                "Wait for profile settings to finish saving, then try this change.";
            return null;
        }
        const controls = new Map([
            ...document.querySelectorAll("#cards,#manual,#feature,#achievement-studio,#tag-studio,#profile-portability,#config"),
        ]
            .flatMap((container) => [
            ...container.querySelectorAll("button,input,textarea,select"),
        ])
            .map((control) => [control, control.disabled]));
        controls.forEach((_, control) => {
            control.disabled = true;
        });
        return () => {
            busy = false;
            controls.forEach((disabled, control) => {
                control.disabled = disabled || control.dataset.conflicted === "true";
            });
        };
    };
    async function request(path, data) {
        const response = await fetch(base + path, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(path === "/api/cards" &&
                    typeof data === "object" &&
                    data !== null &&
                    "source" in data
                    ? {
                        "X-Composer-Source": cards.dataset.source ?? "",
                        "X-Composer-Target": cards.dataset.target ?? "",
                    }
                    : {}),
            },
            body: JSON.stringify(data),
        });
        const value = record(await response.json());
        if (!response.ok)
            throw Object.assign(Error(typeof value.error === "string"
                ? value.error
                : typeof value.message === "string"
                    ? value.message
                    : "Could not save this change."), {
                status: response.status,
                outcome: value.outcome,
                source: value.source,
            });
        return value;
    }
    const message = (cause) => {
        const error = failure(cause);
        output.textContent = error.message || String(error);
    };
    document.querySelector("#config")?.addEventListener("submit", (event) => {
        if (busy ||
            event.currentTarget.dataset.saving === "true") {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
    setupAchievements({ base, watch, lock, request, isBusy: () => busy });
    setupTags({ base, watch, lock, request, isBusy: () => busy });
    setupProfileSettings({
        base,
        lock,
        isBusy: () => busy,
        registerDraft: (check) => draftChecks.push(check),
    });
    for (const [id, status] of [
        ["manual", "draft"],
        ["feature", "published"],
    ]) {
        const entry = document.querySelector("#" + id);
        watch(entry, id === "manual" ? ["title", "description", "url"] : ["item"]);
        const matchesSource = (value, raw) => {
            try {
                const chosen = record(JSON.parse(raw)), actual = record(value);
                return (Object.keys(actual).sort().join(",") ===
                    "configuration,kind,resource,version" &&
                    ["kind", "version", "resource", "configuration"].every((key) => actual[key] === chosen[key]));
            }
            catch {
                return false;
            }
        };
        let interrupted;
        const reconcile = document.createElement("button");
        reconcile.type = "button";
        reconcile.className = "secondary";
        reconcile.textContent = "Check saved collection";
        reconcile.hidden = true;
        entry.append(reconcile);
        const featureSubmit = entry.querySelector("button[type=submit],button:not([type])");
        reconcile.addEventListener("click", async () => {
            if (!interrupted)
                return;
            const unlock = lock();
            if (!unlock)
                return;
            try {
                const response = await fetch(base + "/api/export", {
                    cache: "no-store",
                });
                if (!response.ok)
                    throw Error("The saved collection is unavailable. Keep this source selection and check again before retrying.");
                const saved = record(await response.json());
                if (saved.dataVersion !== 1 ||
                    !Array.isArray(saved.cards) ||
                    saved.cards.length > 64 ||
                    saved.cards.some((card) => typeof record(card).id !== "string" ||
                        typeof record(card).status !== "string"))
                    throw Error("The saved collection could not be verified. Keep this selection and check again.");
                const chosen = record(JSON.parse(interrupted.source));
                const found = saved.cards
                    .map(record)
                    .find((card) => card.provider === "guestbook" &&
                    card.item_id === interrupted.item &&
                    card.source_resource === chosen.resource &&
                    card.source_configuration === chosen.configuration);
                if (!found)
                    throw Error("No matching card is in the current collection. The result remains unknown because a card may have been removed after collection. Keep this selection and check again; it has not been retried.");
                const sameSelection = field(entry, "item").value === interrupted.item;
                interrupted = undefined;
                reconcile.hidden = true;
                if (featureSubmit)
                    featureSubmit.dataset.conflicted = "false";
                if (sameSelection)
                    entry.reset();
                output.textContent =
                    "Saved card " +
                        String(found.id) +
                        " confirmed (" +
                        String(found.status) +
                        "). Refresh when your other edits are ready.";
            }
            catch (cause) {
                output.textContent = failure(cause).message;
            }
            finally {
                unlock();
                if (!interrupted && featureSubmit)
                    featureSubmit.disabled = false;
            }
        });
        entry.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (interrupted)
                return;
            const form = entry, data = Object.fromEntries(new FormData(form)), unlock = lock();
            if (!unlock)
                return;
            try {
                const receipt = await request("/api/cards", {
                    ...data,
                    ...(data.source ? { source: JSON.parse(data.source) } : {}),
                    status,
                });
                if (data.source &&
                    (typeof receipt.id !== "string" ||
                        !/^[a-zA-Z0-9-]{1,64}$/.test(receipt.id) ||
                        receipt.status !== status ||
                        !["applied", "unchanged"].includes(String(receipt.outcome)) ||
                        !matchesSource(receipt.source, data.source)))
                    throw Error("The collection receipt could not be verified. Check the saved collection before retrying.");
                form.reset();
                output.textContent =
                    status === "draft"
                        ? "Draft link saved. Refresh when your other edits are ready."
                        : "Photo featured. Refresh when your other edits are ready.";
                reloadSaved();
            }
            catch (cause) {
                const error = failure(cause);
                message(error);
                const refused = typeof cause === "object" &&
                    cause !== null &&
                    "outcome" in cause &&
                    cause.outcome === "refused" &&
                    "source" in cause &&
                    data.source &&
                    matchesSource(cause.source, data.source);
                if (data.source &&
                    !refused &&
                    (error.status === undefined || error.status >= 500)) {
                    interrupted = data;
                    reconcile.hidden = false;
                    if (featureSubmit)
                        featureSubmit.dataset.conflicted = "true";
                    output.textContent = error.message.includes("may already")
                        ? error.message
                        : error.message +
                            " This request may already have collected the card. Check the saved collection before trying again.";
                }
            }
            finally {
                unlock();
            }
        });
    }
    for (const form of cards.querySelectorAll("[data-edit-card]")) {
        const status = form.querySelector("[data-edit-message]");
        const preview = form.querySelector("[data-card-preview]");
        const saveButton = form.querySelector("[type=submit]");
        let expected = JSON.parse(form.dataset.linkSnapshot), conflicted = false;
        const markSaved = watch(form, ["title", "description", "url", "status"]);
        const compare = document.createElement("div");
        compare.className = "card-edit-conflict";
        compare.hidden = true;
        form.insertBefore(compare, status);
        const button = (label, action) => {
            const control = document.createElement("button");
            control.type = "button";
            control.className = "secondary";
            control.textContent = label;
            control.addEventListener("click", action);
            return control;
        };
        async function compareSaved() {
            compare.replaceChildren();
            compare.hidden = false;
            const retry = button("Compare saved link", () => void compareSaved());
            retry.disabled = true;
            compare.append(retry);
            try {
                const response = await fetch(base + "/api/export", {
                    cache: "no-store",
                });
                if (!response.ok)
                    throw Error("Could not load the saved link. Your edits are kept here; sign in again if access expired.");
                const exported = record(await response.json()), card = Array.isArray(exported.cards)
                    ? exported.cards
                        .map(record)
                        .find((item) => item.id ===
                        form.closest("[data-card]").dataset.card)
                    : undefined;
                if (!card || card.provider) {
                    status.textContent =
                        "This authored link was removed or replaced. Your text is kept here to copy.";
                    compare.replaceChildren();
                    return;
                }
                const current = Object.fromEntries(["title", "description", "url", "status"].map((key) => [
                    key,
                    card[key],
                ]));
                if (!Object.values(current).every((value) => typeof value === "string") ||
                    !["draft", "published", "hidden"].includes(String(current.status)))
                    throw Error("The saved link could not be compared. Your edits are kept here.");
                const heading = document.createElement("p");
                heading.textContent =
                    "The saved link changed. Compare before choosing which version to save.";
                const list = document.createElement("dl");
                for (const [key, label] of [
                    ["title", "Saved title"],
                    ["description", "Saved description"],
                    ["url", "Saved destination"],
                    ["status", "Saved visibility"],
                ]) {
                    const term = document.createElement("dt"), detail = document.createElement("dd");
                    term.textContent = label;
                    detail.textContent = String(current[key] || "No description");
                    list.append(term, detail);
                }
                const choose = (keep) => {
                    expected = current;
                    markSaved(current);
                    conflicted = false;
                    saveButton.dataset.conflicted = "false";
                    saveButton.disabled = false;
                    compare.hidden = true;
                    if (!keep)
                        for (const [key, value] of Object.entries(current))
                            field(form, key).value = String(value);
                    preview.hidden = true;
                    status.textContent = keep
                        ? "Your edits are kept. Check the visibility before saving."
                        : "Using the saved link.";
                    field(form, keep ? "status" : "title").focus();
                };
                const actions = document.createElement("div");
                actions.className = "row";
                actions.append(button("Use saved link", () => choose(false)), button("Keep my edits", () => choose(true)));
                compare.replaceChildren(heading, list, actions);
                actions.querySelector("button").focus();
            }
            catch (cause) {
                const error = failure(cause);
                status.textContent = error.message;
                retry.disabled = false;
            }
        }
        form
            .querySelector("[data-preview-card]")
            .addEventListener("click", () => {
            if (!form.reportValidity())
                return;
            const data = Object.fromEntries(new FormData(form));
            try {
                const url = new URL(data.url);
                if (url.protocol !== "https:" ||
                    url.username ||
                    url.password ||
                    url.href.length > 2048)
                    throw Error("Use a public HTTPS destination.");
                const link = preview.querySelector("a");
                link.href = url.href;
                link.querySelector("strong").textContent = data.title;
                link.querySelector("span").textContent =
                    data.description;
                link.querySelector("small").textContent = url.hostname;
                preview.hidden = false;
                status.textContent = "Preview updated. Nothing has been saved.";
            }
            catch (cause) {
                const error = failure(cause);
                status.textContent = error.message;
                preview.hidden = true;
            }
        });
        form.addEventListener("input", () => {
            preview.hidden = true;
            status.textContent = "";
        });
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (conflicted || busy)
                return;
            const values = Object.fromEntries(new FormData(form)), unlock = lock();
            if (!unlock)
                return;
            const button = saveButton;
            try {
                await request("/api/cards", {
                    id: form.closest("[data-card]").dataset.card,
                    ...values,
                    expected,
                });
                expected = {
                    title: values.title.trim(),
                    description: values.description.trim(),
                    url: new URL(values.url).href,
                    status: values.status,
                };
                for (const [key, value] of Object.entries(expected))
                    field(form, key).value = String(value);
                const row = form.closest("[data-card]");
                row.querySelector("h3").textContent = expected.title;
                row.querySelector(":scope > p").textContent =
                    expected.status + " · Your authored card";
                markSaved(expected);
                preview.hidden = true;
                status.textContent = "Link saved.";
            }
            catch (cause) {
                const error = failure(cause);
                status.textContent = error.message;
                if (error.status === 409 || error.status === 404) {
                    conflicted = true;
                    button.dataset.conflicted = "true";
                    await compareSaved();
                }
            }
            finally {
                unlock();
            }
        });
    }
    cards.addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-move], button[data-status], button[data-delete]");
        if (!button || busy)
            return;
        const row = button.closest("[data-card]");
        if (button.dataset.delete &&
            !confirm("Remove this card from the collection? Its source photo is unaffected."))
            return;
        const unlock = lock();
        if (!unlock)
            return;
        try {
            if (button.dataset.move) {
                const other = button.dataset.move === "up"
                    ? row.previousElementSibling
                    : row.nextElementSibling;
                if (!other)
                    return;
                const order = [...cards.children], index = order.indexOf(row), next = order.indexOf(other);
                [order[index], order[next]] = [order[next], order[index]];
                await request("/api/reorder", {
                    ids: order.map((card) => card.dataset.card),
                });
                if (button.dataset.move === "up")
                    cards.insertBefore(row, other);
                else
                    cards.insertBefore(other, row);
                output.textContent = "Collection order saved.";
            }
            else {
                await request("/api/cards", {
                    id: row.dataset.card,
                    status: button.dataset.status,
                    delete: !!button.dataset.delete,
                });
                output.textContent = button.dataset.delete
                    ? "Card removed. Refresh when your other edits are ready."
                    : "Card " +
                        button.dataset.status +
                        ". Refresh when your other edits are ready.";
                if (!button.dataset.delete)
                    row.querySelector(":scope > p").textContent =
                        button.dataset.status +
                            " · " +
                            (row.querySelector("[data-edit-card]")
                                ? "Your authored card"
                                : "Linked source contribution · content follows its source");
                reloadSaved();
            }
        }
        catch (cause) {
            const error = failure(cause);
            message(error);
        }
        finally {
            unlock();
            if (button.isConnected)
                button.focus();
        }
    });
    // Link presentation is saved independently from card content and visibility.
    for (const form of document.querySelectorAll("[data-presentation-card]")) {
        const markSaved = watch(form, ["icon", "pinned", "group"]);
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const output = form.querySelector("[role=status]");
            const data = new FormData(form), unlock = lock();
            if (!unlock)
                return;
            try {
                const response = await fetch(base + "/api/presentation", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: form.closest("[data-card]").dataset.card,
                        pinned: data.has("pinned"),
                        icon: data.get("icon"),
                        group: data.get("group"),
                    }),
                });
                const result = await response.json();
                if (!response.ok)
                    throw Error(result.error || "Could not save the link style.");
                markSaved(fields(form, ["icon", "pinned", "group"]));
                output.textContent =
                    "Link style saved. Content and visibility are unchanged.";
            }
            catch (cause) {
                const error = failure(cause);
                output.textContent =
                    error.message ||
                        "Could not save the link style. Your selections are kept here.";
            }
            finally {
                unlock();
            }
        });
    }
}
