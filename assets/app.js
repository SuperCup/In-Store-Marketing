const searchInput = document.querySelector("[data-search]");
const platformFilterButtons = Array.from(document.querySelectorAll("[data-platform-filter]"));
const reviewFilterButtons = Array.from(document.querySelectorAll("[data-review-filter]"));
const cards = Array.from(document.querySelectorAll("[data-card]"));
const dateGroups = Array.from(document.querySelectorAll("[data-date-group]"));
const historyPanel = document.querySelector("[data-history]");
const historyToggle = document.querySelector("[data-history-toggle]");
const emptyFilter = document.querySelector("[data-empty-filter]");

let activePlatformFilter = "all";
let activeReviewFilter = "all";

function normalize(value) {
  return (value || "").toLowerCase().trim();
}

function applyFilters() {
  const query = normalize(searchInput?.value);
  cards.forEach((card) => {
    const text = normalize(card.dataset.searchText);
    const platformText = normalize(card.dataset.platforms);
    const reviewStatus = normalize(card.dataset.reviewStatus);
    const matchesQuery = !query || text.includes(query);
    const matchesPlatform = activePlatformFilter === "all" || platformText.includes(activePlatformFilter);
    const matchesReview = activeReviewFilter === "all" || reviewStatus === activeReviewFilter;
    card.hidden = !(matchesQuery && matchesPlatform && matchesReview);
  });

  dateGroups.forEach((group) => {
    const visibleCards = Array.from(group.querySelectorAll("[data-card]")).filter((card) => !card.hidden);
    group.hidden = visibleCards.length === 0;
  });

  if (emptyFilter) {
    const visibleCards = cards.filter((card) => {
      const inHiddenHistory = historyPanel?.hidden && historyPanel.contains(card);
      return !card.hidden && !inHiddenHistory;
    });
    emptyFilter.hidden = cards.length === 0 || visibleCards.length > 0;
  }
}

platformFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activePlatformFilter = normalize(button.dataset.platformFilter);
    platformFilterButtons.forEach((item) => item.classList.toggle("active", item === button));
    applyFilters();
  });
});

reviewFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeReviewFilter = normalize(button.dataset.reviewFilter);
    reviewFilterButtons.forEach((item) => item.classList.toggle("active", item === button));
    applyFilters();
  });
});

searchInput?.addEventListener("input", applyFilters);

historyToggle?.addEventListener("click", () => {
  if (!historyPanel) return;
  const shouldShow = historyPanel.hidden;
  historyPanel.hidden = !shouldShow;
  historyToggle.setAttribute("aria-expanded", String(shouldShow));
  historyToggle.textContent = shouldShow
    ? historyToggle.dataset.labelExpanded
    : historyToggle.dataset.labelCollapsed;
  applyFilters();
});

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.querySelector(button.dataset.copy);
    if (!target) return;
    await navigator.clipboard.writeText(target.innerText);
    const original = button.textContent;
    button.textContent = "已复制";
    setTimeout(() => {
      button.textContent = original;
    }, 1500);
  });
});

applyFilters();
