// MIT. Clearly fictional, committed publication example from the maintained renderer.
import { html, escape } from "./common.ts";
const example = {
  image: {
    path: "/brand/generated/profile-eb7c5b695a43702bf42effce699eb93f4a407be5289fd96a964561e315a89a4f.png",
    sha256: "eb7c5b695a43702bf42effce699eb93f4a407be5289fd96a964561e315a89a4f",
    type: "image/png",
    width: 1200,
    height: 630,
    alt: "River Morgan's profile card, introducing their creative work.",
  },
  text: {
    name: "River Morgan",
    handle: "rivermorgan",
    description: "Good work. Open skies.\nA little room to explore.",
    alt: "River Morgan's profile card, introducing their creative work.",
  },
  preset: {
    id: "typography",
    version: 1,
  },
  renderer: {
    id: "launch-kit-profile",
    version: "1.0.0",
    font: "Space Grotesk Latin 20261018",
    fontSha256:
      "61d00a1c57fcd7d4826c7a69cd85b61d15d133d5471d3c9c4731d70193d9f71f",
  },
};
export function launchKitExample(origin: string, base: string) {
  const canonicalOrigin = new URL(origin).origin;
  const profile = {
    title: example.text.name,
    intro: example.text.description,
    handle: example.text.handle,
    shareImage: canonicalOrigin + example.image.path,
    _shareCardOrigin: canonicalOrigin,
    _shareCard: { image: example.image },
  };
  return html(
    example.text.name,
    `<p>Fictional Launch Kit example</p><h1>${escape(example.text.name)}</h1><p class="profile-handle">@${escape(example.text.handle)}</p><p class="lede">${escape(example.text.description)}</p><figure style="margin:28px 0;max-width:960px"><a href="${base}${example.image.path}"><img style="display:block;width:100%;height:auto;aspect-ratio:1200/630" src="${base}${example.image.path}" alt="${escape(example.image.alt)}" width="1200" height="630"></a><figcaption>Actual locally rendered PNG · typography preset · 1200 × 630. This fictional example is independent of the owner’s profile and artwork.</figcaption></figure><p><a class="button" href="https://composer-launch-kit.loftwah.workers.dev/profile.html">Make your own in Launch Kit</a></p><p><a href="${base}/examples/river-typography.json" download>Download the reusable recipe</a> · <a href="https://github.com/loftwah/app-composer-showcase/blob/main/docs/launch-kit-publication.md">Local command and publication guide</a></p><details><summary>Publication details</summary><p>The image is a committed immutable asset released through Linkarooie’s existing Worker deployment. Its metadata declares its actual PNG type and dimensions. The authenticated adoption, conflict and rollback workflow is verified separately against a fictional local database; this example does not replace the owner’s selected share image.</p><p>SHA-256 <code>${example.image.sha256}</code></p></details>`,
    base,
    "showcase",
    "daylight",
    example.text.description,
    canonicalOrigin,
    "/examples/launch-kit/",
    canonicalOrigin,
    profile,
  );
}
