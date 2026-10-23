// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
// MIT. Keep drafts in this owner page; exchange only selected public text with Launch Kit.
import { field, record } from "./studio-dom.js";
import { imageDimensions, validateCardPNG } from "./share-image.mjs";
const sha = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), (v) => v.toString(16).padStart(2, "0")).join("");
export function setupShareCard({ base, lock, isBusy, registerDraft, }) {
    const section = document.querySelector("#share-card-studio"), form = document.querySelector("#config");
    if (!section || !form)
        return;
    const find = (selector) => section.querySelector(selector), status = find("[data-share-card-status]"), receiptInput = find("[data-share-card-receipt]"), imageInput = find("[data-share-card-image]"), adopt = find("[data-adopt-share-card]"), rollback = find("[data-rollback-share-card]"), verify = find("[data-verify-share-card]");
    let saved = null, receipt = null, previewURL = "", generation = 0, popup = null, seed = null;
    let snapshotGeneration = 0;
    const editor = new URL("https://composer-launch-kit.loftwah.workers.dev/profile.html");
    const show = (message) => {
        status.textContent = message;
    };
    const controls = () => {
        adopt.disabled = isBusy() || !saved || !receipt || !previewURL;
        rollback.disabled = isBusy() || !saved?.previous;
        verify.disabled = isBusy() || !saved?.approved;
    };
    const readSnapshot = (value) => {
        const b = record(value), p = record(b.profile);
        if (b.version !== 1 ||
            !["id", "revision", "name", "handle", "description", "shareImage"].every((k) => typeof p[k] === "string"))
            throw Error("The saved profile response is unavailable. Refresh its snapshot before continuing.");
        return b;
    };
    async function request(body) {
        const response = await fetch(base + "/api/share-card", {
            ...(body
                ? {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                }
                : {}),
            signal: AbortSignal.timeout(15000),
        });
        const value = record(await response.json());
        if (!response.ok)
            throw Error(typeof value.error === "string"
                ? value.error
                : "The result could not be confirmed. Read the saved profile before retrying.");
        return readSnapshot(value);
    }
    const update = (value) => {
        saved = value;
        find("[data-current-share-image]").src =
            value.profile.shareImage;
        controls();
    };
    const refresh = async () => {
        const token = ++snapshotGeneration;
        const value = await request();
        if (token === snapshotGeneration)
            update(value);
    };
    function reset() {
        generation++;
        receipt = null;
        if (previewURL)
            URL.revokeObjectURL(previewURL);
        previewURL = "";
        find("[data-share-card-proposal]").hidden = true;
        controls();
    }
    registerDraft(() => !!receiptInput.files?.length || !!imageInput.files?.length);
    async function select() {
        reset();
        const token = generation, r = receiptInput.files?.[0], image = imageInput.files?.[0];
        if (!r || !image) {
            show("Select the prepared receipt and the PNG you inspected. Your current image stays published.");
            return;
        }
        try {
            if (r.size > 16384 || image.size >= 5 * 1024 ** 2)
                throw Error("Choose a receipt up to 16 KiB and a PNG smaller than 5 MiB.");
            const selected = record(JSON.parse(await r.text())), asset = record(selected.image), bytes = new Uint8Array(await image.arrayBuffer()), dimensions = imageDimensions(bytes);
            if (selected.format !== "linkarooie.share-card" ||
                selected.version !== 1 ||
                asset.sha256 !== (await sha(bytes)) ||
                asset.type !== dimensions.format ||
                asset.width !== dimensions.width ||
                asset.height !== dimensions.height)
                throw Error("The selected image does not match this receipt. Choose its original PNG.");
            await validateCardPNG(bytes);
            const decoded = await createImageBitmap(image);
            try {
                if (decoded.width !== 1200 || decoded.height !== 630)
                    throw Error("The selected PNG cannot be decoded at the required dimensions.");
            }
            finally {
                decoded.close();
            }
            if (token !== generation)
                return;
            receipt = selected;
            previewURL = URL.createObjectURL(image);
            const proposed = find("[data-proposed-share-image]");
            proposed.src = previewURL;
            proposed.alt =
                typeof asset.alt === "string" ? asset.alt : "Selected replacement";
            find("[data-share-card-proposal]").hidden = false;
            show("Selected locally. Compare both images. Publish activates only an already deployed matching image for this exact saved profile.");
            controls();
        }
        catch (error) {
            if (token === generation)
                show(error instanceof Error
                    ? error.message
                    : "Could not read these files. Your approved image is unchanged.");
        }
    }
    receiptInput.addEventListener("change", select);
    imageInput.addEventListener("change", select);
    find("[data-cancel-share-card]").addEventListener("click", () => {
        if (isBusy())
            return;
        reset();
        receiptInput.value = "";
        imageInput.value = "";
        show("Selection cancelled. The current published image is unchanged.");
        receiptInput.focus();
    });
    const publicSeed = () => ({
        format: "linkarooie.profile-snapshot",
        version: 1,
        profile: { id: saved.profile.id, revision: saved.profile.revision },
        text: {
            name: field(form, "title").value,
            handle: field(form, "handle").value,
            description: field(form, "intro").value,
            alt: "Shared-link image for " + field(form, "title").value,
        },
    });
    find("[data-open-launch-kit]").addEventListener("click", () => {
        if (isBusy() || !saved)
            return;
        seed = publicSeed();
        const target = new URL(editor);
        target.searchParams.set("ownerOrigin", location.origin);
        target.searchParams.set("return", location.href);
        popup = window.open(target, "linkarooie-launch-kit");
        show(popup
            ? "Launch Kit opened. Your unsaved profile edits remain here. Rendered output is local until explicitly published."
            : "Allow the Launch Kit window, or download the profile snapshot and import it in Launch Kit.");
    });
    window.addEventListener("message", (event) => {
        if (event.source !== popup ||
            event.origin !== editor.origin ||
            record(event.data ?? {}).type !== "launch-kit:ready" ||
            !seed)
            return;
        popup.postMessage({ type: "launch-kit:profile", recipe: seed }, editor.origin);
    });
    find("[data-download-card-snapshot]").addEventListener("click", () => {
        if (!saved)
            return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(publicSeed(), null, 2) + "\n"], {
            type: "application/json",
        })), a = document.createElement("a");
        a.href = url;
        a.download = "linkarooie-profile-snapshot.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        show("Snapshot downloaded. Import it in Launch Kit; this has not saved or published your edits.");
    });
    const profileValues = () => Object.fromEntries([...form.elements]
        .filter((control) => control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement)
        .filter((control) => control.name)
        .map((control) => [control.name, control.value]));
    const profileBaseline = () => JSON.stringify(profileValues());
    let baseline = profileBaseline();
    form.addEventListener("linkarooie:settings-saved", () => {
        baseline = profileBaseline();
        void refresh().catch((error) => show(error.message));
    });
    async function mutate(action) {
        if (!saved || isBusy())
            return;
        if (profileBaseline() !== baseline) {
            show("Save your profile edits or restore their original values before changing the published image. Your edits are still here.");
            return;
        }
        const unlock = lock();
        if (!unlock)
            return;
        controls();
        show(action === "adopt"
            ? "Verifying deployed image and publishing…"
            : "Restoring the previous approved image…");
        try {
            snapshotGeneration++;
            const value = await request(action === "adopt"
                ? {
                    action,
                    expectedRevision: record(receipt.profile).revision,
                    receipt,
                }
                : { action, expectedRevision: saved.profile.revision });
            update(value);
            field(form, "shareImage").value = value.profile.shareImage;
            baseline = profileBaseline();
            const confirmed = profileValues();
            form.dispatchEvent(new CustomEvent("linkarooie:settings-saved", {
                detail: { submitted: confirmed, saved: confirmed },
            }));
            reset();
            receiptInput.value = "";
            imageInput.value = "";
            show("Published. Verify the public result next. Other unsaved collection edits remain here.");
        }
        catch (error) {
            show((error instanceof Error
                ? error.message
                : "The save could not be confirmed.") +
                " Read the saved state before retrying.");
            try {
                await refresh();
            }
            catch {
                /* Original error stays visible. */
            }
        }
        finally {
            unlock();
            controls();
        }
    }
    adopt.addEventListener("click", () => void mutate("adopt"));
    rollback.addEventListener("click", () => void mutate("rollback"));
    verify.addEventListener("click", async () => {
        if (!saved?.approved || isBusy())
            return;
        const token = saved.profile.revision;
        verify.disabled = true;
        try {
            const page = await fetch(base + "/", {
                cache: "no-store",
                headers: { "X-Composer-Verification": "1" },
                signal: AbortSignal.timeout(15000),
            }), doc = new DOMParser().parseFromString(await page.text(), "text/html"), url = doc.querySelector('meta[property="og:image"]')?.content;
            if (!page.ok || !url)
                throw Error("The public metadata is unavailable.");
            const image = new URL(url);
            if (image.origin !== location.origin)
                throw Error("The public image must be served by this app.");
            const response = await fetch(image, {
                cache: "no-store",
                headers: { "X-Composer-Verification": "1" },
                signal: AbortSignal.timeout(15000),
            }), bytes = new Uint8Array(await response.arrayBuffer()), dimensions = imageDimensions(bytes);
            if (!response.ok ||
                (await sha(bytes)) !== saved.approved.sha256 ||
                dimensions.format !==
                    doc.querySelector('meta[property="og:image:type"]')
                        ?.content ||
                dimensions.format !==
                    (response.headers.get("content-type") ?? "").split(";")[0].trim() ||
                String(dimensions.width) !==
                    doc.querySelector('meta[property="og:image:width"]')
                        ?.content ||
                String(dimensions.height) !==
                    doc.querySelector('meta[property="og:image:height"]')
                        ?.content)
                throw Error("The public page, response and image bytes do not yet agree.");
            const current = await request();
            if (current.profile.revision !== token)
                throw Error("The profile changed during verification. Compare the current saved image.");
            show("Served result verified: public metadata, PNG bytes, dimensions and the saved profile revision agree. Social-platform rendering remains a separate check.");
        }
        catch (error) {
            show(error instanceof Error
                ? error.message
                : "Could not verify the public result.");
        }
        finally {
            controls();
        }
    });
    void refresh()
        .then(() => show("Ready. Your existing published image stays selected until you deliberately replace it."))
        .catch((error) => show(error.message));
}
