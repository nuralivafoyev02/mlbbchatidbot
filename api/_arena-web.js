// ---------------------------------------------------------------------------
// Rone Arena API — brauzer (Telegram Mini App) klienti.
//
// arena.rone.dev Cloudflare bot himoyasi ortida: server IP'laridan (Vercel,
// hatto Cloudflare Worker orqali ham) kelgan so'rovlarga "Just a moment..."
// (HTTP 403) qaytaradi, foydalanuvchi telefonidan esa ishlaydi va CORS
// ruxsat etilgan. Shuning uchun Arena'ga so'rovlar Mini App ichidan yuboriladi:
//   * kabinet: kod yuborish → kirish → nickname, so'ng JWT `ml_link` bilan
//     serverga (shifrlab saqlanadi);
//   * "Mening akkauntim": server JWT'ni faqat egasiga beradi (`ml_session`),
//     ma'lumotlar shu yerdan olinadi. Javob shakllari va xato kodlari avvalgi
//     server amallari (overview, matches, ...) bilan bir xil.
//
// createArenaWeb o'zi yetarli (tashqi o'zgaruvchisiz) funksiya: serverda
// `toString()` bilan sahifaga joylanadi (ARENA_WEB_SCRIPT) va Node testlarida
// to'g'ridan-to'g'ri chaqiriladi.
// ---------------------------------------------------------------------------

const { DEFAULT_ARENA_API_URL, RANK_TABLE, MYTHIC_START } = require("./_mlbb-arena.js");

