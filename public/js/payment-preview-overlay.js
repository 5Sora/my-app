(() => {
  const dialog = document.querySelector("[data-payment-preview-dialog]");
  if (!(dialog instanceof HTMLDialogElement)) return;

  const returnTarget = document.querySelector("[data-open-payment-conditions]");
  const editButton = dialog.querySelector("[data-edit-split-conditions]");
  const closeLink = dialog.querySelector("[data-cancel-payment-preview]");
  const confirmForm = document.getElementById("split-confirm-form");

  const openDialog = () => {
    if (!dialog.open) dialog.showModal();
    const heading = dialog.querySelector("h2");
    if (heading instanceof HTMLElement) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  };

  const closeForEditing = () => {
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
  closeLink?.addEventListener("click", () => {
    if (confirmForm?.dataset.submitting === "true") return;
  });

  openDialog();
})();
