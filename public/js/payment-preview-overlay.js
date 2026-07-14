(() => {
  const dialog = document.querySelector("[data-payment-preview-dialog]");
  if (!(dialog instanceof HTMLDialogElement)) return;

  const returnTarget = document.querySelector("[data-open-payment-conditions]");
  const editButton = dialog.querySelector("[data-edit-split-conditions]");
  const closeLink = dialog.querySelector("[data-cancel-payment-preview]");
  const confirmForm = document.getElementById("split-confirm-form");
  const confirmButton = dialog.querySelector("[data-preview-confirm-button]");

  const openDialog = () => {
    if (!dialog.open) dialog.showModal();
    const heading = dialog.querySelector("h2");
    if (heading instanceof HTMLElement) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  };

  const closeForEditing = () => {
    if (confirmForm?.dataset.submitting === "true") return;
    dialog.close("edit");
    window.dispatchEvent(new CustomEvent("payments:open-condition-dialog"));
  };

  editButton?.addEventListener("click", closeForEditing);
  dialog.addEventListener("cancel", (event) => {
    if (confirmForm?.dataset.submitting === "true") {
      event.preventDefault();
      return;
    }
  });
  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "edit" && returnTarget instanceof HTMLElement) returnTarget.focus();
  });
  closeLink?.addEventListener("click", (event) => {
    if (confirmForm?.dataset.submitting === "true") event.preventDefault();
  });

  const syncSubmitting = () => {
    const submitting = confirmForm?.dataset.submitting === "true";
    dialog.dataset.dialogSubmitting = String(submitting);
    dialog.setAttribute("aria-busy", String(submitting));
    if (editButton instanceof HTMLButtonElement) editButton.disabled = submitting;
    if (confirmButton instanceof HTMLButtonElement) confirmButton.disabled = submitting;
    if (closeLink instanceof HTMLElement) closeLink.setAttribute("aria-disabled", String(submitting));
  };
  if (confirmForm) {
    new MutationObserver(syncSubmitting).observe(confirmForm, {
      attributes: true,
      attributeFilter: ["data-submitting", "aria-busy"],
    });
  }
  syncSubmitting();

  openDialog();
})();
