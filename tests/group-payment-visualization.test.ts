import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupPaymentVisualization } from "../src/transactions/group-payment-visualization.js";

test("group payment visualization aggregates selected-period payments by payer and keeps zero-yen participants", () => {
  const result = buildGroupPaymentVisualization([
    { amount: 1200, userId: 1, user: { displayName: "青木" } },
    { amount: 800, userId: 1, user: { displayName: "青木" } },
    { amount: 1000, userId: 2, user: { displayName: "伊藤" } },
    { amount: 0, userId: 3, user: { displayName: "上田" } },
  ]);

  assert.deepEqual(result.totals, {
    amount: 3000,
    paymentCount: 4,
    participantCount: 3,
  });
  assert.equal(result.paymentComposition[0].label, "青木");
  assert.equal(result.paymentComposition[0].amount, 2000);
  assert.equal(result.paymentComposition[0].paymentCount, 2);
  assert.equal(result.paymentComposition[0].percentage, 66.7);
  assert.equal(result.paymentComposition[1].percentage, 33.3);
  assert.equal(result.paymentComposition[2].amount, 0);
  assert.equal(result.paymentComposition[2].percentage, 0);
});

test("group payment visualization returns a stable empty composition", () => {
  assert.deepEqual(buildGroupPaymentVisualization([]), {
    paymentComposition: [],
    totals: { amount: 0, paymentCount: 0, participantCount: 0 },
  });
});
