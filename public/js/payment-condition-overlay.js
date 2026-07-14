(() => {
  const dialog = document.querySelector("[data-payment-condition-dialog]");
  const openButton = document.querySelector("[data-open-payment-conditions]");
  const form = document.querySelector("[data-split-preview-form]");

  if (!(dialog instanceof HTMLDialogElement) || !(form instanceof HTMLFormElement)) return;

  const methodLabel = dialog.querySelector("[data-condition-method-label]");
  const participantSummary = dialog.querySelector("[data-condition-participant-summary]");
  const closeButtons = dialog.querySelectorAll("[data-close-payment-conditions]");
  let returnTarget = openButton instanceof HTMLElement ? openButton : null;

  const focusFirstField = () => {
    const firstField = form.querySelector("input:not([type='hidden']), textarea, select");
    if (firstField instanceof HTMLElement) firstField.focus();
  };

  const openDialog = (trigger = null) => {
    if (form.dataset.submitting === "true") return;
    if (trigger instanceof HTMLElement) returnTarget = trigger;
    if (!dialog.open) dialog.showModal();
    focusFirstField();
  };

  const closeDialog = () => {
    if (form.dataset.submitting === "true") return;
    dialog.close("back");
  };

  openButton?.addEventListener("click", () => {
    if (openButton instanceof HTMLButtonElement && openButton.disabled) return;
    openDialog(openButton instanceof HTMLElement ? openButton : null);
  });

  closeButtons.forEach((button) => button.addEventListener("click", closeDialog));

  dialog.addEventListener("cancel", (event) => {
    if (form.dataset.submitting === "true") {
      event.preventDefault();
    }
  });

  dialog.addEventListener("close", () => {
    if (returnTarget instanceof HTMLElement) returnTarget.focus();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });

  window.addEventListener("payments:selection-updated", (event) => {
    const detail = event instanceof CustomEvent ? event.detail : null;
    if (methodLabel instanceof HTMLElement) {
      methodLabel.textContent = typeof detail?.methodLabel === "string" ? detail.methodLabel : "未選択";
    }
    if (participantSummary instanceof HTMLElement) {
      const participantCount = Number(detail?.participantCount ?? 0);
      participantSummary.textContent = `${Number.isFinite(participantCount) ? participantCount : 0} 人`;
    }
  });

  window.addEventListener("payments:open-condition-dialog", () => {
    openDialog(openButton instanceof HTMLElement ? openButton : null);
  });

  if (dialog.dataset.autoOpen === "true") {
    openDialog(openButton instanceof HTMLElement ? openButton : null);
  }
})();
