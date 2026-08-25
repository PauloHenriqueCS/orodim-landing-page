/* Shared behaviour for Orodim's public pages: current-page/year helpers, the
   desktop "Ajuda e Legal" dropdown, and the privacy/cookies notice.
   Loaded by index.html and every /privacy, /terms, /support, /account-deletion,
   /contact and /lgpd page so all of them share one implementation instead of
   duplicating navigation or consent logic per page. */
(function () {
  "use strict";

  var HELP_LEGAL_LINKS = [
    { href: "/support", label: "Suporte" },
    { href: "/contact", label: "Contato" },
    { href: "/privacy", label: "Política de Privacidade" },
    { href: "/terms", label: "Termos de Uso" },
    { href: "/lgpd", label: "Central de Privacidade e LGPD" },
    { href: "/account-deletion", label: "Exclusão de conta" }
  ];

  window.LemonSite = { HELP_LEGAL_LINKS: HELP_LEGAL_LINKS };

  function isCapacitorApp() {
    try {
      return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  /* Mark the nav/footer link matching the current URL, everywhere on the
     page, instead of hand-marking aria-current="page" on every nav copy. */
  function markCurrentPage() {
    var path = window.location.pathname.replace(/\/index\.html$/, "").replace(/\/$/, "") || "/";
    var links = document.querySelectorAll('a[href^="/"]');
    for (var i = 0; i < links.length; i++) {
      var raw = links[i].getAttribute("href");
      var clean = raw.split("#")[0].split("?")[0].replace(/\/$/, "") || "/";
      if (clean === path) {
        links[i].setAttribute("aria-current", "page");
      }
    }
  }

  function injectYear() {
    var year = String(new Date().getFullYear());
    var nodes = document.querySelectorAll("[data-current-year]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = year;
    }
  }

  /* Desktop "Ajuda e Legal" dropdown: opens on click (keyboard/touch/mouse),
     opens on hover as an enhancement, closes on Escape, outside click and
     focus leaving the component. */
  function initHelpDropdown() {
    var wrap = document.querySelector("[data-help-dropdown]");
    if (!wrap) return;
    var btn = wrap.querySelector("[data-help-dropdown-btn]");
    var panel = wrap.querySelector("[data-help-dropdown-panel]");
    if (!btn || !panel) return;

    var hoverTimer = null;

    function isOpen() {
      return !panel.hidden;
    }
    function open() {
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    }
    function close() {
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (isOpen()) close(); else open();
    });

    wrap.addEventListener("mouseenter", function () {
      window.clearTimeout(hoverTimer);
      open();
    });
    wrap.addEventListener("mouseleave", function () {
      hoverTimer = window.setTimeout(close, 150);
    });

    wrap.addEventListener("focusout", function (e) {
      if (!wrap.contains(e.relatedTarget)) close();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) {
        close();
        btn.focus();
      }
    });

    document.addEventListener("click", function (e) {
      if (isOpen() && !wrap.contains(e.target)) close();
    });

    close();
  }

  /* Privacy & cookies notice — Scenario A (essential-only technologies).
     This landing page sets no cookies and uses no localStorage/sessionStorage
     of its own, and loads no analytics/marketing scripts, so there is no
     accept/reject choice to offer: only an informative acknowledgement,
     re-openable from the footer at any time. */
  var NOTICE_KEY = "lemon_privacy_notice_v1";
  var NOTICE_VERSION = 1;

  function hasAcknowledgedNotice() {
    try {
      var raw = window.localStorage.getItem(NOTICE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      return !!(data && data.version === NOTICE_VERSION && data.seen === true);
    } catch (e) {
      return false;
    }
  }

  function markNoticeAcknowledged() {
    try {
      window.localStorage.setItem(NOTICE_KEY, JSON.stringify({
        seen: true,
        version: NOTICE_VERSION,
        seenAt: new Date().toISOString()
      }));
    } catch (e) {
      /* localStorage unavailable (e.g. private mode) — notice simply reappears next visit */
    }
  }

  var PrivacyCookieBanner = (function () {
    var el = null;
    var hideTimer = null;

    function build() {
      if (el) return el;
      el = document.createElement("div");
      el.className = "privacy-notice";
      el.hidden = true;
      el.setAttribute("role", "region");
      el.setAttribute("aria-label", "Aviso de privacidade e cookies");
      el.innerHTML =
        '<div class="wrap privacy-notice-inner">' +
          '<p><strong>Privacidade e cookies.</strong> Utilizamos tecnologias essenciais para manter o Orodim funcionando, proteger sua conta e salvar suas preferências. Consulte nossa Política de Privacidade para saber mais.</p>' +
          '<div class="privacy-notice-actions">' +
            '<a class="btn btn-ghost" href="/privacy">Política de Privacidade</a>' +
            '<button type="button" class="btn btn-primary" data-privacy-notice-ack>Entendi</button>' +
          '</div>' +
        "</div>";
      document.body.appendChild(el);
      el.querySelector("[data-privacy-notice-ack]").addEventListener("click", function () {
        markNoticeAcknowledged();
        hide();
      });
      return el;
    }

    function show() {
      if (isCapacitorApp()) return;
      build();
      window.clearTimeout(hideTimer);
      el.hidden = false;
      window.requestAnimationFrame(function () {
        el.classList.add("is-visible");
      });
    }

    function hide() {
      if (!el) return;
      el.classList.remove("is-visible");
      hideTimer = window.setTimeout(function () {
        el.hidden = true;
      }, 200);
    }

    return { show: show, hide: hide };
  })();

  window.PrivacyCookieBanner = PrivacyCookieBanner;
  window.LemonCookieConsent = {
    reopen: function () {
      PrivacyCookieBanner.show();
    }
  };

  function initPrivacyNoticeTriggers() {
    document.addEventListener("click", function (e) {
      var trigger = e.target.closest("[data-open-privacy-notice]");
      if (trigger) {
        e.preventDefault();
        PrivacyCookieBanner.show();
      }
    });
  }

  function initNoticeAutoShow() {
    if (isCapacitorApp()) return;
    if (!hasAcknowledgedNotice()) {
      window.setTimeout(PrivacyCookieBanner.show, 500);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    markCurrentPage();
    injectYear();
    initHelpDropdown();
    initPrivacyNoticeTriggers();
    initNoticeAutoShow();
  });
})();
