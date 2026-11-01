import assert from "node:assert/strict";
import test from "node:test";
import * as parsers from "./md.ts";

test("reading supports headings and safe internal article links without broadening chat links", () => {
  assert.ok(parsers.readingMd, "reading parser must exist");
  const tokens = parsers.readingMd.parse("# Heading\n\n- [Article](/reading/article_a)\n", {});
  assert.equal(tokens[0].type, "heading_open");
  assert.ok(tokens.some(token => token.type === "bullet_list_open"));
  assert.equal(parsers.readingMd.validateLink("/reading/article_a"), true);
  assert.equal(parsers.md.validateLink("/reading/article_a"), false);
});

test("reading rejects script URLs and ambiguous internal paths while retaining inert raw HTML", () => {
  assert.ok(parsers.readingMd, "reading parser must exist");
  for (const url of ["javascript:alert(1)", "data:text/html,attack", "//evil.test", "/reading/../settings", "/reading/a?next=evil", "/reading/a%2fb"]) {
    assert.equal(parsers.readingMd.validateLink(url), false, url);
  }
  const tokens = parsers.readingMd.parse('<script>alert(1)</script>\n\n[bad](javascript:alert(1))', {});
  assert.ok(tokens.every(token => !token.type.startsWith("html_")));
  assert.ok(tokens.flatMap(token => token.children ?? []).every(token => token.type !== "link_open"));
});
