/* Coeso — Stage archive topic filters (client-side) */
(function () {
  "use strict";

  var filters = document.getElementById("archiveFilters");
  var list = document.getElementById("archiveList");
  var empty = document.getElementById("archiveEmpty");
  var count = document.getElementById("filterCount");

  if (!filters || !list) return;

  var chips = Array.prototype.slice.call(filters.querySelectorAll(".chip"));
  var cards = Array.prototype.slice.call(list.querySelectorAll(".archive-card"));
  var emptyTopic = empty ? empty.querySelector("[data-empty-topic]") : null;

  function apply(topic) {
    var visible = 0;

    cards.forEach(function (card) {
      var topics = (card.getAttribute("data-topics") || "").split(/\s+/);
      var show = topic === "all" || topics.indexOf(topic) > -1;
      card.hidden = !show;
      if (show) visible += 1;
    });

    chips.forEach(function (chip) {
      var active = chip.getAttribute("data-filter") === topic;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if (count) {
      count.textContent =
        visible + (visible === 1 ? " session" : " sessions");
    }

    if (empty) {
      empty.hidden = visible !== 0;
      if (emptyTopic && visible === 0) {
        var label = chips
          .filter(function (c) {
            return c.getAttribute("data-filter") === topic;
          })
          .map(function (c) {
            return c.textContent.trim();
          })[0];
        emptyTopic.textContent = label || topic;
      }
    }
  }

  filters.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    apply(chip.getAttribute("data-filter") || "all");
  });

  apply("all");
})();
