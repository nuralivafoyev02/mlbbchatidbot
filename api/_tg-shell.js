// ---------------------------------------------------------------------------
// Telegram Mini App "qobig'i" — admin panel va "Mening akkauntim" uchun umumiy.
//
// Telefonda (iOS / Android) Mini App fullscreen ochiladi. Fullscreen'da sahifa
// status bar (Dynamic Island / notch) va Telegram'ning "Yopish / ⋯"
// tugmalari ostigacha cho'ziladi, shuning uchun:
//   --safe-top     — status bar / Dynamic Island balandligi (safeAreaInset.top)
//   --tg-bar       — Telegram tugmalari qatori (contentSafeAreaInset.top)
//   --top-space    — ikkalasining yig'indisi: kontent shundan pastda boshlanadi
//   --safe-bottom / --safe-left / --safe-right — qolgan chekkalar
// Shu bo'shliqqa "MLBBBOT" yorlig'i bor fon chiziladi — screenshot olinganda
// Dynamic Island ostida chiroyli turadi.
//
// Desktop / Web Telegram'da fullscreen so'ralmaydi (butun monitorni egallab
// oladi) — u yerda oddiy expand, o'zgaruvchilar 0 bo'lib qoladi.
//
// Ochilish: fullscreen bir zumda o'rnashmaydi (insetlar event bilan keladi).
// O'rnashguncha <html> da `tg-shell-pending`, keyin `tg-shell-ready` turadi va
// `window.tgShellReady` (Promise) resolve bo'ladi — sahifa ochilish ekranini
// shundan keyin yopadi, kontent sakrab ketmaydi.
//
// HTML faylda `<!-- tg-shell -->` belgisi turgan joyga (telegram-web-app.js
// dan keyin) injectTelegramShell() style + script qo'yadi.
// ---------------------------------------------------------------------------

const SHELL_MARKER = "<!-- tg-shell -->";
// Fullscreen javobi kelmasa (eski mijoz, xato) — shuncha kutib, ochamiz.
const FULLSCREEN_WAIT_MS = 900;

function buildShellCss() {
  return `
    :root {
      --safe-top: max(env(safe-area-inset-top, 0px), var(--tg-sa-top, 0px));
      --safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--tg-sa-bottom, 0px));
      --safe-left: max(env(safe-area-inset-left, 0px), var(--tg-sa-left, 0px));
      --safe-right: max(env(safe-area-inset-right, 0px), var(--tg-sa-right, 0px));
      --tg-bar: 0px;
      --top-space: calc(var(--safe-top) + var(--tg-bar));
    }

    .tg-topbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: var(--top-space);
      z-index: 1000;
      display: none;
      pointer-events: none;
      background:
        radial-gradient(120% 140% at 50% 0%, rgba(99, 102, 241, 0.34), transparent 62%),
        linear-gradient(180deg, rgba(10, 14, 30, 0.96), rgba(10, 14, 30, 0.82));
      -webkit-backdrop-filter: blur(18px) saturate(150%);
      backdrop-filter: blur(18px) saturate(150%);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35)
    }

    .tg-topbar::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(167, 139, 250, 0.55), rgba(236, 72, 153, 0.45), transparent)
    }

    html.tg-fullscreen .tg-topbar {
      display: block
    }

    /* Yorliq Telegram tugmalari qatorida, Dynamic Island'ning aynan ostida */
    .tg-brand {
      position: absolute;
      left: 0;
      right: 0;
      top: var(--safe-top);
      height: var(--tg-bar);
      display: flex;
      align-items: center;
      justify-content: center
    }

    .tg-brand span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 13px 5px 11px;
      border-radius: 999px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 11.5px;
      font-weight: 800;
      letter-spacing: 2.4px;
      color: #fff;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.30), rgba(236, 72, 153, 0.22));
      border: 1px solid rgba(255, 255, 255, 0.16);
      box-shadow: 0 4px 16px rgba(99, 102, 241, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.12);
      white-space: nowrap
    }

    .tg-brand i {
      font-size: 13px;
      color: #c4b5fd
    }`;
}

