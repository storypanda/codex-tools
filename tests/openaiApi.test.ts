import assert from "node:assert/strict";
import test from "node:test";
import { isOpenAiApiAccount, isOpenAiApiBaseUrl, OPENAI_API_BASE_URL } from "../src/utils/openaiApi.ts";
import type { AccountSummary } from "../src/types/app.ts";

test("official API recognition requires the exact HTTPS origin and API root", () => {
  for (const url of [OPENAI_API_BASE_URL, "https://api.openai.com/", "https://API.OPENAI.COM:443/v1/"]) {
    assert.equal(isOpenAiApiBaseUrl(url), true, url);
  }
  for (const url of [null, "", "invalid", "http://api.openai.com/v1", "https://api.openai.com.evil.invalid/v1",
    "https://api.openai.com:444/v1", "https://user@api.openai.com/v1", "https://api.openai.com/v1?proxy=1",
    "https://api.openai.com/v1#fragment", "https://api.openai.com/v1/responses", "https://relay.invalid/v1"]) {
    assert.equal(isOpenAiApiBaseUrl(url), false, String(url));
  }
});

test("ChatGPT accounts and relay accounts cannot be treated as official billing accounts", () => {
  const account = { sourceKind: "relay", apiBaseUrl: OPENAI_API_BASE_URL } as AccountSummary;
  assert.equal(isOpenAiApiAccount(account), true);
  assert.equal(isOpenAiApiAccount({ ...account, sourceKind: "chatgpt" }), false);
  assert.equal(isOpenAiApiAccount({ ...account, apiBaseUrl: "https://relay.invalid/v1" }), false);
});
