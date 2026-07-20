export const VIEW_IDS = Object.freeze([
  "location",
  "map",
  "log",
]);

const VIEW_ID_SET = new Set(VIEW_IDS);

export function createViewTabs({
  app,
  tablist,
  tabs,
  panels,
  initialView = "location",
  canActivate = () => true,
  onChange = () => {},
} = {}) {
  if (!app || !tablist) {
    throw new Error("View tabs require the app and tablist elements");
  }
  for (const viewId of VIEW_IDS) {
    if (!tabs?.[viewId] || !panels?.[viewId]) {
      throw new Error(`View tabs require ${viewId} tab and panel elements`);
    }
  }

  let activeView = VIEW_ID_SET.has(initialView) ? initialView : "location";
  let disabled = false;
  const removers = [];

  const applyView = (viewId) => {
    for (const candidate of VIEW_IDS) {
      const selected = candidate === viewId;
      tabs[candidate].setAttribute("aria-selected", String(selected));
      tabs[candidate].tabIndex = selected ? 0 : -1;
      panels[candidate].hidden = !selected;
      if (selected) panels[candidate].removeAttribute("inert");
      else panels[candidate].setAttribute("inert", "");
    }
    app.dataset.view = viewId;
  };

  const activate = (viewId, { focus = false } = {}) => {
    if (
      disabled ||
      !VIEW_ID_SET.has(viewId) ||
      viewId === activeView ||
      !canActivate(viewId, activeView)
    ) {
      if (focus && VIEW_ID_SET.has(viewId)) tabs[viewId].focus();
      return false;
    }
    const previousView = activeView;
    activeView = viewId;
    applyView(viewId);
    if (focus) tabs[viewId].focus();
    onChange(viewId, previousView);
    return true;
  };

  for (const viewId of VIEW_IDS) {
    const handleClick = () => activate(viewId);
    tabs[viewId].addEventListener("click", handleClick);
    removers.push(() => tabs[viewId].removeEventListener("click", handleClick));
  }

  const handleKeydown = (event) => {
    const currentIndex = VIEW_IDS.findIndex(
      (viewId) => tabs[viewId] === event?.target,
    );
    if (currentIndex < 0) return;
    let nextIndex = null;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % VIEW_IDS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + VIEW_IDS.length) % VIEW_IDS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = VIEW_IDS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    activate(VIEW_IDS[nextIndex], { focus: true });
  };
  tablist.addEventListener("keydown", handleKeydown);
  removers.push(() => tablist.removeEventListener("keydown", handleKeydown));

  applyView(activeView);

  return {
    get activeView() {
      return activeView;
    },
    activate,
    setDisabled(nextDisabled) {
      disabled = Boolean(nextDisabled);
      for (const viewId of VIEW_IDS) tabs[viewId].disabled = disabled;
    },
    destroy() {
      while (removers.length > 0) removers.pop()();
    },
  };
}