function buildShellScript(color) {
  return `
    (function () {
      var root = document.documentElement;
      var tg = window.Telegram && window.Telegram.WebApp;
      var settled = false;
      var resolveReady;
      window.tgShellReady = new Promise(function (resolve) { resolveReady = resolve; });
      root.classList.add("tg-shell-pending");

      function settle() {
        if (settled) return;
        settled = true;
        root.classList.remove("tg-shell-pending");
        root.classList.add("tg-shell-ready");
        resolveReady();
      }

      function px(value) {
        var n = Number(value);
        return (isFinite(n) && n > 0 ? n : 0) + "px";
      }

      function applyInsets() {
        var s = tg.safeAreaInset || {};
        var c = tg.contentSafeAreaInset || {};
        var full = Boolean(tg.isFullscreen);
        root.style.setProperty("--tg-sa-top", px(s.top));
        root.style.setProperty("--tg-sa-bottom", px(s.bottom));
        root.style.setProperty("--tg-sa-left", px(s.left));
        root.style.setProperty("--tg-sa-right", px(s.right));
        root.style.setProperty("--tg-bar", full ? px(c.top) : "0px");
        root.classList.toggle("tg-fullscreen", full);
      }

      function mountTopbar() {
        if (document.getElementById("tgTopbar")) return;
        var bar = document.createElement("div");
        bar.className = "tg-topbar";
        bar.id = "tgTopbar";
        bar.setAttribute("aria-hidden", "true");
        bar.innerHTML = '<div class="tg-brand"><span><i class="bi bi-controller"></i>MLBBBOT</span></div>';
        document.body.appendChild(bar);
      }

      if (document.body) mountTopbar();
      else document.addEventListener("DOMContentLoaded", mountTopbar);

      // Telegram ichida ekanini platform bo'yicha aniqlaymiz, initData bo'yicha EMAS:
      // reply keyboard tugmasidan (admin panel shunday ochiladi) ochilganda
      // initData bo'sh keladi. Oddiy brauzerda platform === "unknown".
      if (!tg || !tg.platform || tg.platform === "unknown") {
        settle();
        return;
      }

      try {
        tg.ready();
        tg.expand();
        // Ro'yxatni pastga surganda mini app yopilib/kichrayib ketmasin.
        if (typeof tg.disableVerticalSwipes === "function") tg.disableVerticalSwipes();
        if (typeof tg.setHeaderColor === "function") tg.setHeaderColor("${color}");
        if (typeof tg.setBackgroundColor === "function") tg.setBackgroundColor("${color}");
        if (typeof tg.setBottomBarColor === "function") tg.setBottomBarColor("${color}");
      } catch (e) { /* eski Telegram mijozlari */ }

      applyInsets();
      ["safeAreaChanged", "contentSafeAreaChanged"].forEach(function (name) {
        tg.onEvent(name, applyInsets);
      });
      tg.onEvent("fullscreenChanged", function () { applyInsets(); settle(); });
      tg.onEvent("fullscreenFailed", function () { applyInsets(); settle(); });
      // Ba'zi mijozlarda birinchi expand o'tib ketadi — viewport o'zgarsa qayta so'raymiz.
      tg.onEvent("viewportChanged", function () {
        if (!tg.isExpanded && !tg.isFullscreen) tg.expand();
      });

      var mobile = tg.platform === "ios" || tg.platform === "android";
      var canFullscreen = mobile && typeof tg.requestFullscreen === "function" &&
        typeof tg.isVersionAtLeast === "function" && tg.isVersionAtLeast("8.0");

      if (canFullscreen && !tg.isFullscreen) {
        try { tg.requestFullscreen(); } catch (e) { settle(); }
        setTimeout(function () { applyInsets(); settle(); }, ${FULLSCREEN_WAIT_MS});
      } else {
        settle();
      }
    })();`;
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

// HTML ichidagi `<!-- tg-shell -->` belgisini style + script bilan almashtiradi.
// color — Telegram header/fon rangi (sahifa foni bilan bir xil bo'lishi kerak).
function injectTelegramShell(html, { color = "#0a0e1a" } = {}) {
  const safeColor = HEX_COLOR_RE.test(color) ? color : "#0a0e1a";
  const source = String(html || "");

  if (!source.includes(SHELL_MARKER)) {
    return source;
  }

  return source.replace(
    SHELL_MARKER,
    `<style id="tg-shell-style">${buildShellCss()}\n  </style>\n  <script id="tg-shell-script">${buildShellScript(safeColor)}\n  </script>`
  );
}

module.exports = {
  SHELL_MARKER,
  injectTelegramShell,
};
