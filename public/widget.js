(() => {
  const defaults = {
    apiBaseUrl: "",
    brandName: "Support",
    primaryColor: "#f64e9a",
    darkColor: "#0f0f0f",
    lightColor: "#f5f5f5",
    faqs: [
      {
        question: "WHEN WILL MY ORDER GET DELIVERED?",
        answer: "Most orders arrive within 5 to 10 business days. During festive seasons or public holidays, shipping may take a little longer."
      },
      {
        question: "DO YOU SHIP TO ALL PARTS OF INDIA?",
        answer: "Yes! We deliver PAN India, so your order can reach you wherever you are."
      },
      {
        question: "ARE RETURNS OR EXCHANGES POSSIBLE?",
        answer: "Size-related exchanges are available. A small return fee of Rs.100-Rs.150 (based on order weight/quantity) applies, and exchanges are subject to size availability. If the requested size is unavailable, a refund will be issued after return and quality check."
      },
      {
        question: "IS CASH ON DELIVERY (COD) AVAILABLE?",
        answer: "Yes, COD is one of the payment options you can select at checkout."
      }
    ]
  };

  const config = { ...defaults, ...(window.ShopifyFaqPopupConfig || {}) };
  const state = { open: false, view: "faq", loading: false };

  injectStyles();
  const root = document.createElement("div");
  root.className = "sfop-root";
  root.innerHTML = render();
  document.body.appendChild(root);
  bindEvents();

  function render() {
    return `
      <button class="sfop-launcher" type="button" aria-label="Open support">
        <svg class="sfop-launcher-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5.2 5.7A7.7 7.7 0 0 1 12 2.5h.2c4.3.1 7.8 3.4 7.8 7.5s-3.5 7.5-7.9 7.5h-.8a8.6 8.6 0 0 1-3-.6l-4.1 2.2c-.4.2-.9-.1-.8-.6l.8-4.1A7.2 7.2 0 0 1 4 10c0-1.6.4-3 1.2-4.3Z"/>
          <circle cx="8.8" cy="10.1" r="1"/>
          <circle cx="12" cy="10.1" r="1"/>
          <circle cx="15.2" cy="10.1" r="1"/>
        </svg>
      </button>
      <section class="sfop-panel" aria-live="polite" aria-hidden="${!state.open}">
        <header class="sfop-header">
          <div>
            <p>${escapeHtml(config.brandName)}</p>
            <h2>FAQ & order tracking</h2>
          </div>
          <button class="sfop-icon-button" type="button" data-sfop-close aria-label="Close">x</button>
        </header>
        <nav class="sfop-tabs" aria-label="Support options">
          <button type="button" class="${state.view === "faq" ? "is-active" : ""}" data-sfop-view="faq">FAQ</button>
          <button type="button" class="${state.view === "track" ? "is-active" : ""}" data-sfop-view="track">Track order</button>
        </nav>
        <div class="sfop-content">
          ${state.view === "faq" ? faqView() : trackView()}
        </div>
      </section>
    `;
  }

  function faqView() {
    return `
      <div class="sfop-faq-list">
        ${config.faqs
          .map(
            (faq, index) => `
              <details class="sfop-faq-item" ${index === 0 ? "open" : ""}>
                <summary>${escapeHtml(faq.question)}</summary>
                <p>${escapeHtml(faq.answer)}</p>
              </details>
            `
          )
          .join("")}
      </div>
    `;
  }

  function trackView(message = "") {
    return `
      <form class="sfop-track-form">
        <label>
          <span>Order number</span>
          <input name="orderNumber" type="text" autocomplete="off" placeholder="#1234" required>
        </label>
        <label>
          <span>Phone number</span>
          <input name="phone" type="tel" autocomplete="tel" placeholder="Phone used on order" required>
        </label>
        <button class="sfop-submit" type="submit" ${state.loading ? "disabled" : ""}>
          ${state.loading ? "Checking..." : "Get tracking link"}
        </button>
        <div class="sfop-message" role="status">${message}</div>
      </form>
    `;
  }

  function bindEvents() {
    root.addEventListener("click", (event) => {
      const launcher = event.target.closest(".sfop-launcher");
      const close = event.target.closest("[data-sfop-close]");
      const tab = event.target.closest("[data-sfop-view]");

      if (launcher) {
        state.open = !state.open;
        refresh();
      }

      if (close) {
        state.open = false;
        refresh();
      }

      if (tab) {
        state.view = tab.dataset.sfopView;
        refresh();
      }
    });

    root.addEventListener("submit", async (event) => {
      if (!event.target.matches(".sfop-track-form")) return;
      event.preventDefault();

      const form = event.target;
      const formData = new FormData(form);
      const orderNumber = String(formData.get("orderNumber") || "").trim();
      const phone = String(formData.get("phone") || "").trim();

      state.loading = true;
      setTrackMessage("");

      try {
        const response = await fetch(`${config.apiBaseUrl}/api/track-order`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderNumber, phone })
        });
        const payload = await response.json();

        if (!response.ok) throw new Error(payload.error || "Could not track this order.");

        setTrackMessage(`
          <strong>AWB: ${escapeHtml(payload.awb)}</strong>
          <a href="${escapeAttribute(payload.trackingUrl)}" target="_blank" rel="noopener">Open Shiprocket tracking</a>
        `);
      } catch (error) {
        setTrackMessage(`<span class="sfop-error">${escapeHtml(error.message)}</span>`);
      } finally {
        state.loading = false;
        const submit = root.querySelector(".sfop-submit");
        if (submit) {
          submit.disabled = false;
          submit.textContent = "Get tracking link";
        }
      }
    });
  }

  function refresh() {
    root.innerHTML = render();
  }

  function setTrackMessage(message) {
    const messageEl = root.querySelector(".sfop-message");
    const submit = root.querySelector(".sfop-submit");
    if (messageEl) messageEl.innerHTML = message;
    if (submit) {
      submit.disabled = state.loading;
      submit.textContent = state.loading ? "Checking..." : "Get tracking link";
    }
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .sfop-root {
        --sfop-primary: ${config.primaryColor};
        --sfop-dark: ${config.darkColor};
        --sfop-light: ${config.lightColor};
        color: var(--sfop-dark);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        position: relative;
        z-index: 2147483000;
      }

      .sfop-root * {
        box-sizing: border-box;
        letter-spacing: 0;
      }

      .sfop-launcher {
        align-items: center;
        background: var(--sfop-primary);
        border: 0;
        border-radius: 50%;
        bottom: 22px;
        box-shadow: 0 14px 30px rgba(15, 15, 15, 0.24);
        color: #fff;
        cursor: pointer;
        display: flex;
        font-size: 28px;
        font-weight: 800;
        height: 58px;
        justify-content: center;
        line-height: 1;
        position: fixed;
        right: 22px;
        width: 58px;
      }

      .sfop-launcher span {
        transform: translateY(-1px);
      }

      .sfop-launcher-icon {
        fill: currentColor;
        height: 30px;
        width: 30px;
      }

      .sfop-panel {
        background: #fff;
        border: 1px solid rgba(15, 15, 15, 0.12);
        border-radius: 8px;
        bottom: 92px;
        box-shadow: 0 20px 60px rgba(15, 15, 15, 0.22);
        display: flex;
        flex-direction: column;
        max-height: min(680px, calc(100vh - 116px));
        opacity: 0;
        overflow: hidden;
        pointer-events: none;
        position: fixed;
        right: 22px;
        transform: translateY(12px);
        transition: opacity 160ms ease, transform 160ms ease;
        width: min(392px, calc(100vw - 28px));
      }

      .sfop-panel[aria-hidden="false"] {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }

      .sfop-header {
        align-items: center;
        background: var(--sfop-dark);
        color: var(--sfop-light);
        display: flex;
        gap: 16px;
        justify-content: space-between;
        padding: 18px;
      }

      .sfop-header p,
      .sfop-header h2 {
        margin: 0;
      }

      .sfop-header p {
        color: var(--sfop-primary);
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .sfop-header h2 {
        font-size: 19px;
        line-height: 1.2;
      }

      .sfop-icon-button {
        align-items: center;
        background: rgba(245, 245, 245, 0.1);
        border: 1px solid rgba(245, 245, 245, 0.18);
        border-radius: 50%;
        color: var(--sfop-light);
        cursor: pointer;
        display: flex;
        font-size: 18px;
        height: 34px;
        justify-content: center;
        width: 34px;
      }

      .sfop-tabs {
        background: var(--sfop-light);
        display: grid;
        grid-template-columns: 1fr 1fr;
        padding: 8px;
      }

      .sfop-tabs button {
        background: transparent;
        border: 0;
        border-radius: 6px;
        color: var(--sfop-dark);
        cursor: pointer;
        font-size: 14px;
        font-weight: 750;
        min-height: 40px;
      }

      .sfop-tabs button.is-active {
        background: #fff;
        box-shadow: 0 1px 6px rgba(15, 15, 15, 0.1);
      }

      .sfop-content {
        overflow: auto;
        padding: 16px;
      }

      .sfop-faq-list {
        display: grid;
        gap: 10px;
      }

      .sfop-faq-item {
        border: 1px solid rgba(15, 15, 15, 0.12);
        border-radius: 8px;
        overflow: hidden;
      }

      .sfop-faq-item summary {
        cursor: pointer;
        font-size: 14px;
        font-weight: 800;
        line-height: 1.35;
        padding: 14px;
      }

      .sfop-faq-item p {
        background: var(--sfop-light);
        font-size: 14px;
        line-height: 1.5;
        margin: 0;
        padding: 0 14px 14px;
      }

      .sfop-track-form {
        display: grid;
        gap: 13px;
      }

      .sfop-track-form label {
        display: grid;
        gap: 6px;
      }

      .sfop-track-form span {
        font-size: 13px;
        font-weight: 800;
      }

      .sfop-track-form input {
        border: 1px solid rgba(15, 15, 15, 0.18);
        border-radius: 6px;
        color: var(--sfop-dark);
        font: inherit;
        min-height: 44px;
        padding: 10px 12px;
        width: 100%;
      }

      .sfop-track-form input:focus {
        border-color: var(--sfop-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--sfop-primary) 18%, transparent);
        outline: 0;
      }

      .sfop-submit {
        background: var(--sfop-primary);
        border: 0;
        border-radius: 6px;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 850;
        min-height: 46px;
        padding: 12px 14px;
      }

      .sfop-submit:disabled {
        cursor: wait;
        opacity: 0.68;
      }

      .sfop-message {
        font-size: 14px;
        line-height: 1.45;
        min-height: 22px;
      }

      .sfop-message a {
        color: var(--sfop-primary);
        display: block;
        font-weight: 850;
        margin-top: 4px;
      }

      .sfop-error {
        color: #b00020;
      }

      @media (max-width: 520px) {
        .sfop-launcher {
          bottom: 16px;
          right: 16px;
        }

        .sfop-panel {
          bottom: 84px;
          max-height: calc(100vh - 104px);
          right: 14px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value || "");
    return div.innerHTML;
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }
})();
