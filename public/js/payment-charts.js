(() => {
  const chart = document.querySelector("[data-payment-share-chart]");
  if (!(chart instanceof HTMLElement)) return;

  const dataNode = chart.querySelector("[data-payment-share-chart-data]");
  const segmentsRoot = chart.querySelector("[data-payment-share-segments]");
  const tooltip = chart.querySelector("[data-payment-share-tooltip]");
  if (!(dataNode instanceof HTMLScriptElement) || !(segmentsRoot instanceof SVGGElement)) return;

  let items;
  try {
    items = JSON.parse(dataNode.textContent || "[]");
  } catch {
    return;
  }
  if (!Array.isArray(items) || items.length === 0) return;

  const namespace = "http://www.w3.org/2000/svg";
  let offset = 0;
  let pinnedKey = null;

  const formatAmount = (amount) => `${Number(amount).toLocaleString("ja-JP")} 円`;
  const itemText = (item) => `${item.label}｜${formatAmount(item.amount)}｜${Number(item.percentage).toFixed(1)}%｜${Number(item.paymentCount).toLocaleString("ja-JP")}件`;

  const hideTooltip = (force = false) => {
    if (!(tooltip instanceof HTMLElement)) return;
    if (!force && pinnedKey) return;
    tooltip.hidden = true;
    tooltip.textContent = "";
  };

  const showTooltip = (item, target, pin = false) => {
    if (!(tooltip instanceof HTMLElement) || !(target instanceof Element)) return;
    if (pin) pinnedKey = pinnedKey === item.key ? null : item.key;
    if (pin && pinnedKey === null) {
      hideTooltip(true);
      return;
    }

    tooltip.textContent = itemText(item);
    tooltip.hidden = false;
    const targetRect = target.getBoundingClientRect();
    const chartRect = chart.getBoundingClientRect();
    tooltip.style.left = `${Math.min(Math.max(8, targetRect.left - chartRect.left), Math.max(8, chartRect.width - 250))}px`;
    tooltip.style.top = `${Math.max(8, targetRect.bottom - chartRect.top + 6)}px`;
  };

  const connectInteraction = (target, item) => {
    target.addEventListener("pointerenter", () => showTooltip(item, target));
    target.addEventListener("pointerleave", () => hideTooltip());
    target.addEventListener("focus", () => showTooltip(item, target));
    target.addEventListener("blur", () => hideTooltip());
    target.addEventListener("click", () => showTooltip(item, target, true));
    target.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        pinnedKey = null;
        hideTooltip(true);
      }
    });
  };

  for (const item of items) {
    const percentage = Math.max(0, Math.min(100, Number(item.percentage) || 0));
    if (percentage <= 0) continue;
    const segment = document.createElementNS(namespace, "circle");
    segment.setAttribute("cx", "50");
    segment.setAttribute("cy", "50");
    segment.setAttribute("r", "38");
    segment.setAttribute("pathLength", "100");
    segment.setAttribute("fill", "none");
    segment.setAttribute("stroke", String(item.color));
    segment.setAttribute("stroke-width", "24");
    segment.setAttribute("stroke-dasharray", `${Math.max(percentage - 0.4, 0.2)} ${100 - Math.max(percentage - 0.4, 0.2)}`);
    segment.setAttribute("stroke-dashoffset", String(-offset));
    segment.setAttribute("transform", "rotate(-90 50 50)");
    segment.setAttribute("tabindex", "0");
    segment.setAttribute("role", "img");
    segment.setAttribute("aria-label", itemText(item));
    segment.dataset.paymentShareItem = item.key;
    connectInteraction(segment, item);
    segmentsRoot.append(segment);
    offset += percentage;
  }

  chart.querySelectorAll("[data-payment-share-item]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const item = items.find((candidate) => candidate.key === button.dataset.paymentShareItem);
    if (item) connectInteraction(button, item);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!pinnedKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-payment-share-item]")) return;
    pinnedKey = null;
    hideTooltip(true);
  });
})();
