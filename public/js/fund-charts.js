(() => {
  const chart = document.querySelector("[data-fund-composition-chart]");
  if (!(chart instanceof HTMLElement)) return;

  const dataNode = chart.querySelector("[data-fund-chart-data]");
  const chartContent = chart.querySelector("[data-fund-chart-content]");
  const segmentsRoot = chart.querySelector("[data-fund-pie-segments]");
  const pie = chart.querySelector("[data-fund-pie]");
  const legend = chart.querySelector("[data-fund-chart-legend]");
  const tooltip = chart.querySelector("[data-fund-chart-tooltip]");
  const empty = chart.querySelector("[data-fund-chart-empty]");
  const emptyTitle = chart.querySelector("[data-fund-chart-empty-title]");
  const emptyDescription = chart.querySelector("[data-fund-chart-empty-description]");
  const centerLabel = chart.querySelector("[data-fund-chart-center-label]");
  const centerAmount = chart.querySelector("[data-fund-chart-center-amount]");
  const modeHelp = chart.querySelector("[data-fund-chart-mode-help]");
  const modeButtons = [...chart.querySelectorAll("[data-fund-chart-mode]")];

  if (
    !(dataNode instanceof HTMLScriptElement)
    || !(chartContent instanceof HTMLElement)
    || !(segmentsRoot instanceof SVGGElement)
    || !(pie instanceof SVGElement)
    || !(legend instanceof HTMLElement)
    || !(empty instanceof HTMLElement)
  ) return;

  let payload;
  try {
    payload = JSON.parse(dataNode.textContent || "{}");
  } catch {
    return;
  }

  const modes = {
    income: {
      items: Array.isArray(payload?.income) ? payload.income : [],
      total: Number(payload?.totals?.income) || 0,
      centerLabel: "収入",
      ariaLabel: "基金収入構成",
      emptyTitle: "表示できる基金収入がありません",
      emptyDescription: "選択期間に内部拠出または外部収入が登録されると、ここに構成を表示します。",
      help: "内部拠出はメンバー別、外部収入はカテゴリ別に集計しています。",
    },
    expense: {
      items: Array.isArray(payload?.expense) ? payload.expense : [],
      total: Number(payload?.totals?.expense) || 0,
      centerLabel: "支出",
      ariaLabel: "基金支出構成",
      emptyTitle: "表示できる基金支出がありません",
      emptyDescription: "選択期間に基金支出または基金返金が登録されると、ここに構成を表示します。",
      help: "基金支出はカテゴリ別、基金返金は返金先別に集計しています。",
    },
  };

  const namespace = "http://www.w3.org/2000/svg";
  let pinnedKey = null;
  let activeMode = "income";

  const formatAmount = (amount) => `${Number(amount).toLocaleString("ja-JP")} 円`;
  const formatPercentage = (percentage) => `${Number(percentage).toFixed(1)}%`;
  const itemText = (item) => `${item.label}｜${item.sourceTypeLabel}｜${formatAmount(item.amount)}｜${formatPercentage(item.percentage)}`;

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
    const left = Math.min(Math.max(8, targetRect.left - chartRect.left), Math.max(8, chartRect.width - 240));
    const top = Math.max(8, targetRect.bottom - chartRect.top + 6);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
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
        target.blur?.();
      }
    });
  };

  const buildLegendItem = (item) => {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    const swatch = document.createElement("span");
    const name = document.createElement("span");
    const nameStrong = document.createElement("strong");
    const nameSmall = document.createElement("small");
    const value = document.createElement("span");
    const valueStrong = document.createElement("strong");
    const valueSmall = document.createElement("small");

    button.type = "button";
    button.className = "fund-income-chart__legend-item";
    button.style.setProperty("--chart-color", String(item.color));
    button.dataset.fundChartItem = String(item.key);
    button.setAttribute("aria-label", itemText(item));

    swatch.className = "fund-income-chart__swatch";
    swatch.setAttribute("aria-hidden", "true");
    name.className = "fund-income-chart__legend-name";
    value.className = "fund-income-chart__legend-value";
    nameStrong.textContent = String(item.label);
    nameSmall.textContent = String(item.sourceTypeLabel);
    valueStrong.textContent = formatAmount(item.amount);
    valueSmall.textContent = formatPercentage(item.percentage);

    name.append(nameStrong, nameSmall);
    value.append(valueStrong, valueSmall);
    button.append(swatch, name, value);
    listItem.append(button);
    connectInteraction(button, item);
    return listItem;
  };

  const render = (mode) => {
    const config = modes[mode];
    if (!config) return;
    activeMode = mode;
    pinnedKey = null;
    hideTooltip(true);

    modeButtons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const selected = button.dataset.fundChartMode === mode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    if (centerLabel instanceof HTMLElement) centerLabel.textContent = config.centerLabel;
    if (centerAmount instanceof HTMLElement) centerAmount.textContent = config.total.toLocaleString("ja-JP");
    if (modeHelp instanceof HTMLElement) modeHelp.textContent = config.help;
    if (emptyTitle instanceof HTMLElement) emptyTitle.textContent = config.emptyTitle;
    if (emptyDescription instanceof HTMLElement) emptyDescription.textContent = config.emptyDescription;

    pie.setAttribute("aria-label", `選択期間の${config.ariaLabel}。合計 ${config.total.toLocaleString("ja-JP")} 円`);
    legend.setAttribute("aria-label", `${config.ariaLabel}の凡例`);

    segmentsRoot.replaceChildren();
    let list = legend.querySelector("ul");
    if (!(list instanceof HTMLUListElement)) {
      list = document.createElement("ul");
      legend.replaceChildren(list);
    } else {
      list.replaceChildren();
    }

    const hasData = config.total > 0 && config.items.length > 0;
    chartContent.hidden = !hasData;
    empty.hidden = hasData;
    if (!hasData) return;

    let offset = 0;
    for (const item of config.items) {
      const percentage = Math.max(0, Math.min(100, Number(item.percentage) || 0));
      if (percentage > 0) {
        const visiblePercentage = Math.max(percentage - 0.4, 0.2);
        const segment = document.createElementNS(namespace, "circle");
        segment.setAttribute("cx", "50");
        segment.setAttribute("cy", "50");
        segment.setAttribute("r", "38");
        segment.setAttribute("pathLength", "100");
        segment.setAttribute("fill", "none");
        segment.setAttribute("stroke", String(item.color));
        segment.setAttribute("stroke-width", "24");
        segment.setAttribute("stroke-dasharray", `${visiblePercentage} ${100 - visiblePercentage}`);
        segment.setAttribute("stroke-dashoffset", String(-offset));
        segment.setAttribute("transform", "rotate(-90 50 50)");
        segment.setAttribute("tabindex", "0");
        segment.setAttribute("role", "img");
        segment.setAttribute("aria-label", itemText(item));
        segment.dataset.fundChartItem = String(item.key);
        connectInteraction(segment, item);
        segmentsRoot.append(segment);
        offset += percentage;
      }
      list.append(buildLegendItem(item));
    }
  };

  modeButtons.forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    button.addEventListener("click", () => {
      const mode = button.dataset.fundChartMode;
      if (mode === "income" || mode === "expense") render(mode);
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (!pinnedKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-fund-chart-item]")) return;
    pinnedKey = null;
    hideTooltip(true);
  });

  render(activeMode);
})();
