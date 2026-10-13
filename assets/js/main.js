/* Coeso — shared site behaviour */
(function () {
  "use strict";

  var nav = document.querySelector(".nav");
  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("navLinks");

  /* ---- Mobile menu ---- */
  if (nav && toggle && links) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    links.addEventListener("click", function (e) {
      var a = e.target.closest("a");
      if (!a) return;
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });

    document.addEventListener("click", function (e) {
      if (!nav.contains(e.target)) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---- Smooth scrolling with sticky-nav offset ---- */
  document.addEventListener("click", function (e) {
    var a = e.target.closest('a[href*="#"]');
    if (!a) return;

    var href = a.getAttribute("href");
    var hash = href.indexOf("#") > -1 ? href.slice(href.indexOf("#") + 1) : "";
    if (!hash) return;

    var target = document.getElementById(hash);
    if (!target) return;

    e.preventDefault();

    var navH = nav ? nav.getBoundingClientRect().height : 72;
    var top = Math.max(target.getBoundingClientRect().top + window.pageYOffset - navH - 8, 0);

    scrollToSection(top);

    if (history.replaceState) {
      history.replaceState(null, "", href);
    }
  });

  /* ---- Smooth scroll with a fallback for environments where
         animated scrolling never advances ---- */
  function scrollToSection(top) {
    var reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var start = window.pageYOffset;

    if (reduce) {
      window.scrollTo({ top: top, behavior: "instant" });
      return;
    }

    window.scrollTo({ top: top, behavior: "smooth" });

    var ticks = 0;
    var timer = setInterval(function () {
      ticks += 1;
      var y = window.pageYOffset;
      var done = Math.abs(y - top) < 4;
      var startedMoving = y !== start;

      if (done) {
        clearInterval(timer);
        return;
      }

      /* Animated scroll never started, or stalled after starting. */
      if ((!startedMoving && ticks >= 12) || ticks >= 50) {
        clearInterval(timer);
        window.scrollTo({ top: top, behavior: "instant" });
      }
    }, 100);
  }

  /* ---- Active nav tab while scrolling (home page only) ---- */
  var tabs = Array.prototype.slice.call(
    document.querySelectorAll('.nav-links a[href^="#"]')
  );

  if (tabs.length && "IntersectionObserver" in window) {
    var sections = tabs
      .map(function (t) {
        return document.getElementById(t.getAttribute("href").slice(1));
      })
      .filter(Boolean);

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var id = entry.target.id;
          tabs.forEach(function (t) {
            t.classList.toggle(
              "is-active",
              t.getAttribute("href") === "#" + id
            );
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );

    sections.forEach(function (s) {
      observer.observe(s);
    });
  }

  /* ---- "Live" channel preview: nudge timestamps to look current ---- */
  var stamp = document.querySelector("[data-live-stamp]");
  if (stamp) {
    var mins = 1;
    setInterval(function () {
      mins += 1;
      stamp.textContent = "active " + mins + "m ago";
    }, 45000);
  }
})();
