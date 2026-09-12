/* Renders data.json into the comparison table. No frameworks, no build step. */
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

  function render(corridor, amountKey) {
    var comp = corridor.amounts[amountKey];
    var src = sym(corridor.source_currency), dst = sym(corridor.target_currency);
    var rows = document.getElementById("rows");
    var quotes = comp.quotes || [];

    document.getElementById("midmarket").innerHTML = comp.mid_market
      ? "Mid-market rate: <b>" + fmt(comp.mid_market.rate, 4) + "</b> (no-margin benchmark)"
      : "";

    var best = document.getElementById("best-card");
    if (quotes.length) {
      var q0 = quotes[0];
      best.hidden = false;
      best.innerHTML =
        '<span class="label">Best value right now</span>' +
        '<span class="name">' + esc(q0.display_name) + "</span>" +
        '<span class="stat"><b>' + dst + fmt(q0.receive_amount, 0) + "</b> received</span>" +
        '<span class="stat"><b>' + fmt(q0.effective_rate, 4) + "</b> " + dst.trim() + " per " + src.trim() + " paid</span>" +
        (q0.total_cost_pct != null
          ? '<span class="stat">true cost <b>' + fmt(q0.total_cost_pct, 2) + "%</b> below mid-market</span>"
          : "");
    } else {
      best.hidden = true;
    }

    var html = quotes.map(function (q, i) {
      return "<tr" + (i === 0 ? ' class="top"' : "") + ">" +
        '<td class="rank">' + (i + 1) + "</td>" +
        '<td class="provider">' + esc(q.display_name) + "</td>" +
        '<td><span class="method-chip">' + methodLabel(q.funding_method) + "</span></td>" +
        '<td><span class="method-chip">' + methodLabel(q.delivery_method) + "</span></td>" +
        '<td class="num">' + fmt(q.rate, 4) + "</td>" +
        '<td class="num">' + src + fmt(q.fee, 2) + "</td>" +
        '<td class="num">' + src + fmt(q.total_paid, 2) + "</td>" +
        '<td class="num">' + dst + fmt(q.receive_amount, 0) + "</td>" +
        '<td class="num eff">' + fmt(q.effective_rate, 4) + "</td>" +
        '<td class="num cost"><span class="' + costCls(q.total_cost_pct) + '">' +
          (q.total_cost_pct != null ? fmt(q.total_cost_pct, 2) + "%" : "—") + "</span></td>" +
        '<td><span class="method-chip">' + (q.delivery_estimate ? esc(q.delivery_estimate) : "—") + "</span></td>" +
        "<td>" + nreCell(q.supports_nre) + "</td>" +
        "<td>" + sourceBadge(q.data_source) + "</td>" +
        "</tr>";
    }).join("");
    rows.innerHTML = html || '<tr><td colspan="13">No fresh quotes right now — check back within the hour.</td></tr>';

    var noteEl = document.getElementById("note");
    if (comp.note) { noteEl.textContent = comp.note; noteEl.hidden = false; }
    else { noteEl.hidden = true; }
  }

  fetch("data.json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var corridorKey = Object.keys(data.corridors)[0];
      var corridor = data.corridors[corridorKey];
      var amountKeys = Object.keys(corridor.amounts);

      var bar = document.getElementById("amounts");
      amountKeys.forEach(function (key, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", i === 1 || amountKeys.length === 1 ? "true" : "false");
        b.textContent = sym(corridor.source_currency) + fmt(key, 0);
        b.addEventListener("click", function () {
          bar.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-selected", "false"); });
          b.setAttribute("aria-selected", "true");
          render(corridor, key);
        });
        bar.appendChild(b);
      });

      var initial = amountKeys.length > 1 ? amountKeys[1] : amountKeys[0];
      render(corridor, initial);

      var when = new Date(data.generated_at);
      document.getElementById("updated").textContent =
        "Rates last collected " + when.toLocaleString() + " (your local time). Refreshed hourly.";
    })
    .catch(function (err) {
      document.getElementById("rows").innerHTML =
        '<tr><td colspan="13">Could not load rate data (' + esc(err.message) + "). Try refreshing.</td></tr>";
    });
})();
