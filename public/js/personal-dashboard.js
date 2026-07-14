(() => {
  const layout = document.querySelector("[data-personal-layout]");
  const toggle = document.querySelector("[data-personal-context-toggle]");
  const contextPanel = document.getElementById("personal-context-panel");
  const collapsedPanel = document.querySelector(".personal-collapsed-column");

  const currentContextState = () =>
    layout instanceof HTMLElement && layout.classList.contains("is-context-closed")
      ? "closed"
      : "open";

  const updateContextState = (state) => {
    if (!(layout instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)) return;
    const isOpen = state === "open";
    layout.classList.toggle("is-context-closed", !isOpen);
    const desktopIcon = toggle.querySelector("[data-operation-desktop-icon]");
    const mobileIcon = toggle.querySelector("[data-operation-mobile-icon]");
    const label = toggle.querySelector("[data-operation-label]");
    if (desktopIcon instanceof HTMLElement) desktopIcon.textContent = isOpen ? "←" : "→";
    if (mobileIcon instanceof HTMLElement) mobileIcon.textContent = isOpen ? "↑" : "↓";
    if (label instanceof HTMLElement) label.textContent = isOpen ? "閉じる" : "開く";
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-label", isOpen ? "一覧を閉じる" : "一覧を開く");
    toggle.title = isOpen ? "一覧を閉じる" : "一覧を開く";
    contextPanel?.setAttribute("aria-hidden", String(!isOpen));

    document.querySelectorAll("[data-personal-context-state]").forEach((input) => {
      if (input instanceof HTMLInputElement) input.value = state;
    });

    document.querySelectorAll("[data-personal-context-link]").forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = new URL(link.href, window.location.origin);
      if (isOpen) url.searchParams.set("context", "open");
      else url.searchParams.delete("context");
      link.href = `${url.pathname}${url.search}`;
    });

    const url = new URL(window.location.href);
    if (isOpen) url.searchParams.set("context", "open");
    else url.searchParams.delete("context");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  toggle?.addEventListener("click", () => {
    updateContextState(currentContextState() === "open" ? "closed" : "open");
  });

  document.querySelectorAll("[data-open-personal-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!(button instanceof HTMLButtonElement)) return;
      const dialog = document.getElementById(button.dataset.openPersonalDialog || "");
      if (dialog instanceof HTMLDialogElement) dialog.showModal();
    });
  });

  document.querySelectorAll("[data-close-personal-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = button.closest("dialog");
      if (dialog instanceof HTMLDialogElement) dialog.close();
    });
  });

  document.querySelectorAll("dialog.personal-dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && dialog instanceof HTMLDialogElement) dialog.close();
    });
  });

  const personalForm = document.querySelector("[data-personal-transaction-form]");
  if (personalForm instanceof HTMLFormElement) {
    const kindSelect = personalForm.elements.namedItem("kind");
    const amountInput = personalForm.elements.namedItem("amount");
    const dateInput = personalForm.elements.namedItem("transactionDate");
    const categorySelect = personalForm.elements.namedItem("category");
    const rawTextInput = personalForm.elements.namedItem("rawText");
    const suggestionTokenInput = personalForm.querySelector("[data-ai-suggestion-token]");
    const classifyButton = personalForm.querySelector("[data-ai-classify-button]");
    const suggestionPanel = personalForm.querySelector("[data-ai-suggestion-panel]");
    const messageElement = personalForm.querySelector("[data-ai-message]");
    const fieldStatusElement = personalForm.querySelector("[data-ai-field-status]");
    const warningList = personalForm.querySelector("[data-ai-warnings]");
    const statusLabels = {
      EXPLICIT: "入力に明記",
      INFERRED: "AI・規則で推定",
      DEFAULTED: "画面の既定値",
      MISSING: "要入力",
    };

    const updateCategoryOptions = () => {
      if (!(kindSelect instanceof HTMLSelectElement) || !(categorySelect instanceof HTMLSelectElement)) return;
      const selectedKind = kindSelect.value;
      categorySelect.querySelectorAll("optgroup[data-category-kind]").forEach((group) => {
        if (!(group instanceof HTMLOptGroupElement)) return;
        const enabled = group.dataset.categoryKind === selectedKind;
        group.disabled = !enabled;
        group.hidden = !enabled;
      });
      const selectedGroup = categorySelect.selectedOptions[0]?.parentElement;
      if (selectedGroup instanceof HTMLOptGroupElement && selectedGroup.disabled) categorySelect.value = "";
    };

    const showSuggestion = (payload) => {
      if (!(suggestionPanel instanceof HTMLElement) || !payload?.suggestion) return;
      suggestionPanel.hidden = false;
      if (messageElement instanceof HTMLElement) {
        messageElement.textContent = payload.message || "候補を表示しました。";
        messageElement.dataset.source = payload.source || "";
      }
      const suggestion = payload.suggestion;
      if (kindSelect instanceof HTMLSelectElement) {
        if (suggestion.transactionType === "INCOME") kindSelect.value = "income";
        if (suggestion.transactionType === "EXPENSE") kindSelect.value = "expense";
        updateCategoryOptions();
      }
      if (amountInput instanceof HTMLInputElement && suggestion.amount !== null) amountInput.value = String(suggestion.amount);
      if (dateInput instanceof HTMLInputElement) dateInput.value = suggestion.transactionDate || payload.referenceDate || dateInput.value;
      if (categorySelect instanceof HTMLSelectElement) categorySelect.value = suggestion.category || "";
      if (payload.source === "AI" && rawTextInput instanceof HTMLTextAreaElement && suggestion.summary) rawTextInput.value = suggestion.summary;
      if (suggestionTokenInput instanceof HTMLInputElement) suggestionTokenInput.value = payload.suggestionToken || "";
      if (fieldStatusElement instanceof HTMLElement) {
        fieldStatusElement.replaceChildren();
        [
          ["種類", suggestion.fieldStatus?.transactionType],
          ["金額", suggestion.fieldStatus?.amount],
          ["取引日", suggestion.transactionDate ? suggestion.fieldStatus?.transactionDate : "DEFAULTED"],
          ["カテゴリ", suggestion.fieldStatus?.category],
        ].forEach(([label, status]) => {
          const dt = document.createElement("dt");
          dt.textContent = label;
          const dd = document.createElement("dd");
          dd.textContent = statusLabels[status] || "要確認";
          dd.dataset.status = status || "";
          fieldStatusElement.append(dt, dd);
        });
      }
      if (warningList instanceof HTMLUListElement) {
        warningList.replaceChildren();
        const warnings = Array.isArray(suggestion.warnings) ? suggestion.warnings : [];
        warnings.forEach((warning) => {
          const li = document.createElement("li");
          li.textContent = String(warning);
          warningList.append(li);
        });
        warningList.hidden = warnings.length === 0;
      }
    };

    kindSelect?.addEventListener("change", updateCategoryOptions);
    updateCategoryOptions();

    classifyButton?.addEventListener("click", async () => {
      if (!(classifyButton instanceof HTMLButtonElement) || !(kindSelect instanceof HTMLSelectElement) || !(rawTextInput instanceof HTMLTextAreaElement)) return;
      const rawText = rawTextInput.value.trim();
      if (!rawText) {
        rawTextInput.focus();
        rawTextInput.setCustomValidity("AIで推定する内容を入力してください。");
        rawTextInput.reportValidity();
        rawTextInput.setCustomValidity("");
        return;
      }
      classifyButton.disabled = true;
      classifyButton.textContent = "推定中…";
      personalForm.setAttribute("aria-busy", "true");
      if (suggestionPanel instanceof HTMLElement) suggestionPanel.hidden = false;
      if (messageElement instanceof HTMLElement) messageElement.textContent = "AIで候補を作成しています。";
      try {
        const response = await fetch("/api/ai/classify-transaction", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ rawText, fallbackKind: kindSelect.value }),
        });
        const payload = await response.json().catch(() => null);
        if (payload?.suggestion) showSuggestion(payload);
        else throw new Error(payload?.message || "AI候補を取得できませんでした。");
      } catch (error) {
        if (suggestionPanel instanceof HTMLElement) suggestionPanel.hidden = false;
        if (messageElement instanceof HTMLElement) {
          messageElement.textContent = error instanceof Error ? error.message : "AI候補を取得できませんでした。手動で入力してください。";
          messageElement.dataset.source = "ERROR";
        }
      } finally {
        classifyButton.disabled = false;
        classifyButton.textContent = "AIで推定";
        personalForm.removeAttribute("aria-busy");
      }
    });
  }

  document.querySelectorAll("form[data-submit-lock]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (event.defaultPrevented || !(form instanceof HTMLFormElement)) return;
      if (form.dataset.submitting === "true") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      form.dataset.submitting = "true";
      form.setAttribute("aria-busy", "true");
      form.querySelectorAll("button[type='submit'], input[type='submit']").forEach((control) => {
        if (control instanceof HTMLButtonElement) {
          control.textContent = "処理中…";
          control.disabled = true;
        } else if (control instanceof HTMLInputElement) {
          control.value = "処理中…";
          control.disabled = true;
        }
      });
    });
  });

  const ledger = document.querySelector(".personal-ledger");
  const ledgerScroll = document.querySelector(".personal-ledger-scroll");
  const syncScrollbar = () => {
    if (!(ledger instanceof HTMLElement) || !(ledgerScroll instanceof HTMLElement)) return;
    ledger.style.setProperty("--personal-ledger-scrollbar-width", `${ledgerScroll.offsetWidth - ledgerScroll.clientWidth}px`);
  };
  syncScrollbar();
  window.addEventListener("resize", syncScrollbar);

  const tooltip = document.createElement("div");
  tooltip.className = "personal-ledger-tooltip";
  tooltip.hidden = true;
  document.body.append(tooltip);
  document.querySelectorAll("[data-personal-ledger-tooltip]").forEach((target) => {
    const show = () => {
      if (!(target instanceof HTMLElement)) return;
      tooltip.textContent = target.dataset.personalLedgerTooltip || "";
      const rect = target.getBoundingClientRect();
      tooltip.style.left = `${Math.min(rect.left, window.innerWidth - 340)}px`;
      tooltip.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 80)}px`;
      tooltip.hidden = false;
    };
    const hide = () => { tooltip.hidden = true; };
    target.addEventListener("pointerenter", show);
    target.addEventListener("pointerleave", hide);
    target.addEventListener("focus", show);
    target.addEventListener("blur", hide);
    target.addEventListener("click", show);
  });
})();