function createArenaWeb(options) {
  var baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
  var fetchFn = options.fetch;
  var timeoutMs = options.timeoutMs || 15000;
  var rankTable = options.rankTable || [];
  var mythicStart = options.mythicStart;
  var LANGS = ["en", "id", "ru", "es", "pt", "tr", "ar", "de", "fr", "it", "ja", "ko", "th", "vi", "zh-CN", "zh-TW", "km"];

  function arenaLang(lang) { return LANGS.indexOf(lang) >= 0 ? lang : "en"; }

  function fail(reason, extra) {
    var error = new Error(reason);
    error.reason = reason;
    if (extra) for (var key in extra) error[key] = extra[key];
    return error;
  }

  // _mlbb-arena.js classifyArenaFailure bilan bir xil qoidalar + Cloudflare
  // challenge (JSON bo'lmagan 403) — "service_down".
  function classify(status, payload) {
    var code = payload ? payload.code : null;
    var strCode = typeof code === "string" ? code.toUpperCase() : "";
    var numCode = typeof code === "number" ? code : null;
    var message = String((payload && (payload.message || payload.msg)) || "");
    if (!payload) return "service_down";
    if (status === 401 || status === 403 || strCode === "UNAUTHORIZED" || numCode === 1002 || /auth is empty|unauthori[sz]ed|token (?:is )?(?:invalid|expired)/i.test(message)) return "unauthorized";
    if (numCode === 10407 || /接口下线/.test(message)) return "unavailable";
    if (status === 429 || /RATE_LIMIT/.test(strCode)) return "rate_limit";
    if (status === 422 || strCode === "VALIDATION_ERROR") return "invalid_input";
    if (status >= 500) return "upstream";
    if (numCode !== null && numCode !== 0) return "rejected";
    return "upstream";
  }

  function request(method, path, opts) {
    opts = opts || {};
    var query = [];
    var q = opts.query || {};
    for (var key in q) {
      if (q[key] !== undefined && q[key] !== null && q[key] !== "") query.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(q[key])));
    }
    var headers = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = "Bearer " + opts.token;

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
    return fetchFn(baseUrl + path + (query.length ? "?" + query.join("&") : ""), {
      method: method,
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      return response.text().then(function (text) {
        var payload = null;
        try { payload = JSON.parse(text); } catch (e) { payload = null; }
        if (response.ok && payload && payload.code === 0) return payload.data;
        throw fail(classify(response.status, payload), { status: response.status, detailType: payload && payload.details ? payload.details.type : "" });
      });
    }, function (error) {
      throw fail(error && error.name === "AbortError" ? "timeout" : "network");
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  function sid(value) {
    var n = Number(value);
    if (!(n >= 0 && n <= 100000 && Math.floor(n) === n)) throw fail("invalid_input");
    return n;
  }
  function cursor(value) {
    var text = String(value == null ? "" : value).trim();
    return /^\d{1,25}$/.test(text) ? text : undefined;
  }
  function limit(value, max) {
    var n = Math.floor(Number(value));
    return !(n >= 1) ? 1 : Math.min(n, max);
  }

  function formatRank(value) {
    var level = Math.floor(Number(value));
    if (!(level > 0)) return null;
    if (level >= mythicStart) {
      var mStars = level - mythicStart;
      var tier = mStars >= 100 ? "Mythical Immortal" : mStars >= 50 ? "Mythical Glory" : mStars >= 25 ? "Mythical Honor" : "Mythic";
      return { tier: tier, division: "", stars: mStars, label: tier + " ★" + mStars };
    }
    for (var i = 0; i < rankTable.length; i++) {
      for (var j = 0; j < rankTable[i].divisions.length; j++) {
        var d = rankTable[i].divisions[j];
        if (level >= d[1] && level <= d[2]) {
          var stars = level - d[1];
          return { tier: rankTable[i].name, division: d[0], stars: stars, label: rankTable[i].name + " " + d[0] + " ★" + stars };
        }
      }
    }
    return null;
  }

  // Server amallaridagi kabi: xato → { ok:false, error }.
  function errorCode(error) {
    var reason = error && error.reason;
    if (reason === "unauthorized") return "session_expired";
    return ["invalid_input", "rate_limit", "timeout", "unavailable", "network"].indexOf(reason) >= 0 ? reason : "service_down";
  }
  function settle(promise) {
    return promise.then(function (value) { return { ok: true, value: value }; }, function (error) { return { ok: false, error: error }; });
  }

  function overview(token, lang, account) {
    var l = arenaLang(lang);
    return Promise.all([
      settle(request("GET", "/user/info", { token: token, query: { lang: l } })),
      settle(request("GET", "/user/stats", { token: token, query: { lang: l } })),
      settle(request("GET", "/user/season", { token: token, query: { lang: l } })),
      settle(request("GET", "/user/privacy/settings", { token: token, query: { lang: l } }))
    ]).then(function (r) {
      var info = r[0], stats = r[1], seasons = r[2], privacy = r[3];
      var unauthorized = r.filter(function (x) { return !x.ok && x.error.reason === "unauthorized"; })[0];
      if (unauthorized && !info.ok) throw unauthorized.error;
      if (!info.ok && !stats.ok) throw info.error;
      var gone = function (x) { return !x.ok && x.error.reason === "unavailable"; };
      var infoData = info.ok ? info.value || {} : null;
      var sids = seasons.ok && seasons.value && Array.isArray(seasons.value.sids)
        ? seasons.value.sids.filter(function (s) { return Math.floor(s) === s; })
        : [];
      return {
        ok: true,
        account: account || null,
        info: infoData,
        rank: infoData ? formatRank(infoData.rank_level) : null,
        highestRank: infoData ? formatRank(infoData.history_rank_level) : null,
        stats: stats.ok ? stats.value || {} : null,
        seasons: sids.length ? sids : (stats.ok && stats.value && Array.isArray(stats.value.sids) ? stats.value.sids : []),
        privacy: privacy.ok ? privacy.value || null : null,
        unavailable: { stats: gone(stats), seasons: gone(seasons), privacy: gone(privacy) }
      };
    });
  }

  // "Mening akkauntim" amallari → avvalgi server javoblari bilan bir xil shakl.
  function call(action, token, payload, lang, account) {
    var p = payload || {};
    var l = arenaLang(lang);
    var run;
    try {
      if (action === "overview") run = overview(token, lang, account);
      else if (action === "matches") run = request("GET", "/user/matches", { token: token, query: { sid: sid(p.sid), limit: limit(p.limit || 10, 20), last_cursor: cursor(p.cursor), lang: l } });
      else if (action === "match_detail") {
        if (!/^\d{1,25}$/.test(String(p.matchId || ""))) throw fail("invalid_input");
        run = request("GET", "/user/matches/" + p.matchId, { token: token, query: { sid: sid(p.sid), lang: l } });
      } else if (action === "heroes") run = request("GET", "/user/heroes/frequent", { token: token, query: { sid: sid(p.sid), limit: limit(p.limit || 20, 30), last_cursor: cursor(p.cursor), lang: l } });
      else if (action === "hero_matches") {
        if (!/^\d{1,6}$/.test(String(p.heroId == null ? "" : p.heroId))) throw fail("invalid_input");
        run = request("GET", "/user/matches/hero/" + p.heroId, { token: token, query: { sid: sid(p.sid), limit: limit(p.limit || 10, 20), last_cursor: cursor(p.cursor), lang: l } });
      } else if (action === "friends") run = request("GET", "/user/friends", { token: token, query: { sid: sid(p.sid), lang: l } });
      else if (action === "privacy_set") run = request("POST", "/user/privacy/settings", { token: token, query: { visibility: p.visible === true || p.visible === "true" ? "visible" : "invisible", lang: l } });
      else if (action === "logout") run = request("POST", "/user/auth/logout", { token: token });
      else throw fail("invalid_input");
    } catch (error) {
      return Promise.resolve({ ok: false, error: errorCode(error) });
    }
    return run.then(function (data) {
      if (action === "overview") return data;
      return action === "privacy_set" ? { ok: true, data: data || null } : { ok: true, data: data || {} };
    }, function (error) {
      return { ok: false, error: errorCode(error) };
    });
  }

  // Kabinet: o'yin ichidagi pochtaga kod.
  function sendCode(roleId, zoneId) {
    if (!/^\d{5,12}$/.test(String(roleId)) || !/^\d{1,8}$/.test(String(zoneId))) return Promise.resolve({ ok: false, error: "invalid_input" });
    return request("POST", "/user/auth/send-vc", { body: { role_id: Number(roleId), zone_id: Number(zoneId) } }).then(function () {
      return { ok: true };
    }, function (error) {
      var reason = error.reason === "rejected" ? "send_failed" : error.reason;
      return { ok: false, error: ["send_failed", "rate_limit", "invalid_input", "timeout"].indexOf(reason) >= 0 ? reason : "service_down" };
    });
  }

  // Kabinet: kod → JWT → nickname. Noto'g'ri kodda Arena 500/ code≠0 qaytaradi.
  function login(roleId, zoneId, code, lang) {
    var vc = String(code || "").replace(/[\s-]/g, "");
    if (!/^\d{4,6}$/.test(vc)) return Promise.resolve({ ok: false, error: "invalid_format" });
    return request("POST", "/user/auth/login", { body: { role_id: Number(roleId), zone_id: Number(zoneId), vc: Number(vc) } }).then(function (data) {
      var jwt = data && typeof data.jwt === "string" ? data.jwt.trim() : "";
      if (!jwt) return { ok: false, error: "wrong_code" };
      return request("GET", "/user/info", { token: jwt, query: { lang: arenaLang(lang) } }).then(function (info) {
        return { ok: true, jwt: jwt, nickname: info && info.name ? String(info.name).slice(0, 64) : null };
      }, function () {
        return { ok: true, jwt: jwt, nickname: null };
      });
    }, function (error) {
      if (error.reason === "rejected" || error.reason === "invalid_input" || error.detailType === "ResponseValidationError") {
        return { ok: false, error: "wrong_code" };
      }
      return { ok: false, error: ["rate_limit", "timeout"].indexOf(error.reason) >= 0 ? error.reason : "service_down" };
    });
  }

  return { call: call, sendCode: sendCode, login: login, formatRank: formatRank };
}

// Sahifaga joylanadigan <script>: window.ArenaWeb.
const ARENA_WEB_SCRIPT = `<script>
${createArenaWeb.toString()}
window.ArenaWeb = createArenaWeb({
  baseUrl: ${JSON.stringify(DEFAULT_ARENA_API_URL)},
  fetch: function (url, init) { return window.fetch(url, init); },
  rankTable: ${JSON.stringify(RANK_TABLE)},
  mythicStart: ${JSON.stringify(MYTHIC_START)}
});
</script>`;

function injectArenaWeb(html) {
  return String(html).replace("<!-- arena-web -->", ARENA_WEB_SCRIPT);
}

module.exports = { ARENA_WEB_SCRIPT, createArenaWeb, injectArenaWeb };
