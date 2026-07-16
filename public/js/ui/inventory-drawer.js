function focusableElements(root) {
  return [...root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

export function createInventoryDrawer({
  drawer,
  panel = drawer?.querySelector("[data-drawer-panel]"),
  openButton,
  closeButton,
  onOpen = () => {},
  onClose = () => {},
}) {
  if (!drawer || !openButton || !closeButton) {
    throw new Error("Inventory drawer elements are missing");
  }

  let opened = false;
  let lastFocused = null;

  const open = () => {
    if (opened) return;
    opened = true;
    lastFocused = document.activeElement;
    openButton.setAttribute("aria-expanded", "true");
    document.body.dataset.drawerOpen = "true";
    onOpen();
    if (typeof drawer.showModal === "function") drawer.showModal();
    else drawer.setAttribute("open", "");
    closeButton.focus();
  };

  const close = () => {
    if (!opened) return;
    opened = false;
    openButton.setAttribute("aria-expanded", "false");
    delete document.body.dataset.drawerOpen;
    onClose();

    if (typeof drawer.close === "function" && drawer.open) drawer.close();
    else drawer.removeAttribute("open");
    const focusTarget = lastFocused?.isConnected ? lastFocused : openButton;
    focusTarget.focus();
  };

  const onBackdrop = (event) => {
    if (event.target !== drawer) return;
    const bounds = drawer.getBoundingClientRect();
    const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    if (!inside) close();
  };

  const onCancel = (event) => {
    event.preventDefault();
    close();
  };

  const onKeyDown = (event) => {
    if (!opened) return;
    if (document.querySelector("#confirm-dialog[open]")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusables = focusableElements(panel ?? drawer);
    if (!focusables.length) {
      event.preventDefault();
      closeButton.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  drawer.addEventListener("pointerdown", onBackdrop);
  drawer.addEventListener("cancel", onCancel);
  document.addEventListener("keydown", onKeyDown);

  return {
    open,
    close,
    get isOpen() {
      return opened;
    },
    destroy() {
      openButton.removeEventListener("click", open);
      closeButton.removeEventListener("click", close);
      drawer.removeEventListener("pointerdown", onBackdrop);
      drawer.removeEventListener("cancel", onCancel);
      document.removeEventListener("keydown", onKeyDown);
    },
  };
}
