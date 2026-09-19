import assert from "node:assert/strict";
import test from "node:test";
import { copyRecoveryLink, parseRecoveryFragment, privateJobLink, validateRecoveryCredentials } from "../../frontend/src/features/jobRecovery.ts";

const credentials = { id: "4fb93f5c-1a21-4607-84bc-95a72dfb03d1", token: "A".repeat(40) + "_-A" };

test("recovery link keeps the deployed subdirectory and contains only the capability fragment", () => {
  const result = new URL(privateJobLink("https://example.test/OfftargetPred-web-server/?sequence=private&token=old#help", credentials));
  assert.equal(result.origin, "https://example.test");
  assert.equal(result.pathname, "/OfftargetPred-web-server/");
  assert.equal(result.search, "");
  assert.deepEqual([...new URLSearchParams(result.hash.slice(1)).keys()], ["job", "token"]);
  assert.deepEqual(parseRecoveryFragment(result.hash), credentials);
  const requestUrl = new URL(result); requestUrl.hash = "";
  assert.equal(requestUrl.toString(), "https://example.test/OfftargetPred-web-server/");
});

test("local preview and explicit index paths are preserved without URL authentication", () => {
  assert.equal(new URL(privateJobLink("http://user:password@127.0.0.1:5182/index.html?a=b#examples", credentials)).href, `http://127.0.0.1:5182/index.html#job=${credentials.id}&token=${credentials.token}`);
  assert.throws(() => privateJobLink("javascript:alert(1)", credentials), /web address/);
});

test("malformed, duplicate, ambiguous or oversized fragments and stored credentials are rejected", () => {
  const valid = `job=${credentials.id}&token=${credentials.token}`;
  for (const fragment of ["#predict", "", valid + "&token=" + credentials.token, valid + "&job=" + credentials.id, valid + "&extra=1", `job=../../private&token=${credentials.token}`, `job=${credentials.id}&token=%0A${credentials.token}`, valid + "A"]) {
    assert.equal(parseRecoveryFragment(fragment), null, fragment);
  }
  for (const value of [null, false, [], {}, { id: credentials.id, token: 3 }, { id: credentials.id.toUpperCase(), token: credentials.token }, { id: credentials.id, token: "x".repeat(500) }, { id: credentials.id, token: "a/b" }]) assert.equal(validateRecoveryCredentials(value), null);
  assert.deepEqual(validateRecoveryCredentials({ ...credentials, untrustedExtra: true }), credentials);
});

test("clipboard failure and absence return a manual-copy result without throwing", async () => {
  assert.equal(await copyRecoveryLink("private", undefined), false);
  assert.equal(await copyRecoveryLink("private", { writeText: async () => { throw new DOMException("denied", "NotAllowedError"); } }), false);
  const copied: string[] = [];
  assert.equal(await copyRecoveryLink("private", { writeText: async text => { copied.push(text); } }), true);
  assert.deepEqual(copied, ["private"]);
});
