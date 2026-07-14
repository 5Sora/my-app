(() => {
  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  const closeSelector = [
    "[data-close-ai-analysis-dialog]",
    "[data-close-transaction-overlay]",
    "[data-close-payment-conditions]",
    "[data-close-personal-dialog]",
    "[data-close-dialog]",
    "[data-close-payment-dialog]",
    "[data-edit-split-conditions]",
    "[data-cancel-payment-preview]",
  ].join(",");

  const openerByDialog = new WeakMap();
  let generatedId = 0;

  const makeLiveRegion = (kind) => {
    const region = document.createElement("div");
    region.className = "ui-live-region";
    region.dataset.uiLive = kind;
    region.setAttribute("aria-live", kind === "alert" ? "assertive" : "polite");
    region.setAttribute("aria-atomic", "true");
    if (kind === "alert") region.setAttribute("role", "alert");
    else region.setAttribute("role", "status");
    document.body.append(region);
    return region;
  };

  const statusRegion = makeLiveRegion("status");
  const alertRegion = makeLiveRegion("alert");

  const announce = (message, kind = "status") => {
    const region = kind === "alert" ? alertRegion : statusRegion;
    region.textContent = "";
    window.setTimeout(() => { region.textContent = String(message || ""); }, 10);
  };

  window.appUiAnnounce = announce;

  const getFocusable = (dialog) => [...dialog.querySelectorAll(focusableSelector)]
    .filter((element) => element instanceof HTMLElement && !element.hidden && element.getClientRects().length > 0);

  const isSubmitting = (dialog) => Boolean(dialog.querySelector(
    "form[data-submitting='true'], form[data-overlay-submitting='true']",
  ));

  const syncSubmittingState = (dialog) => {
    const submitting = isSubmitting(dialog);
    dialog.dataset.dialogSubmitting = String(submitting);
    dialog.querySelectorAll(closeSelector).forEach((control) => {
      if (control instanceof HTMLButtonElement) control.disabled = submitting;
      control.setAttribute("aria-disabled", String(submitting));
    });
  };

  const syncBodyModalState = () => {
    document.body.dataset.modalOpen = String(Boolean(document.querySelector("dialog[open]")));
  };

  const ensureDialogName = (dialog) => {
    dialog.setAttribute("aria-modal", "true");
    if (dialog.hasAttribute("aria-labelledby") || dialog.hasAttribute("aria-label")) return;
    const heading = dialog.querySelector("h1, h2, h3");
    if (!(heading instanceof HTMLElement)) return;
    if (!heading.id) heading.id = `dialog-title-${++generatedId}`;
    dialog.setAttribute("aria-labelledby", heading.id);
  };

  const focusDialog = (dialog) => {
    if (!dialog.open || dialog.contains(document.activeElement)) return;
    const explicit = dialog.querySelector("[data-dialog-initial-focus], [autofocus]");
    const heading = dialog.querySelector("h1, h2, h3");
    const target = explicit instanceof HTMLElement
      ? explicit
      : heading instanceof HTMLElement
        ? heading
        : getFocusable(dialog)[0];
    if (!(target instanceof HTMLElement)) return;
    if (target === heading && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  };

  const initDialog = (dialog) => {
    ensureDialogName(dialog);
    syncSubmittingState(dialog);

    const observer = new MutationObserver(() => {
      if (dialog.open) {
        syncBodyModalState();
        syncSubmittingState(dialog);
        requestAnimationFrame(() => focusDialog(dialog));
      } else {
        syncBodyModalState();
      }
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    observer.observe(dialog, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-submitting", "data-overlay-submitting", "aria-busy"],
    });

    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusable = getFocusable(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    dialog.addEventListener("cancel", (event) => {
      if (!isSubmitting(dialog)) return;
      event.preventDefault();
      announce("処理中のため、この画面は閉じられません。", "alert");
    });

    dialog.addEventListener("close", () => {
      syncBodyModalState();
      resetValidationState(dialog);
      dialog.querySelectorAll("form").forEach((form) => {
        form.dataset.submitting = "false";
        form.dataset.overlaySubmitting = "false";
        form.removeAttribute("aria-busy");
      });
      const opener = openerByDialog.get(dialog);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    });
  };

  document.querySelectorAll("dialog").forEach((dialog) => {
    if (dialog instanceof HTMLDialogElement) initDialog(dialog);
  });

  const targetDialogForTrigger = (trigger) => {
    if (!(trigger instanceof HTMLElement)) return null;
    const id = trigger.dataset.openTransactionOverlay
      || trigger.dataset.openPersonalDialog
      || trigger.dataset.openDialog
      || trigger.dataset.openPaymentDialog;
    if (id) {
      const dialog = document.getElementById(id);
      return dialog instanceof HTMLDialogElement ? dialog : null;
    }
    if (trigger.matches("[data-ai-analysis-button]")) {
      const dialog = document.querySelector("[data-ai-analysis-dialog]");
      return dialog instanceof HTMLDialogElement ? dialog : null;
    }
    if (trigger.matches("[data-open-payment-conditions]")) {
      const dialog = document.querySelector("[data-payment-condition-dialog]");
      return dialog instanceof HTMLDialogElement ? dialog : null;
    }
    return null;
  };

  document.addEventListener("click", (event) => {
    const trigger = event.target instanceof Element
      ? event.target.closest("[data-open-transaction-overlay], [data-open-personal-dialog], [data-open-dialog], [data-open-payment-dialog], [data-ai-analysis-button], [data-open-payment-conditions]")
      : null;
    const dialog = targetDialogForTrigger(trigger);
    if (dialog && trigger instanceof HTMLElement) {
      openerByDialog.set(dialog, trigger);
      resetValidationState(dialog);
    }

    const closeControl = event.target instanceof Element ? event.target.closest(closeSelector) : null;
    const currentDialog = closeControl?.closest("dialog");
    if (currentDialog instanceof HTMLDialogElement && isSubmitting(currentDialog)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      announce("処理中のため、この画面は閉じられません。", "alert");
    }
  }, true);

  const getFieldLabel = (field) => {
    if (!(field instanceof HTMLElement)) return "入力項目";
    const label = field.closest("label")?.querySelector("span, strong");
    if (label?.textContent?.trim()) return label.textContent.trim();
    if (field.id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
      if (explicit?.textContent?.trim()) return explicit.textContent.trim();
    }
    return field.getAttribute("aria-label") || field.getAttribute("name") || "入力項目";
  };

  const clearFieldError = (field) => {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
    if (!field.validity.valid) return;
    field.removeAttribute("aria-invalid");
    const errorId = field.dataset.uiErrorId;
    if (!errorId) return;
    document.getElementById(errorId)?.remove();
    const described = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean).filter((id) => id !== errorId);
    if (described.length) field.setAttribute("aria-describedby", described.join(" "));
    else field.removeAttribute("aria-describedby");
    delete field.dataset.uiErrorId;
  };


  const resetValidationState = (root) => {
    if (!(root instanceof Element || root instanceof Document)) return;
    root.querySelectorAll("[data-ui-validation-summary]").forEach((summary) => summary.remove());
    root.querySelectorAll(".ui-field-error").forEach((error) => error.remove());
    root.querySelectorAll("[aria-invalid='true']").forEach((field) => {
      field.removeAttribute("aria-invalid");
      const errorId = field.dataset?.uiErrorId;
      if (errorId) {
        const described = (field.getAttribute("aria-describedby") || "")
          .split(/\s+/)
          .filter(Boolean)
          .filter((id) => id !== errorId);
        if (described.length) field.setAttribute("aria-describedby", described.join(" "));
        else field.removeAttribute("aria-describedby");
        delete field.dataset.uiErrorId;
      }
    });
  };

  window.appUiResetValidation = resetValidationState;

  document.querySelectorAll("form").forEach((form, formIndex) => {
    form.addEventListener("invalid", (event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
      field.setAttribute("aria-invalid", "true");
      if (!field.id) field.id = `form-${formIndex + 1}-field-${++generatedId}`;
      const errorId = `${field.id}-validation-error`;
      field.dataset.uiErrorId = errorId;
      let error = document.getElementById(errorId);
      if (!(error instanceof HTMLElement)) {
        error = document.createElement("span");
        error.id = errorId;
        error.className = "ui-field-error";
        field.insertAdjacentElement("afterend", error);
      }
      const label = getFieldLabel(field);
      error.textContent = field.validationMessage || `${label}を確認してください。`;
      const described = new Set((field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      described.add(errorId);
      field.setAttribute("aria-describedby", [...described].join(" "));

      let summary = form.querySelector("[data-ui-validation-summary]");
      if (!(summary instanceof HTMLElement)) {
        summary = document.createElement("p");
        summary.className = "ui-validation-summary";
        summary.dataset.uiValidationSummary = "true";
        summary.setAttribute("role", "alert");
        summary.setAttribute("tabindex", "-1");
        form.prepend(summary);
      }
      summary.textContent = `${label}：${error.textContent}`;
      announce(summary.textContent, "alert");
    }, true);

    form.addEventListener("input", (event) => clearFieldError(event.target));
    form.addEventListener("change", (event) => clearFieldError(event.target));
  });

  const syncDisabled = (root = document) => {
    root.querySelectorAll?.("button, input, select, textarea").forEach((control) => {
      if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
        control.setAttribute("aria-disabled", String(control.disabled));
      }
    });
  };
  syncDisabled();
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.target instanceof HTMLElement) syncDisabled(record.target.parentElement || document);
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["disabled"] });

  document.querySelectorAll(".flash-area").forEach((area) => {
    area.setAttribute("role", "region");
    area.setAttribute("aria-label", "操作結果");
    area.setAttribute("aria-atomic", "true");
  });

  syncBodyModalState();
})();
