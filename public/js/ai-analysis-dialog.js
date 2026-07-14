(() => {
  const dialog = document.querySelector("[data-ai-analysis-dialog]");
  const button = document.querySelector("[data-ai-analysis-button]");
  if (!(dialog instanceof HTMLDialogElement) || !(button instanceof HTMLButtonElement)) return;

  const status = dialog.querySelector("[data-ai-analysis-status]");
  const source = dialog.querySelector("[data-ai-analysis-source]");
  const pageName = dialog.querySelector("[data-ai-analysis-page-name]");
  const period = dialog.querySelector("[data-ai-analysis-period]");
  const overview = dialog.querySelector("[data-ai-analysis-overview]");
  const fixedSummary = dialog.querySelector("[data-ai-analysis-fixed-summary]");
  const metrics = dialog.querySelector("[data-ai-analysis-metrics]");
  const observations = dialog.querySelector("[data-ai-analysis-observations]");
  const suggestions = dialog.querySelector("[data-ai-analysis-suggestions]");
  const limitations = dialog.querySelector("[data-ai-analysis-limitations]");
  const disclaimer = dialog.querySelector("[data-ai-analysis-disclaimer]");
  const content = dialog.querySelector("[data-ai-analysis-content]");
  const closeButtons = [...dialog.querySelectorAll("[data-close-ai-analysis-dialog]")];
  const title = dialog.querySelector("h2");
  const defaultButtonLabel = button.textContent?.trim() || "AI分析";

  const setBusy = (busy) => {
    if (content instanceof HTMLElement) content.setAttribute("aria-busy", String(busy));
    dialog.setAttribute("aria-busy", String(busy));
    button.classList.toggle("is-loading", busy);
    button.setAttribute("aria-busy", String(busy));
    closeButtons.forEach((control) => {
      if (control instanceof HTMLButtonElement) control.disabled = busy;
      control.setAttribute("aria-disabled", String(busy));
    });
  };

  const clear = (element) => {
    if (element instanceof HTMLElement) element.replaceChildren();
  };

  const setLoading = () => {
    if (status instanceof HTMLElement) {
      status.textContent = button.dataset.loadingMessage || "選択中のページを集計し、AIへ分析を依頼しています。";
      status.dataset.source = "LOADING";
      status.dataset.uiState = "loading";
    }
    if (source instanceof HTMLElement) source.hidden = true;
    if (pageName instanceof HTMLElement) pageName.textContent = button.dataset.pageName || "選択中ページ";
    if (period instanceof HTMLElement) period.textContent = "集計中";
    if (overview instanceof HTMLElement) overview.textContent = "集計中です。";
    if (disclaimer instanceof HTMLElement) disclaimer.textContent = "";
    if (fixedSummary instanceof HTMLElement) fixedSummary.hidden = true;
    clear(metrics);
    clear(observations);
    clear(suggestions);
    clear(limitations);
  };

  const render = (payload) => {
    const analysis = payload?.analysis;
    if (!analysis) throw new Error(payload?.message || "分析結果を取得できませんでした。");

    if (status instanceof HTMLElement) {
      status.textContent = payload.message || "分析結果を表示しました。";
      status.dataset.source = payload.source || "";
      status.dataset.uiState = payload.source === "AI" ? "success" : "fallback";
    }
    if (source instanceof HTMLElement) {
      source.textContent = analysis.sourceLabel || (payload.source === "AI" ? "AI分析" : "自動集計（AI分析ではありません）");
      source.dataset.source = payload.source || "";
      source.hidden = false;
    }
    if (pageName instanceof HTMLElement) pageName.textContent = payload.pageName || button.dataset.pageName || "選択中ページ";
    if (period instanceof HTMLElement) period.textContent = payload.period?.label || "全期間";
    if (overview instanceof HTMLElement) overview.textContent = analysis.overview || "表示できる概要がありません。";

    clear(metrics);
    const fixedMetrics = Array.isArray(payload?.metrics) ? payload.metrics : [];
    if (fixedSummary instanceof HTMLElement) fixedSummary.hidden = fixedMetrics.length === 0;
    if (metrics instanceof HTMLElement) {
      for (const metric of fixedMetrics) {
        const wrapper = document.createElement("div");
        const label = document.createElement("dt");
        const value = document.createElement("dd");
        label.textContent = String(metric?.label || "集計項目");
        value.textContent = String(metric?.value || "-");
        wrapper.append(label, value);
        metrics.append(wrapper);
      }
    }

    clear(observations);
    if (observations instanceof HTMLElement) {
      const items = Array.isArray(analysis.observations) ? analysis.observations : [];
      for (const observation of items) {
        const article = document.createElement("article");
        article.className = "ai-analysis-observation";
        article.dataset.level = observation.level || "INFO";
        const heading = document.createElement("h4");
        heading.textContent = observation.title || "集計結果";
        const description = document.createElement("p");
        description.textContent = observation.description || "";
        article.append(heading, description);
        observations.append(article);
      }
      if (items.length === 0) {
        const empty = document.createElement("p");
        empty.className = "form-help";
        empty.textContent = "表示できる気づきはありません。";
        observations.append(empty);
      }
    }

    clear(suggestions);
    if (suggestions instanceof HTMLElement) {
      for (const suggestion of Array.isArray(analysis.suggestions) ? analysis.suggestions : []) {
        const item = document.createElement("li");
        const title = document.createElement("strong");
        title.textContent = suggestion.title || "確認候補";
        const description = document.createElement("span");
        description.textContent = suggestion.description || "";
        item.append(title, description);
        suggestions.append(item);
      }
    }

    clear(limitations);
    if (limitations instanceof HTMLElement) {
      for (const limitation of Array.isArray(analysis.limitations) ? analysis.limitations : []) {
        const item = document.createElement("li");
        item.textContent = String(limitation);
        limitations.append(item);
      }
    }
    if (disclaimer instanceof HTMLElement) disclaimer.textContent = analysis.disclaimer || "";
  };

  button.addEventListener("click", async () => {
    const endpoint = button.dataset.endpoint;
    const pageId = Number(button.dataset.pageId);
    const groupId = Number(button.dataset.groupId);
    if (!endpoint || !Number.isSafeInteger(pageId) || pageId <= 0) return;

    const requestBody = { pageId };
    if (Number.isSafeInteger(groupId) && groupId > 0) requestBody.groupId = groupId;

    setLoading();
    dialog.showModal();
    requestAnimationFrame(() => {
      if (title instanceof HTMLElement) {
        title.setAttribute("tabindex", "-1");
        title.focus();
      }
    });
    setBusy(true);
    button.disabled = true;
    button.textContent = "分析中…";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok && !payload?.analysis) {
        throw new Error(payload?.message || "分析結果を取得できませんでした。");
      }
      render(payload);
    } catch (error) {
      if (status instanceof HTMLElement) {
        status.textContent = error instanceof Error ? error.message : "分析結果を取得できませんでした。";
        status.dataset.source = "ERROR";
        status.dataset.uiState = "error";
      }
      if (overview instanceof HTMLElement) {
        overview.textContent = "ページを再読み込みせず、時間をおいてもう一度お試しください。";
      }
    } finally {
      setBusy(false);
      button.disabled = false;
      button.textContent = defaultButtonLabel;
    }
  });

  dialog.querySelectorAll("[data-close-ai-analysis-dialog]").forEach((closeButton) => {
    closeButton.addEventListener("click", () => {
      if (content?.getAttribute("aria-busy") === "true") return;
      dialog.close();
    });
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && content?.getAttribute("aria-busy") !== "true") dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    if (content?.getAttribute("aria-busy") === "true") event.preventDefault();
  });
  dialog.addEventListener("close", () => button.focus());
})();
