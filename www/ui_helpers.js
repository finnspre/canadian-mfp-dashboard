// Small generic Shiny custom-message handlers shared across tabs -- kept
// separate from industry_tree.js, which is scoped to just the tree
// dropdown's own Shiny.InputBinding.
(function () {
  "use strict";

  // Toggles the native `disabled` attribute on any element by id (e.g. the
  // Compare/Data "Add series" button, disabled until an Industry is picked
  // -- see tab_module_server()'s observe() on input$pair_industry). A
  // disabled <button> simply stops dispatching click events in the
  // browser, so this alone is enough to block "Add series" -- no
  // server-side guard needed beyond what req() already does.
  Shiny.addCustomMessageHandler("toggleDisabled", function (msg) {
    var el = document.getElementById(msg.id);
    if (!el) return;
    el.disabled = !!msg.disabled;
  });

  // Client-side PNG export for the Trends/Rankings/Compare tabs' Plotly
  // charts, wired to the "Download chart as PNG" item in each tab's
  // Download dropdown (see download_menu_ui() in app.R). Every
  // plotlyOutput() renders straight into a <div id="<ns>-chart"> that
  // plotly.js turns into the actual graph div, so there's nothing to
  // render server-side here -- this just hands that already-rendered div
  // back to Plotly's own PNG exporter. Exposed on window (rather than
  // kept inside this IIFE's closure) since it's invoked from a plain
  // inline onclick attribute, which only ever runs in global scope.
  window.downloadChartPng = function (targetId) {
    var gd = document.getElementById(targetId);
    // Guards a chart that hasn't rendered yet (e.g. no data for the
    // current selection) -- silently does nothing rather than throwing,
    // same "nothing to export" outcome a disabled button would give.
    if (!gd || typeof Plotly === "undefined" || !gd.data) return;

    var titleText = (gd.layout && gd.layout.title && gd.layout.title.text) || "chart";
    // Chart titles can carry embedded HTML (the Trends tab's
    // "<br><sup>...</sup>" subtitle) -- strip tags down to plain text
    // before turning it into a filename.
    var plain = titleText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    var slug = plain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    // Local calendar date, not UTC -- toISOString() reports the UTC date,
    // which can land a day off from the CSV downloads' filenames (built
    // server-side from Sys.Date(), the local date) for anyone west of UTC
    // in the evening.
    var now = new Date();
    var pad2 = function (n) { return n < 10 ? "0" + n : "" + n; };
    var today = now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate());

    Plotly.downloadImage(gd, {
      format: "png",
      filename: "productivity_" + (slug || "chart") + "_" + today
    });
  };

  // Hides the #app-splash "Starting the application" / "Loading data"
  // overlay (see ui()/page_fillable() in app.R) once the app has actually
  // finished its first real work -- shiny:idle (not shiny:sessioninitialized,
  // which fires as soon as the server's init message arrives, before the
  // default view has actually rendered) is the first point the initial
  // chart is genuinely done computing. .one(), not .on() -- only the very
  // first idle matters; every later busy/idle cycle is a normal chart
  // update, handled by useBusyIndicators() instead (see app.R), not this
  // splash. The 8s timeout is a failsafe only, in case that first
  // busy/idle cycle is ever skipped entirely.
  $(document).one("shiny:idle", hideSplash);
  setTimeout(hideSplash, 8000);
  function hideSplash() {
    var el = document.getElementById("app-splash");
    if (!el) return;
    el.classList.add("app-splash-hidden");
    setTimeout(function () { el.remove(); }, 400);
  }

  // Growth Accounting tab: a brief "someone just scrolled it" nudge (scroll
  // right a little, then smoothly back) the moment this tab is clicked into
  // -- once its chart is wide enough to need horizontal scrolling (see
  // GROWTH_CHART_YEAR_THRESHOLD/output$chart_container in app.R), a plain
  // auto-hiding scrollbar (most platforms' default) gives no visible cue at
  // all that there's more to see off to the right, so without this a reader
  // could easily miss everything past the first screenful. Bound to
  // "shown.bs.tab" -- Bootstrap's own event on a nav-pill's <a>, fired by
  // bslib's navset_pill every time a tab is activated -- rather than to
  // just this one pill specifically: growth-chart_scroll only exists AND is
  // actually visible (offsetParent isn't null) once the Growth Accounting
  // pane is the one that just got shown, so this is a harmless no-op for
  // every other tab's own "shown.bs.tab". Re-fires on every visit to this
  // tab, not just the very first one -- a returning reader benefits from
  // the same reminder just as much as a first-time one.
  //
  // Manual requestAnimationFrame tween, not el.scrollTo({behavior:"smooth"})
  // -- confirmed empirically (a real headless-Chrome run, sampling
  // scrollLeft on a timer) that firing a 2nd native smooth-scroll call
  // (the "back to start" one) while the 1st (the "nudge out") hadn't
  // finished its own native animation yet made the two blend unpredictably
  // -- the chart was left resting ~26px off its true start instead of back
  // at exactly 0, i.e. this tab no longer actually opened with the axis
  // fully in view, the opposite of the point of starting at the left at
  // all (see output$chart's own comment). Driving both legs of the nudge
  // through one control loop guarantees the 2nd leg only ever starts once
  // the 1st has actually finished, so it always lands back on exactly the
  // value it started from.
  function animateScrollLeft(el, from, to, duration, done) {
    var t0 = null;
    function step(now) {
      if (t0 === null) t0 = now;
      var p = Math.min((now - t0) / duration, 1);
      var eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease-in-out
      el.scrollLeft = from + (to - from) * eased;
      if (p < 1) {
        requestAnimationFrame(step);
      } else if (done) {
        done();
      }
    }
    requestAnimationFrame(step);
  }

  // Polls for the element (short intervals, capped) rather than checking
  // once after a fixed delay -- confirmed empirically (the same headless-
  // Chrome run) that Shiny doesn't have output$chart_container's actual
  // markup (including this div's id) in the DOM yet right when
  // "shown.bs.tab" fires: this tab's outputs sit suspended while hidden
  // (Shiny's own default for a tab it can detect via jQuery's :visible,
  // which a Bootstrap nav-pane qualifies for) and only start recomputing
  // once shown, so the div can take a render cycle or two to actually
  // arrive. A single fixed-delay check landed before that happened and
  // silently found nothing every time; polling finds it whenever it
  // actually shows up instead of gambling on one fixed wait.
  //
  // growthNudgeGen guards against a subtler bug this polling itself
  // creates: "shown.bs.tab" fires for *every* tab, not just this one (see
  // above), so switching to e.g. Compare also starts its own up-to-3s
  // tryNudge polling loop -- which, confirmed empirically (a scripted
  // Compare -> Growth Accounting -> Compare -> ... loop), can still be
  // mid-poll (growth-chart_scroll hidden while Compare was showing, so it
  // just kept retrying) at the moment the reader clicks back to Growth
  // Accounting a moment later. Without this guard, that stale loop then
  // finds the div newly visible too and runs a *2nd*, independent nudge
  // concurrent with the fresh one Growth Accounting's own "shown.bs.tab"
  // just started -- 2 overlapping tweens each capturing their own
  // (slightly different) "start" and racing to set scrollLeft leaves it a
  // few px off on that visit, and since the div is the same persistent DOM
  // node across visits (Shiny doesn't recreate it just because its tab was
  // hidden), that error compounds further on every later visit instead of
  // washing out. Each call bumps this counter and captures its own value;
  // every step below re-checks it against the (module-)shared counter and
  // bails the instant a *newer* "shown.bs.tab" has fired, so only the most
  // recent tab-shown event's sequence is ever allowed to actually animate.
  var growthNudgeGen = 0;
  $(document).on("shown.bs.tab", function () {
    var myGen = ++growthNudgeGen;
    var attempts = 0;
    (function tryNudge() {
      if (myGen !== growthNudgeGen) return; // superseded by a later tab switch
      attempts++;
      var el = document.getElementById("growth-chart_scroll");
      if (el && el.offsetParent && el.scrollWidth > el.clientWidth) {
        var start = el.scrollLeft;
        animateScrollLeft(el, start, start + 60, 260, function () {
          if (myGen !== growthNudgeGen) return;
          setTimeout(function () {
            if (myGen !== growthNudgeGen) return;
            animateScrollLeft(el, el.scrollLeft, start, 260, function () {
              if (myGen !== growthNudgeGen) return;
              // Belt-and-suspenders past the tween itself: overflow-anchor:
              // none (see output$chart_container in app.R) stopped most,
              // but not quite all, of a separate small drift also seen
              // empirically -- something (most likely Plotly's own
              // resize/redraw once the chart is visible again) still
              // nudges scrollLeft a few px on its own on some visits, right
              // around when this tween's last frame lands. 2 rAF ticks
              // gives that a moment to happen, then this forces scrollLeft
              // back to exactly `start` (idempotent/harmless if nothing
              // had nudged it at all).
              requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                  if (myGen === growthNudgeGen) el.scrollLeft = start;
                });
              });
            });
          }, 200);
        });
        return;
      }
      // Keeps trying for ~3s (30 * 100ms) -- long enough to cover a slow
      // render, short enough to give up quietly and cheaply on every other
      // tab's own "shown.bs.tab" (where this div will never exist, or
      // never become visible, at all) or a genuinely non-scrollable Growth
      // Accounting chart.
      if (attempts < 30) setTimeout(tryNudge, 100);
    })();
  });

  // Turns the #shiny-disconnected-overlay Shiny itself injects/removes on
  // disconnect (styled in csls-shiny-theme.css) into a working "Connection
  // lost -- click to reload" retry action -- a plain document-level
  // delegated listener, not one bound to the overlay element directly,
  // since that element doesn't exist yet at page load and Shiny gives no
  // JS hook to attach to the moment it's created. A no-op the rest of the
  // time (nothing on the page ever carries this id while connected).
  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "shiny-disconnected-overlay") {
      window.location.reload();
    }
  });
})();
