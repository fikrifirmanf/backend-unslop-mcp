import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRuleExamples } from "unslop-core";
import { rules } from "../src/rules.mjs";

test("every rule catches its bad examples and passes its good ones", () => {
  assert.deepEqual(checkRuleExamples(rules), []);
});
