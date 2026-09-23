import test from "node:test";
import assert from "node:assert/strict";
import { buildCampaignLink, linkSuggestions, type LinkFields } from "./links";
const base: LinkFields = {
  url: "https://example.com/pricing#plans",
  source: "telegram",
  medium: "social",
  campaign: "launch ru",
  content: "",
  term: "",
  ref: "",
};
test("campaign links encode labels, preserve fragment, replace existing tags", () => {
  const url = new URL(
    buildCampaignLink({
      ...base,
      url: "https://example.com/?utm_source=old#plans",
    }),
  );
  assert.equal(url.searchParams.get("utm_campaign"), "launch ru");
  assert.equal(url.searchParams.getAll("utm_source").length, 1);
  assert.equal(url.hash, "#plans");
});
test("rejects unsafe URLs and private parameters", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "https://example-user@example.com",
    "https://example.com/?unapproved=example",
  ])
    assert.throws(() => buildCampaignLink({ ...base, url }));
  assert.throws(() =>
    buildCampaignLink({ ...base, source: "user@example.com" }),
  );
});

test("suggestions combine reviewed presets with labels from saved browser links", () => {
  const saved = [
    "https://example.com/?utm_source=telegram&utm_medium=social&utm_campaign=launch-ru",
    "https://example.com/?utm_source=user%40example.com&utm_campaign=launch-ru",
    "not-a-url",
  ];
  assert.deepEqual(linkSuggestions("source", saved).slice(0, 2), ["telegram", "x"]);
  assert.deepEqual(linkSuggestions("campaign", saved), ["launch-ru"]);
  assert.deepEqual(linkSuggestions("medium", saved).slice(0, 2), ["social", "organic"]);
});
