(() => {
  const statusLabels = {
    EXPLICIT: "入力に明記",
    INFERRED: "AI・規則で推定",
    DEFAULTED: "画面の既定値",
    MISSING: "要入力",
  };

  const incomePattern = /(収入|寄付|助成|補助金|売上|収益|受け取|入金|協賛金|参加費を受領)/;
  const contributionPattern = /(基金へ?拠出|拠出|積立|会費を基金|出資)/;
  const refundPattern = /(返金|払い戻|返還|過払い|取消.*戻)/;

  const setCategoryGroups = (select, type) => {
    if (!(select instanceof HTMLSelectElement)) return;
    select.querySelectorAll("optgroup[data-category-type]").forEach((group) => {
      if (!(group instanceof HTMLOptGroupElement)) return;
      const enabled = group.dataset.categoryType === type;
      group.disabled = !enabled;
      group.hidden = !enabled;
    });
    const selectedGroup = select.selectedOptions[0]?.parentElement;
    if (selectedGroup instanceof HTMLOptGroupElement && selectedGroup.disabled) select.value = "";
  };

  const setStatus = (element, text, state = "") => {
    if (!(element instanceof HTMLElement)) return;
    element.textContent = text;
    if (state) {
      element.dataset.state = state;
      element.dataset.uiState = state;
      element.setAttribute("role", state === "error" ? "alert" : "status");
    } else {
      delete element.dataset.state;
      delete element.dataset.uiState;
      element.setAttribute("role", "status");
    }
  };

  document.querySelectorAll("[data-transaction-overlay]").forEach((dialog) => {
    if (!(dialog instanceof HTMLDialogElement)) return;
    const form = dialog.querySelector("[data-transaction-overlay-form]");
    if (!(form instanceof HTMLFormElement)) return;

    const mode = form.dataset.overlayMode || "";
    const rawText = form.querySelector("[data-overlay-raw-text]");
    const details = form.querySelector("[data-overlay-details]");
    const footer = form.querySelector("[data-overlay-footer]");
    const status = form.querySelector("[data-overlay-status]");
    const manualButton = form.querySelector("[data-overlay-manual]");
    const aiButton = form.querySelector("[data-overlay-ai]");
    const submitButton = form.querySelector("[data-overlay-submit]");
    const dateInput = form.elements.namedItem("transactionDate");
    const amountInput = form.elements.namedItem("amount");
    const categorySelect = form.elements.namedItem("category");
    const kindSelect = form.querySelector("[data-overlay-kind]");
    const fundTypeSelect = form.querySelector("[data-overlay-fund-type]");
    const tokenInput = form.querySelector("[data-ai-suggestion-token]");
    const suggestionPanel = form.querySelector("[data-ai-suggestion-panel]");
    const suggestionMessage = form.querySelector("[data-ai-message]");
    const fieldStatuses = form.querySelector("[data-ai-field-status]");
    const warningList = form.querySelector("[data-ai-warnings]");
    const closeButtons = [...dialog.querySelectorAll("[data-close-transaction-overlay]")];

    let opener = null;

    const setDetailControlsEnabled = (enabled) => {
      form.querySelectorAll("[data-overlay-detail-control]").forEach((control) => {
        if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
          control.disabled = !enabled;
        }
      });
    };

    const revealDetails = ({ focus = true } = {}) => {
      if (details instanceof HTMLElement) details.hidden = false;
      if (footer instanceof HTMLElement) footer.hidden = false;
      setDetailControlsEnabled(true);
      applyTypeState();
      if (focus) {
        const first = details?.querySelector("input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
        if (first instanceof HTMLElement) first.focus();
      }
    };

    const resetSuggestion = () => {
      if (tokenInput instanceof HTMLInputElement) tokenInput.value = "";
      if (suggestionPanel instanceof HTMLElement) suggestionPanel.hidden = true;
      if (suggestionMessage instanceof HTMLElement) suggestionMessage.textContent = "";
      if (fieldStatuses instanceof HTMLElement) fieldStatuses.replaceChildren();
      if (warningList instanceof HTMLUListElement) {
        warningList.replaceChildren();
        warningList.hidden = true;
      }
    };

    const applyTypeState = () => {
      if (mode === "PERSONAL" && kindSelect instanceof HTMLSelectElement) {
        setCategoryGroups(categorySelect, kindSelect.value);
        return;
      }
      if (mode !== "FUND" || !(fundTypeSelect instanceof HTMLSelectElement)) return;

      const type = fundTypeSelect.value;
      const categoryField = form.querySelector("[data-fund-category-field]");
      const relatedField = form.querySelector("[data-fund-related-user-field]");
      const refundField = form.querySelector("[data-fund-refund-field]");
      const relatedSelect = form.elements.namedItem("relatedUserId");
      const recipientSelect = form.elements.namedItem("recipientUserId");
      const help = form.querySelector("[data-fund-type-help]");

      const isIncomeOrExpense = type === "FUND_INCOME" || type === "FUND_EXPENSE";
      if (categoryField instanceof HTMLElement) categoryField.hidden = !isIncomeOrExpense;
      if (categorySelect instanceof HTMLSelectElement) {
        categorySelect.disabled = !isIncomeOrExpense;
        categorySelect.required = isIncomeOrExpense;
        if (isIncomeOrExpense) setCategoryGroups(categorySelect, type);
        else categorySelect.value = "";
      }

      const showRelated = isIncomeOrExpense;
      if (relatedField instanceof HTMLElement) relatedField.hidden = !showRelated;
      if (relatedSelect instanceof HTMLSelectElement) relatedSelect.disabled = !showRelated;

      const showRefund = type === "FUND_REFUND";
      if (refundField instanceof HTMLElement) refundField.hidden = !showRefund;
      if (recipientSelect instanceof HTMLSelectElement) recipientSelect.disabled = !showRefund;

      if (type === "FUND_INCOME") form.action = form.dataset.fundIncomeRoute || form.action;
      if (type === "FUND_EXPENSE") form.action = form.dataset.fundExpenseRoute || form.action;
      if (type === "FUND_CONTRIBUTION") form.action = form.dataset.fundContributionRoute || form.action;
      if (type === "FUND_REFUND") form.action = form.dataset.fundRefundRoute || form.action;

      if (submitButton instanceof HTMLButtonElement) {
        const labels = {
          FUND_INCOME: "基金収入を登録",
          FUND_EXPENSE: "基金支出を登録",
          FUND_CONTRIBUTION: "基金へ拠出",
          FUND_REFUND: "基金返金を登録",
        };
        submitButton.textContent = labels[type] || "取引を登録";
      }

      if (help instanceof HTMLElement) {
        const messages = {
          FUND_INCOME: "外部寄付、助成金、イベント収益などの基金収入です。",
          FUND_EXPENSE: "備品費、会場費、活動費などの基金支出です。",
          FUND_CONTRIBUTION: "拠出者はログイン中のあなた本人です。個人家計簿では支出として表示されます。",
          FUND_REFUND: "返金先を確認してください。外部返金は基金側だけに表示されます。",
        };
        help.textContent = messages[type] || "種類を選択すると、必要な確認項目へ切り替わります。";
      }
    };

    const renderSuggestion = (payload, target) => {
      const suggestion = payload?.suggestion;
      if (!suggestion) return;
      revealDetails({ focus: false });

      if (mode === "PERSONAL" && kindSelect instanceof HTMLSelectElement) {
        kindSelect.value = suggestion.transactionType === "INCOME" ? "income" : "expense";
        applyTypeState();
      }
      if (mode === "FUND" && fundTypeSelect instanceof HTMLSelectElement) {
        fundTypeSelect.value = target;
        applyTypeState();
      }
      if (amountInput instanceof HTMLInputElement && suggestion.amount !== null) amountInput.value = String(suggestion.amount);
      if (dateInput instanceof HTMLInputElement) dateInput.value = suggestion.transactionDate || payload.referenceDate || dateInput.value;
      if (categorySelect instanceof HTMLSelectElement) categorySelect.value = suggestion.category || "";
      if (tokenInput instanceof HTMLInputElement) tokenInput.value = payload.suggestionToken || "";

      if (suggestionPanel instanceof HTMLElement) suggestionPanel.hidden = false;
      if (suggestionMessage instanceof HTMLElement) {
        suggestionMessage.textContent = payload.message || "候補を表示しました。";
        suggestionMessage.dataset.source = payload.source || "";
      }
      if (fieldStatuses instanceof HTMLElement) {
        fieldStatuses.replaceChildren();
        [
          ["種類", suggestion.fieldStatus?.transactionType],
          ["金額", suggestion.fieldStatus?.amount],
          ["取引日", suggestion.transactionDate ? suggestion.fieldStatus?.transactionDate : "DEFAULTED"],
          ["カテゴリ", suggestion.fieldStatus?.category],
        ].forEach(([label, fieldStatus]) => {
          const dt = document.createElement("dt");
          dt.textContent = label;
          const dd = document.createElement("dd");
          dd.textContent = statusLabels[fieldStatus] || "要確認";
          dd.dataset.status = fieldStatus || "";
          fieldStatuses.append(dt, dd);
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
      setStatus(status, "候補を詳細フォームへ反映しました。内容を確認してください。", payload.ok === false ? "warning" : "");
      const firstMissing = details?.querySelector("input:invalid:not([disabled]), select:invalid:not([disabled])");
      if (firstMissing instanceof HTMLElement) firstMissing.focus();
    };

    const inferFundTarget = (text) => {
      if (contributionPattern.test(text)) return "FUND_CONTRIBUTION";
      if (refundPattern.test(text)) return "FUND_REFUND";
      return incomePattern.test(text) ? "FUND_INCOME" : "FUND_EXPENSE";
    };

    const runClassification = async () => {
      if (!(rawText instanceof HTMLTextAreaElement) || !(aiButton instanceof HTMLButtonElement)) return;
      const text = rawText.value.trim();
      if (!text) {
        rawText.focus();
        rawText.setCustomValidity("AIで推定する内容を入力してください。");
        rawText.reportValidity();
        rawText.setCustomValidity("");
        return;
      }

      let target = mode;
      let fallbackKind = incomePattern.test(text) ? "income" : "expense";
      if (mode === "FUND") {
        target = inferFundTarget(text);
        if (target === "FUND_CONTRIBUTION" || target === "FUND_REFUND") {
          revealDetails({ focus: false });
          if (fundTypeSelect instanceof HTMLSelectElement) fundTypeSelect.value = target;
          applyTypeState();
          resetSuggestion();
          setStatus(status, "拠出・返金はAI分類対象外です。種類と対象者を手動で確認してください。", "warning");
          fundTypeSelect?.focus();
          return;
        }
      }

      aiButton.disabled = true;
      aiButton.textContent = "推定中…";
      form.setAttribute("aria-busy", "true");
      setStatus(status, "AIで候補を作成しています。", "");
      try {
        const body = { rawText: text, target };
        if (mode === "PERSONAL") body.fallbackKind = fallbackKind;
        if (mode !== "PERSONAL") body.groupId = Number(form.dataset.overlayGroupId);
        const response = await fetch("/api/ai/classify-transaction", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => null);
        if (!payload?.suggestion) throw new Error(payload?.message || "AI候補を取得できませんでした。");
        renderSuggestion(payload, target);
      } catch (error) {
        revealDetails({ focus: false });
        setStatus(status, error instanceof Error ? `${error.message} 手動で入力してください。` : "AI候補を取得できませんでした。手動で入力してください。", "error");
        const first = details?.querySelector("input:not([disabled]), select:not([disabled])");
        if (first instanceof HTMLElement) first.focus();
      } finally {
        aiButton.disabled = false;
        aiButton.textContent = "AIで推定";
        form.removeAttribute("aria-busy");
      }
    };

    const resetOverlay = () => {
      if (typeof window.appUiResetValidation === "function") window.appUiResetValidation(dialog);
      form.reset();
      form.dataset.submitting = "false";
      form.dataset.overlaySubmitting = "false";
      form.removeAttribute("aria-busy");
      setDetailControlsEnabled(false);
      if (details instanceof HTMLElement) details.hidden = true;
      if (footer instanceof HTMLElement) footer.hidden = true;
      resetSuggestion();
      setStatus(status, "", "");
      if (mode === "PERSONAL" && kindSelect instanceof HTMLSelectElement) applyTypeState();
      if (mode === "FUND") applyTypeState();
      if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
      closeButtons.forEach((button) => {
        if (button instanceof HTMLButtonElement) button.disabled = false;
        button.setAttribute("aria-disabled", "false");
      });
    };

    document.querySelectorAll(`[data-open-transaction-overlay="${dialog.id}"]`).forEach((button) => {
      button.addEventListener("click", () => {
        opener = button instanceof HTMLElement ? button : null;
        resetOverlay();
        dialog.showModal();
        requestAnimationFrame(() => rawText instanceof HTMLTextAreaElement && rawText.focus());
      });
    });

    dialog.querySelectorAll("[data-close-transaction-overlay]").forEach((button) => {
      button.addEventListener("click", () => {
        if (form.dataset.submitting === "true" || form.dataset.overlaySubmitting === "true") return;
        dialog.close();
      });
    });

    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && form.dataset.submitting !== "true" && form.dataset.overlaySubmitting !== "true") dialog.close();
    });
    dialog.addEventListener("cancel", (event) => {
      if (form.dataset.submitting === "true" || form.dataset.overlaySubmitting === "true") event.preventDefault();
    });
    dialog.addEventListener("close", () => {
      resetOverlay();
      opener?.focus();
    });

    manualButton?.addEventListener("click", () => {
      revealDetails();
      setStatus(status, "詳細フォームを表示しました。必要項目を入力してください。", "");
    });
    aiButton?.addEventListener("click", runClassification);
    kindSelect?.addEventListener("change", applyTypeState);
    fundTypeSelect?.addEventListener("change", () => {
      resetSuggestion();
      applyTypeState();
    });

    form.addEventListener("submit", (event) => {
      if (details instanceof HTMLElement && details.hidden) {
        event.preventDefault();
        revealDetails();
        setStatus(status, "詳細を確認してから登録してください。", "warning");
        return;
      }
      if (mode === "FUND" && fundTypeSelect instanceof HTMLSelectElement && !fundTypeSelect.value) {
        event.preventDefault();
        fundTypeSelect.focus();
        fundTypeSelect.reportValidity();
        return;
      }
      if (form.dataset.overlaySubmitting === "true") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      form.dataset.overlaySubmitting = "true";
      form.setAttribute("aria-busy", "true");
      setStatus(status, "登録処理中です。この画面を閉じずにお待ちください。", "loading");
      closeButtons.forEach((button) => {
        if (button instanceof HTMLButtonElement) button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      });
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = true;
        submitButton.textContent = "登録中…";
      }
    });

    resetOverlay();
  });
})();
