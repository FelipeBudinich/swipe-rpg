import assert from "node:assert/strict";
import test from "node:test";

import {
  VIEW_IDS,
  createViewTabs,
} from "../public/js/ui/view-tabs.js";

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.tabIndex = 0;
    this.listeners = new Map();
    this.focused = false;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((value) => value !== listener),
    );
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this, ...event });
    }
  }

  focus() {
    this.focused = true;
  }
}

function fixture(options = {}) {
  const app = new FakeElement();
  const tablist = new FakeElement();
  const tabs = Object.fromEntries(VIEW_IDS.map((id) => [id, new FakeElement()]));
  const panels = Object.fromEntries(VIEW_IDS.map((id) => [id, new FakeElement()]));
  const changes = [];
  const controller = createViewTabs({
    app,
    tablist,
    tabs,
    panels,
    onChange: (...args) => changes.push(args),
    ...options,
  });
  return { app, tablist, tabs, panels, changes, controller };
}

test("Location is selected initially with one active tabpanel", () => {
  const { app, tabs, panels, controller } = fixture();
  assert.equal(controller.activeView, "location");
  assert.equal(app.dataset.view, "location");
  for (const id of VIEW_IDS) {
    const selected = id === "location";
    assert.equal(tabs[id].getAttribute("aria-selected"), String(selected));
    assert.equal(tabs[id].tabIndex, selected ? 0 : -1);
    assert.equal(panels[id].hidden, !selected);
    assert.equal(panels[id].getAttribute("inert"), selected ? null : "");
  }
});

test("click and programmatic activation update panels and notify changes", () => {
  const { app, tabs, panels, changes, controller } = fixture();
  tabs.map.dispatch("click");
  assert.equal(controller.activeView, "map");
  assert.equal(app.dataset.view, "map");
  assert.equal(panels.location.hidden, true);
  assert.equal(panels.map.hidden, false);
  assert.deepEqual(changes, [["map", "location"]]);

  assert.equal(controller.activate("log"), true);
  assert.equal(panels.map.hidden, true);
  assert.equal(panels.log.hidden, false);
  assert.deepEqual(changes.at(-1), ["log", "map"]);
  assert.equal(controller.activate("unknown"), false);
});

test("tablist keys activate, wrap, prevent defaults, and move focus", () => {
  const { tablist, tabs, controller } = fixture();
  const handled = [];
  const key = (target, value) => tablist.dispatch("keydown", {
    target,
    key: value,
    preventDefault: () => handled.push(`${value}:prevented`),
    stopPropagation: () => handled.push(`${value}:stopped`),
  });

  key(tabs.location, "ArrowRight");
  assert.equal(controller.activeView, "map");
  assert.equal(tabs.map.focused, true);
  key(tabs.map, "ArrowLeft");
  assert.equal(controller.activeView, "location");
  key(tabs.location, "ArrowLeft");
  assert.equal(controller.activeView, "log");
  key(tabs.log, "ArrowRight");
  assert.equal(controller.activeView, "location");
  key(tabs.location, "End");
  assert.equal(controller.activeView, "log");
  key(tabs.log, "Home");
  assert.equal(controller.activeView, "location");
  assert.equal(handled.length, 12);
});

test("ArrowUp and ArrowDown are not handled", () => {
  const { tablist, tabs, controller } = fixture();
  let prevented = false;
  for (const key of ["ArrowUp", "ArrowDown"]) {
    tablist.dispatch("keydown", {
      target: tabs.location,
      key,
      preventDefault: () => { prevented = true; },
    });
  }
  assert.equal(prevented, false);
  assert.equal(controller.activeView, "location");
});

test("activation guards, disabling, and destroy are enforced", () => {
  let canActivate = false;
  const { tablist, tabs, controller } = fixture({
    canActivate: () => canActivate,
  });
  assert.equal(controller.activate("map"), false);
  canActivate = true;
  controller.setDisabled(true);
  assert.equal(VIEW_IDS.every((id) => tabs[id].disabled), true);
  assert.equal(controller.activate("map"), false);
  controller.setDisabled(false);
  assert.equal(controller.activate("map"), true);

  controller.destroy();
  tabs.log.dispatch("click");
  tablist.dispatch("keydown", { target: tabs.map, key: "ArrowRight" });
  assert.equal(controller.activeView, "map");
});
