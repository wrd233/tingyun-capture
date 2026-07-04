export function injectedObserverSource(): string {
  return `
(() => {
  if (window.__TINGYUN_CAPTURE_INSTALLED__) return;
  window.__TINGYUN_CAPTURE_INSTALLED__ = true;

  const send = (payload) => {
    try {
      window.tyCaptureEvent && window.tyCaptureEvent(payload);
    } catch {}
  };

  const textOf = (el) => (el && (el.innerText || el.textContent || "") || "").trim().replace(/\\s+/g, " ").slice(0, 240);
  const labelFor = (el) => {
    if (!el) return undefined;
    if (el.labels && el.labels[0]) return textOf(el.labels[0]);
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) return textOf(label);
    }
    const parent = el.closest("label");
    return parent ? textOf(parent) : undefined;
  };
  const controlSnapshot = (el) => {
    if (!el) return {};
    const attrs = {};
    for (const name of ["id", "name", "type", "role", "aria-label", "aria-labelledby", "placeholder", "data-testid"]) {
      const value = el.getAttribute && el.getAttribute(name);
      if (value) attrs[name] = value;
    }
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : undefined,
      role: el.getAttribute && el.getAttribute("role") || undefined,
      text: textOf(el),
      label: labelFor(el),
      accessible_name: el.getAttribute && (el.getAttribute("aria-label") || undefined),
      type: el.getAttribute && (el.getAttribute("type") || undefined),
      placeholder: el.getAttribute && (el.getAttribute("placeholder") || undefined),
      attrs
    };
  };
  const fieldValue = (el) => {
    const type = (el.getAttribute && el.getAttribute("type") || "").toLowerCase();
    const name = ((el.getAttribute && (el.getAttribute("name") || el.getAttribute("id") || el.getAttribute("aria-label"))) || "").toLowerCase();
    const sensitive = type === "password" || ["password", "passwd", "token", "secret", "access_token", "refresh_token"].some((word) => name.includes(word));
    if (sensitive) return { value: "***NOT_CAPTURED***", changed: true, sensitive: true };
    if (el instanceof HTMLInputElement && (type === "checkbox" || type === "radio")) return { checked: el.checked, value: el.value };
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return { value: el.value };
    return {};
  };
  const optionSnapshot = (select) => Array.from(select.options || []).map((option) => ({
    label: option.label || option.textContent || "",
    value: option.value,
    selected: option.selected,
    disabled: option.disabled
  }));
  const formSnapshot = (root) => {
    const container = root && (root.closest && (root.closest("form") || root.closest("[role=form]") || root.closest(".form") || root.closest("[data-form]"))) || document;
    return Array.from(container.querySelectorAll("input, select, textarea, button")).slice(0, 200).map((field) => ({
      control: controlSnapshot(field),
      value: fieldValue(field),
      options: field instanceof HTMLSelectElement ? optionSnapshot(field) : undefined,
      disabled: Boolean(field.disabled),
      visible: Boolean(field.offsetParent || field.getClientRects().length)
    }));
  };
  const isSubmitCandidate = (el) => {
    const text = (textOf(el) + " " + (el.getAttribute && (el.getAttribute("aria-label") || el.value || ""))).toLowerCase();
    const type = (el.getAttribute && el.getAttribute("type") || "").toLowerCase();
    return type === "submit" || ["保存", "提交", "确定", "创建", "新增", "应用", "完成"].some((word) => text.includes(word));
  };

  const beforeSubmit = (el, interactionType) => {
    if (isSubmitCandidate(el)) {
      send({ kind: "form_state", context: "before_submit", state: formSnapshot(el), interaction_type: interactionType });
    }
  };

  document.addEventListener("click", (event) => {
    const el = event.target && event.target.closest ? event.target.closest("button, a, input, select, textarea, [role=button]") : event.target;
    beforeSubmit(el, "click");
    send({ kind: "interaction", interaction_type: "click", control: controlSnapshot(el), value: fieldValue(el), url: location.href, title: document.title });
    if (el && (el.matches("select,input,textarea") || isSubmitCandidate(el))) {
      setTimeout(() => send({ kind: "form_state", context: "after_interaction", state: formSnapshot(el), interaction_type: "click" }), 700);
    }
  }, true);

  for (const type of ["change", "blur"]) {
    document.addEventListener(type, (event) => {
      const el = event.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
      send({ kind: "interaction", interaction_type: el instanceof HTMLSelectElement ? "select" : type, control: controlSnapshot(el), value: fieldValue(el), options: el instanceof HTMLSelectElement ? optionSnapshot(el) : undefined, url: location.href, title: document.title });
      setTimeout(() => send({ kind: "form_state", context: "after_interaction", state: formSnapshot(el), interaction_type: type }), 700);
    }, true);
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const el = event.target;
    beforeSubmit(el, "enter");
    send({ kind: "interaction", interaction_type: "enter", control: controlSnapshot(el), value: fieldValue(el), url: location.href, title: document.title });
  }, true);
  document.addEventListener("submit", (event) => {
    send({ kind: "form_state", context: "before_submit", state: formSnapshot(event.target), interaction_type: "submit" });
    send({ kind: "interaction", interaction_type: "submit", control: controlSnapshot(event.target), url: location.href, title: document.title });
  }, true);

  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  history.pushState = function(...args) {
    const before = location.href;
    const result = originalPush.apply(this, args);
    send({ kind: "url_change", change_type: "pushState", before_url: before, after_url: location.href });
    return result;
  };
  history.replaceState = function(...args) {
    const before = location.href;
    const result = originalReplace.apply(this, args);
    send({ kind: "url_change", change_type: "replaceState", before_url: before, after_url: location.href });
    return result;
  };
  window.addEventListener("hashchange", (event) => send({ kind: "url_change", change_type: "hashchange", before_url: event.oldURL, after_url: event.newURL }));
})();
`;
}

declare global {
  interface Window {
    __TINGYUN_CAPTURE_INSTALLED__?: boolean;
    tyCaptureEvent?: (payload: unknown) => void;
  }
}
