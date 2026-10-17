import test from "node:test";
import assert from "node:assert/strict";
import { html, commonAPI } from "../src/common.ts";
test("public page keeps escaped content, exact canonical and explicit social images", async () => {
  const response = html(
    "Fixture <img onerror=evil()>",
    "<h1>Fixture</h1>",
    "",
    "guestbook",
    "midnight",
    "Description",
    "https://guestbook.loftwah.com",
    "/",
  );
  const body = await response.text();
  assert.match(body, /Fixture &lt;img onerror=evil\(\)&gt;/);
  assert.match(body, /property="og:type" content="website"/);
  assert.match(body, /name="twitter:image"/);
  assert.match(body, /rel="apple-touch-icon"/);
  assert.match(body, /id="app-navigation"/);
  assert.doesNotMatch(body, /<img onerror=evil\(\)>/);
});
test("mounted page serves navigation inside its mount and owner page stays noindex", async () => {
  const response = html(
    "Fixture",
    "<h1>Fixture</h1><script>/* trusted app code */</script>",
    "/guestbook",
    "guestbook",
    "midnight",
    "Description",
    "https://composer.loftwah.com",
    "/owner",
  );
  const body = await response.text();
  assert.match(body, /src="\/guestbook\/brand\/navigation.js"/);
  assert.match(body, /noindex,nofollow/);
  assert.match(body, /<script nonce="[^"]+">/);
  const csp = response.headers.get("content-security-policy");
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(csp, /nonce-/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("mounted navigation and saved theme stay in the composition before painting", async () => {
 const response=html("Fixture", "<h1>Fixture</h1>", "/showcase", "showcase", "midnight", "Description", "https://composer.loftwah.com", "/owner");
 const body=await response.text(),head=body.slice(0,body.indexOf("</head>"));
 assert.match(head,/localStorage.getItem\("composer-theme"\)/);
 assert.match(head,/canonical" href="https:\/\/composer.loftwah.com\/showcase\/owner"/);
 assert.match(body, /href="\/guestbook\/"/);
 assert.match(body, /href="\/showcase\/" aria-current="page"/);
 assert.doesNotMatch(body, /href="https:\/\/(guestbook|showcase).loftwah.com"/);
 const standalone=await html("Fixture","","","guestbook","midnight","Description","https://guestbook.loftwah.com").text();
 assert.match(standalone,/localStorage.getItem\("guestbook:reader-theme"\)/);
 assert.match(standalone,/href="https:\/\/showcase.loftwah.com"/);
});

// A composed route must share its own art rather than another host's root asset.
test("social image resolves inside the actual app mount",async()=>{
 const body=await html("Fixture","","/showcase","showcase","midnight","Description","https://composer.loftwah.com","/").text();
 assert.match(body,/property="og:image" content="https:\/\/composer.loftwah.com\/showcase\/brand\/linkarooie-share-20261018.jpg"/);
 assert.match(body,/name="twitter:image" content="https:\/\/composer.loftwah.com\/showcase\/brand\/linkarooie-share-20261018.jpg"/);
 assert.match(body,/og:image:width" content="1200"/);
});

// A configured share image is owner-supplied art of unknown size and format, so the
// built-in card's 1200x630 JPEG facts must not be asserted about it.
test("share image metadata describes the built-in card but not a configured image",async()=>{
 const origin="https://composer.loftwah.com",base="/showcase";
 const builtIn=await html("Fixture","",base,"showcase","midnight","Description",origin,"/").text();
 assert.match(builtIn,/property="og:image" content="https:\/\/composer.loftwah.com\/showcase\/brand\/linkarooie-share-20261018.jpg"/);
 assert.match(builtIn,/property="og:image:width" content="1200"/);
 assert.match(builtIn,/property="og:image:height" content="630"/);
 assert.match(builtIn,/property="og:image:type" content="image\/jpeg"/);
 const configuredResponse=html("Fixture","",base,"showcase","midnight","Description",origin,"/",origin,{shareImage:"https://images.example.test/custom.png"});
 const configured=await configuredResponse.text();
 assert.match(configured,/property="og:image" content="https:\/\/images.example.test\/custom.png"/);
 assert.match(configured,/name="twitter:image" content="https:\/\/images.example.test\/custom.png"/);
 assert.doesNotMatch(configured,/og:image:width/);
 assert.doesNotMatch(configured,/og:image:height/);
 assert.doesNotMatch(configured,/og:image:type/);
 assert.match(configuredResponse.headers.get("content-security-policy"),/img-src 'self'[^;]*https:\/\/images\.example\.test/);
 const rejected=await html("Fixture","",base,"showcase","midnight","Description",origin,"/",origin,{shareImage:"http://insecure.test/card.png"}).text();
 assert.match(rejected,/property="og:image" content="https:\/\/composer.loftwah.com\/showcase\/brand\/linkarooie-share-20261018.jpg"/);
 assert.match(rejected,/property="og:image:type" content="image\/jpeg"/);
});


test("configured owner entry redirects to existing SSO without creating app authority or reading data", async () => {
 const destination="https://composer.loftwah.com/_emdash/admin/plugins/composer-miniapps/apps?app=showcase";
 const env={OWNER_STUDIO_URL:destination,get DB(){throw Error("Owner redirect must not read app data");}};
 for(const base of["","/showcase"])for(const method of["GET","HEAD"]){
  const response=await commonAPI(new Request("https://example.test"+base+"/owner?next=https://evil.test",{method}),env,"/owner",base,"fixture_session");
  assert.equal(response.status,302);assert.equal(response.headers.get("Location"),destination);assert.equal(response.headers.get("Set-Cookie"),null);assert.equal(response.headers.get("Cache-Control"),"no-store");assert.equal(await response.text(),"");
 }
 assert.equal(await commonAPI(new Request("https://example.test/owner"),{},"/owner","","fixture_session"),null);
 assert.equal(await commonAPI(new Request("https://example.test/api/export"),env,"/api/export","","fixture_session"),null);
});

test("invalid owner destinations fail closed and request query data cannot choose a destination",async()=>{
 for(const destination of["javascript:alert(1)","http://insecure.test/","https://user:secret@example.test/","https://example.test/owner","https://composer.loftwah.com/manage#fragment"]){
  const response=await commonAPI(new Request("https://example.test/owner"),{OWNER_STUDIO_URL:destination},"/owner","","fixture_session");assert.equal(response.status,503);assert.equal(response.headers.get("Set-Cookie"),null);assert.equal(response.headers.get("Location"),null);
 }
});
