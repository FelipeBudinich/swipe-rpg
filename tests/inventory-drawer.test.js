import assert from "node:assert/strict";
import test from "node:test";

import { createInventoryDrawer } from "../public/js/ui/inventory-drawer.js";

class FakeDocument extends EventTarget {
  constructor() {
    super();
    this.activeElement = null;
    this.body = { dataset: {} };
  }

  querySelector() {
    return null;
  }
}

class FakeElement extends EventTarget {
  constructor(id) {
    super();
    this.id = id;
    this.dataset = {};
    this.hidden = false;
    this.isConnected = true;
    this.open = false;
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "open") this.open = false;
  }

  focus() {
    globalThis.document.activeElement = this;
  }

  querySelectorAll() {
    return [];
  }

  showModal() {
    this.open = true;
    this.attributes.set("open", "");
  }

  close() {
    this.open = false;
    this.attributes.delete("open");
  }
}

test("Pack opens only the inventory drawer and closing restores focus to its opener", (t) => {
  const hadDocument = Object.hasOwn(globalThis, "document");
  const originalDocument = globalThis.document;
  const fakeDocument = new FakeDocument();
  globalThis.document = fakeDocument;

  const drawer = new FakeElement("inventory-drawer");
  const panel = new FakeElement("inventory-panel");
  const packButton = new FakeElement("inventory-open");
  const closeButton = new FakeElement("inventory-close");
  packButton.setAttribute("aria-expanded", "false");

  const interactionState = {
    decisionCount: 7,
    currentCardToken: "7:opening-hearthvale-oath",
    currentCardId: "opening-hearthvale-oath",
  };
  const beforeOpen = structuredClone(interactionState);
  let openCalls = 0;
  let closeCalls = 0;

  const controller = createInventoryDrawer({
    drawer,
    panel,
    openButton: packButton,
    closeButton,
    onOpen() {
      openCalls += 1;
    },
    onClose() {
      closeCalls += 1;
    },
  });

  t.after(() => {
    controller.destroy();
    if (hadDocument) globalThis.document = originalDocument;
    else delete globalThis.document;
  });

  packButton.focus();
  packButton.dispatchEvent(new Event("click"));

  assert.equal(controller.isOpen, true);
  assert.equal(drawer.open, true);
  assert.equal(drawer.getAttribute("open"), "");
  assert.equal(packButton.getAttribute("aria-expanded"), "true");
  assert.equal(fakeDocument.body.dataset.drawerOpen, "true");
  assert.equal(fakeDocument.activeElement, closeButton);
  assert.equal(openCalls, 1);
  assert.deepEqual(interactionState, beforeOpen);

  closeButton.dispatchEvent(new Event("click"));

  assert.equal(controller.isOpen, false);
  assert.equal(drawer.open, false);
  assert.equal(drawer.getAttribute("open"), null);
  assert.equal(packButton.getAttribute("aria-expanded"), "false");
  assert.equal(fakeDocument.body.dataset.drawerOpen, undefined);
  assert.equal(fakeDocument.activeElement, packButton);
  assert.equal(closeCalls, 1);
  assert.deepEqual(interactionState, beforeOpen);
});
