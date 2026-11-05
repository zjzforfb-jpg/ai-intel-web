import { test } from "node:test";
import assert from "node:assert";
import { parseKeywords } from "@/lib/search";
test("smoke: tsx + node:test + @/ alias 可用", () => {
  assert.deepStrictEqual(parseKeywords("OpenAI  GPT-5"), ["OpenAI", "GPT-5"]);
});
