(() => {
  const chart = document.querySelector("[data-personal-category-chart]");
  if (!(chart instanceof HTMLElement)) return;

  const dataNode = chart.querySelector("[data-personal-chart-data]");
  const segmentsRoot = chart.querySelector("[data-personal-pie-segments]");
  const legendRoot = chart.querySelector("[data-personal-chart-legend]");
  const tooltip = chart.querySelector("[data-personal-chart-tooltip]");
  const content = chart.querySelector("[data-personal-chart-content]");
  const emptyState = chart.querySelector("[data-personal-chart-empty]");
  const emptyTitle = chart.querySelector("[data-personal-chart-empty-title]");
  const centerLabel = chart.querySelector("[data-personal-chart-center-label]");
  const centerValue = chart.querySelector("[data-personal-chart-center-value]");
  const pie = chart.querySelector("[data-personal-pie]");

  if (!(dataNode instanceof HTMLScriptElement) || !(segmentsRoot instanceof SVGGElement) || !(legendRoot instanceof HTMLUListElement)) return;

  let visualization;
  try {
    visualization = JSON.parse(dataNode.textContent || "{}");
  } catch {
    return;
  }

  const namespace = "http://www.w3.org/2000/svg";
  let pinnedKey = null;

  const formatAmount = (amount) => `${Number(amount).toLocaleString("ja-JP")} 円`;
  const itemText = (item) => `${item.label}｜${formatAmount(item.amount)}｜${Number(item.percentage).toFixed(1)}%`;

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
    tooltip.style.left = `${Math.min(Math.max(8, targetRect.left - chartRect.left), Math.max(8, chartRect.width - 240))}px`;
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

  const render = (mode) => {
    const isIncome = mode === "income";
    const items = isIncome ? visualization.incomeComposition || [] : visualization.expenseComposition || [];
    const total = Number(isIncome ? visualization.totals?.income : visualization.totals?.expense) || 0;
    pinnedKey = null;
    hideTooltip(true);
    segmentsRoot.replaceChildren();
    legendRoot.replaceChildren();

    chart.querySelectorAll("[data-personal-chart-mode]").forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const active = button.dataset.personalChartMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (centerLabel instanceof HTMLElement) centerLabel.textContent = isIncome ? "収入" : "支出";
    if (centerValue instanceof HTMLElement) centerValue.textContent = total.toLocaleString("ja-JP");
    if (pie instanceof SVGElement) pie.setAttribute("aria-label", `${isIncome ? "収入" : "支出"}カテゴリ構成。合計 ${formatAmount(total)}`);

    const hasData = total > 0 && Array.isArray(items) && items.length > 0;
    if (content instanceof HTMLElement) content.hidden = !hasData;
    if (emptyState instanceof HTMLElement) emptyState.hidden = hasData;
    if (emptyTitle instanceof HTMLElement) emptyTitle.textContent = `表示できる${isIncome ? "収入" : "支出"}がありません`;
    if (!hasData) return;

    let offset = 0;
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
      segment.dataset.personalChartItem = item.key;
      connectInteraction(segment, item);
      segmentsRoot.append(segment);
      offset += percentage;

      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "personal-category-chart__legend-item";
      button.style.setProperty("--chart-color", String(item.color));
      button.dataset.personalChartItem = item.key;
      button.setAttribute("aria-label", itemText(item));
      button.innerHTML = `<span class="personal-category-chart__swatch" aria-hidden="true"></span><span class="personal-category-chart__legend-name"><strong></strong></span><span class="personal-category-chart__legend-value"><strong></strong><small></small></span>`;
      button.querySelector(".personal-category-chart__legend-name strong").textContent = item.label;
      button.querySelector(".personal-category-chart__legend-value strong").textContent = formatAmount(item.amount);
      button.querySelector(".personal-category-chart__legend-value small").textContent = `${Number(item.percentage).toFixed(1)}%`;
      connectInteraction(button, item);
      li.append(button);
      legendRoot.append(li);
    }
  };

  chart.querySelectorAll("[data-personal-chart-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button instanceof HTMLButtonElement) render(button.dataset.personalChartMode === "income" ? "income" : "expense");
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (!pinnedKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-personal-chart-item]")) return;
    pinnedKey = null;
    hideTooltip(true);
  });

  render("expense");
})();
