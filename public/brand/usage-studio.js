// Generated from checked TypeScript; edit src/browser or src/publisher.mts. MIT.
// Owner settings for opt-in aggregate usage. This module reads only the two
// saved choices; counts and visitor data never enter this browser workflow.
const panel = document.querySelector("[data-usage-panel]");
const form = panel?.querySelector("[data-usage-settings]");
const output = panel?.querySelector("[data-usage-status]");
const enabled = panel?.querySelector("[data-usage-enabled]");
const publicBlock = panel?.querySelector("[data-usage-public]");
if (panel && form && output && enabled && publicBlock) {
    const endpoint = panel.dataset.usageApi ?? "";
    const sync = () => {
        publicBlock.disabled = !enabled.checked;
        if (!enabled.checked)
            publicBlock.checked = false;
    };
    enabled.addEventListener("change", sync);
    sync();
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button");
        if (button)
            button.disabled = true;
        output.textContent = "Saving usage settings…";
        try {
            let expected = {};
            try {
                expected = JSON.parse(panel.dataset.expected ?? "{}");
            }
            catch { }
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    enabled: enabled.checked,
                    publicBlock: publicBlock.checked,
                    expected,
                }),
            });
            const value = await response.json().catch(() => null);
            if (!value || typeof value !== "object" || Array.isArray(value))
                throw Error("The server returned an invalid response.");
            const result = value;
            if (!response.ok)
                throw Error(typeof result.error === "string"
                    ? result.error
                    : "Could not save usage settings.");
            if (!result.settings ||
                typeof result.settings.enabled !== "boolean" ||
                typeof result.settings.publicBlock !== "boolean")
                throw Error("The server returned an invalid response.");
            panel.dataset.expected = JSON.stringify({
                enabled: result.settings.enabled,
                publicBlock: result.settings.publicBlock,
            });
            output.textContent = "Usage settings saved.";
        }
        catch (error) {
            output.textContent =
                error instanceof Error
                    ? error.message
                    : "Could not save usage settings. Nothing else was changed.";
        }
        finally {
            if (button)
                button.disabled = false;
        }
    });
}
export {};
