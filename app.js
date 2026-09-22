/* Renders data.json into the landing page. No frameworks, no build step. */
(function () {
  "use strict";

  var SYMBOL = { USD: "$", INR: "₹", GBP: "£", EUR: "€", CAD: "C$", AUD: "A$", SGD: "S$", AED: "AED " };
  var METHOD_LABEL = {
    bank_ach: "Bank (ACH)", bank_wire: "Bank (wire)", bank_transfer: "Bank account",
    debit_card: "Debit card", credit_card: "Credit card", apple_pay: "Apple Pay",
    google_pay: "Google Pay", paypal_balance: "PayPal balance", crypto_pyusd: "PYUSD balance",
    bank_deposit: "Bank deposit", upi: "UPI", cash_pickup: "Cash pickup",
    mobile_wallet: "Mobile wallet", unknown: "—"
  };
  var SOURCE = {
    official_api: { cls: "src-official", label: "official API", title: "From the provider's own public quote API" },
    scrape: { cls: "src-scrape", label: "provider website", title: "Read from the provider's live calculator; standard non-promotional rates" }
  };

  function sym(code) { return SYMBOL[code] || code + " "; }
  function fmt(n, dp) {
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function methodLabel(m) { return METHOD_LABEL[m] || (m ? m.replace(/_/g, " ") : "—"); }
  function sourceBadge(src) {
    var s = SOURCE[src] || { cls: "src-indicative", label: "indicative", title: "Third-party comparison data; approximate" };
    return '<span class="badge ' + s.cls + '" title="' + s.title + '">' + s.label + "</span>";
  }
  function nreCell(v) {
    if (v === true) return '<span class="nre-yes" title="Can deposit to NRE accounts">✓</span>';
    if (v === false) return '<span class="nre-no" title="Cannot deposit to NRE accounts">✗</span>';
    return '<span class="nre-unk" title="NRE support unverified">?</span>';
  }
  function costCls(pct) {
    if (pct == null) return "";
    if (pct <= 1) return "cost-low";
    if (pct <= 3) return "cost-mid";
    return "cost-high";
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // The cells shared by a provider's main row and its folded payment options.
  function tailCells(q, src, dst) {
    return '<td class="num">' + fmt(q.rate, 4) + "</td>" +
      '<td class="num">' + src + fmt(q.fee, 2) + "</td>" +
      '<td class="num">' + src + fmt(q.total_paid, 2) + "</td>" +
      '<td class="num">' + dst + fmt(q.receive_amount, 0) + "</td>" +
      '<td class="num eff">' + fmt(q.effective_rate, 4) + "</td>" +
      '<td class="num cost"><span class="' + costCls(q.total_cost_pct) + '">' +
        (q.total_cost_pct != null ? fmt(q.total_cost_pct, 2) + "%" : "—") + "</span></td>" +
      '<td><span class="method-chip">' + (q.delivery_estimate ? esc(q.delivery_estimate) : "—") + "</span></td>" +
      "<td>" + nreCell(q.supports_nre) + "</td>" +
      "<td>" + sourceBadge(q.data_source) + "</td>";
  }

  function renderStats(corridor, generatedAt) {
    var providers = {}, quotes = 0;
    Object.keys(corridor.amounts).forEach(function (k) {
      (corridor.amounts[k].quotes || []).forEach(function (q) {
        providers[q.display_name] = true; quotes++;
      });
    });
    var when = new Date(generatedAt);
    var ageMin = Math.max(0, Math.round((Date.now() - when.getTime()) / 60000));
    document.getElementById("stats").innerHTML =
      '<span class="stat"><b>' + Object.keys(providers).length + "</b> providers compared</span>" +
      '<span class="stat"><b>' + quotes + "</b> live quotes on this page</span>" +
      '<span class="stat"><b>' + (ageMin < 60 ? ageMin + " min" : Math.round(ageMin / 60) + " h") + "</b> since last collection</span>" +
      '<span class="stat"><b>$0</b> earned from providers</span>';
  }

  function renderChart(corridor, amountKey) {
    var comp = corridor.amounts[amountKey];
    var src = sym(corridor.source_currency);
    // best (cheapest) option per provider
    var best = {};
    (comp.quotes || []).forEach(function (q) {
      if (q.total_cost_pct == null) return;
      if (!(q.display_name in best) || q.total_cost_pct < best[q.display_name]) {
        best[q.display_name] = q.total_cost_pct;
      }
    });
    var entries = Object.keys(best).map(function (name) { return { name: name, cost: best[name] }; });
    entries.sort(function (a, b) { return a.cost - b.cost; });
    var max = entries.length ? Math.max.apply(null, entries.map(function (e) { return e.cost; })) : 1;

    document.getElementById("chart-title").textContent =
      "True cost of a " + src + fmt(amountKey, 0) + " transfer — best option per provider";
    document.getElementById("cost-chart").innerHTML = entries.map(function (e) {
      var w = Math.max(2, (e.cost / max) * 100);
      return '<div class="bar-row" title="' + esc(e.name) + ": " + fmt(e.cost, 2) + '% below mid-market">' +
        '<span class="bar-label">' + esc(e.name) + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="width:' + w + '%"></span></span>' +
        '<span class="bar-value">' + fmt(e.cost, 2) + "%</span>" +
        "</div>";
    }).join("");
  }

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(iso) {
    var p = iso.split("-");
    return MONTHS[+p[1] - 1] + " " + (+p[2]);
  }

  // Minimal single-series line chart of the best daily rate. Inline SVG, no
  // library; recessive axes, direct-labelled latest point.
  function lineChartSVG(hist) {
    var W = 720, H = 200, padL = 46, padR = 58, padT = 14, padB = 26;
    var rates = hist.map(function (h) { return h.best_rate; });
    var lo = Math.min.apply(null, rates), hi = Math.max.apply(null, rates);
    var pad = (hi - lo) * 0.18 || 0.1;
    var ymin = lo - pad, ymax = hi + pad;
    var n = hist.length;
    var bottom = H - padB;
    function x(i) { return padL + (n === 1 ? 0 : i * (W - padL - padR) / (n - 1)); }
    function y(v) { return padT + (ymax - v) / (ymax - ymin) * (H - padT - padB); }

    var pts = hist.map(function (h, i) { return x(i).toFixed(1) + "," + y(h.best_rate).toFixed(1); });
    var area = "M" + x(0).toFixed(1) + "," + bottom + " L" + pts.join(" L") +
               " L" + x(n - 1).toFixed(1) + "," + bottom + " Z";
    var last = hist[n - 1], lx = x(n - 1), ly = y(last.best_rate);

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" ' +
      'aria-label="Best rate trend over ' + n + ' days">' +
      // y reference labels
      '<text x="' + (padL - 6) + '" y="' + (padT + 4) + '" class="ax" text-anchor="end">' + fmt(ymax, 2) + '</text>' +
      '<text x="' + (padL - 6) + '" y="' + bottom + '" class="ax" text-anchor="end">' + fmt(ymin, 2) + '</text>' +
      '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + bottom + '" class="axline"/>' +
      '<line x1="' + padL + '" y1="' + bottom + '" x2="' + (W - padR) + '" y2="' + bottom + '" class="axline"/>' +
      // x endpoints
      '<text x="' + padL + '" y="' + (H - 6) + '" class="ax">' + fmtDate(hist[0].date) + '</text>' +
      '<text x="' + (W - padR) + '" y="' + (H - 6) + '" class="ax" text-anchor="end">' + fmtDate(last.date) + '</text>' +
      // series
      '<path d="' + area + '" class="area"/>' +
      '<polyline points="' + pts.join(" ") + '" class="line"/>' +
      '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="4" class="dot"/>' +
      '<text x="' + (lx + 8) + '" y="' + (ly + 4) + '" class="val">' + fmt(last.best_rate, 2) + '</text>' +
      '</svg>';
  }

  function renderTrend(comp) {
    var sig = comp.signal, hist = comp.history || [];
    var badge = document.getElementById("signal");
    if (sig && sig.label) {
      badge.hidden = false;
      badge.className = "signal signal-" + (sig.tone || "neutral");
      badge.innerHTML = '<span class="signal-dot"></span><span>' + esc(sig.label) + "</span>";
    } else {
      badge.hidden = true;
    }
    var sec = document.getElementById("trend");
    if (hist.length < 2) { sec.hidden = true; return; }
    sec.hidden = false;
    document.getElementById("trend-note").textContent =
      "Best effective rate (₹ per $) over the last " + hist.length +
      " days of data. Higher is better.";
    document.getElementById("trend-chart").innerHTML = lineChartSVG(hist);
  }

  function render(corridor, amountKey) {
    var comp = corridor.amounts[amountKey];
    var src = sym(corridor.source_currency), dst = sym(corridor.target_currency);
    var rows = document.getElementById("rows");
    var quotes = comp.quotes || [];

    document.getElementById("midmarket").innerHTML = comp.mid_market
      ? "Mid-market rate: <b>" + fmt(comp.mid_market.rate, 4) + "</b> (no-margin benchmark)"
      : "";

    // One row per provider (its cheapest option); the other ways to pay fold
    // into an expander. Funding method genuinely changes the cost — Wise by
    // bank is ~1.1%, by credit card ~6.6% — so we keep every option, we just
    // don't clutter the default view with them.
    var groups = [], byProvider = {};
    quotes.forEach(function (q) {
      if (!(q.provider in byProvider)) {
        byProvider[q.provider] = { primary: q, extras: [] };
        groups.push(byProvider[q.provider]);
      } else {
        byProvider[q.provider].extras.push(q);
      }
    });

    var best = document.getElementById("best-card");
    if (groups.length) {
      var q0 = groups[0].primary;
      var worst = groups[groups.length - 1].primary;
      var saved = q0.receive_amount - worst.receive_amount;
      best.hidden = false;
      best.innerHTML =
        '<span class="label">Best value right now</span>' +
        '<span class="name">' + esc(q0.display_name) + "</span>" +
        '<span class="stat-item"><b>' + dst + fmt(q0.receive_amount, 0) + "</b> received</span>" +
        '<span class="stat-item"><b>' + fmt(q0.effective_rate, 4) + "</b> " + dst.trim() + " per " + src.trim() + " paid</span>" +
        (saved > 1
          ? '<span class="stat-item savings">' + dst + fmt(saved, 0) + " more than " + esc(worst.display_name) + "’s best rate</span>"
          : "");
    } else {
      best.hidden = true;
    }

    var html = groups.map(function (g, i) {
      var q = g.primary, n = g.extras.length;
      var head = '<tr class="primary' + (i === 0 ? " top" : "") + '">' +
        '<td class="rank">' + (i + 1) + "</td>" +
        '<td class="provider">' + esc(q.display_name) +
          (n > 0 ? ' <button type="button" class="expander" data-prov="' + esc(q.provider) +
                   '">+' + n + " more ways to pay</button>" : "") + "</td>" +
        '<td><span class="method-chip">' + methodLabel(q.funding_method) + "</span></td>" +
        '<td><span class="method-chip">' + methodLabel(q.delivery_method) + "</span></td>" +
        tailCells(q, src, dst) + "</tr>";
      var extra = g.extras.map(function (e) {
        return '<tr class="extra" data-prov-row="' + esc(e.provider) + '">' +
          '<td class="rank"></td>' +
          '<td class="provider sub">↳ ' + esc(e.display_name) + "</td>" +
          '<td><span class="method-chip">' + methodLabel(e.funding_method) + "</span></td>" +
          '<td><span class="method-chip">' + methodLabel(e.delivery_method) + "</span></td>" +
          tailCells(e, src, dst) + "</tr>";
      }).join("");
      return head + extra;
    }).join("");
    rows.innerHTML = html || '<tr><td colspan="13">No fresh quotes right now — check back within the hour.</td></tr>';

    rows.querySelectorAll(".expander").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var open = btn.classList.toggle("open");
        var extras = rows.querySelectorAll('tr[data-prov-row="' + btn.dataset.prov + '"]');
        extras.forEach(function (r) { r.classList.toggle("open", open); });
        btn.textContent = open ? "show less" : "+" + extras.length + " more ways to pay";
      });
    });

    var noteEl = document.getElementById("note");
    if (comp.note) { noteEl.textContent = comp.note; noteEl.hidden = false; }
    else { noteEl.hidden = true; }

    renderChart(corridor, amountKey);
    renderTrend(comp);
  }

  fetch("data.json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var corridorKey = Object.keys(data.corridors)[0];
      var corridor = data.corridors[corridorKey];
      var amountKeys = Object.keys(corridor.amounts);
      var current = amountKeys.indexOf("1000") >= 0 ? "1000" : amountKeys[0];

      function select(key) {
        current = key;
        bar.querySelectorAll("button").forEach(function (x) {
          x.setAttribute("aria-selected", x.dataset.key === key ? "true" : "false");
        });
        render(corridor, key);
      }

      var bar = document.getElementById("amounts");
      amountKeys.forEach(function (key) {
        var b = document.createElement("button");
        b.type = "button";
        b.dataset.key = key;
        b.setAttribute("role", "tab");
        b.textContent = sym(corridor.source_currency) + fmt(key, 0);
        b.addEventListener("click", function () { select(key); });
        bar.appendChild(b);
      });

      // Hero widget: any typed amount maps to the nearest collected preset.
      document.getElementById("widget").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var typed = parseFloat(document.getElementById("amount-input").value);
        if (!isFinite(typed) || typed <= 0) typed = 1000;
        var nearest = amountKeys.reduce(function (a, b) {
          return Math.abs(b - typed) < Math.abs(a - typed) ? b : a;
        });
        select(nearest);
        var noteEl = document.getElementById("note");
        if (Number(nearest) !== typed) {
          noteEl.textContent = "Showing quotes for " + sym(corridor.source_currency) + fmt(nearest, 0) +
            " — the closest amount we collect to your " + sym(corridor.source_currency) + fmt(typed, 0) + ".";
          noteEl.hidden = false;
        }
        document.getElementById("results").scrollIntoView({ behavior: "smooth" });
      });

      renderStats(corridor, data.generated_at);
      select(current);

      var when = new Date(data.generated_at);
      document.getElementById("updated").textContent =
        "Rates last collected " + when.toLocaleString() + " (your local time). Refreshed hourly.";
      document.getElementById("chart-caption").textContent =
        "Chart uses this hour's live quotes (collected " + when.toLocaleString() +
        "), taking each provider's cheapest option. Lower is better.";
    })
    .catch(function (err) {
      document.getElementById("rows").innerHTML =
        '<tr><td colspan="13">Could not load rate data (' + esc(err.message) + "). Try refreshing.</td></tr>";
    });
})();
