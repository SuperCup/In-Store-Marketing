const searchInput = document.querySelector("[data-search]");
const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
const cards = Array.from(document.querySelectorAll("[data-card]"));

let activeFilter = "all";

function normalize(value) {
  return (value || "").toLowerCase().trim();
}

function applyFilters() {
  const query = normalize(searchInput?.value);
  cards.forEach((card) => {
    const text = normalize(card.dataset.searchText);
    const platformText = normalize(card.dataset.platforms);
    const matchesQuery = !query || text.includes(query);
    const matchesFilter = activeFilter === "all" || platformText.includes(activeFilter);
    card.hidden = !(matchesQuery && matchesFilter);
  });
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle("active", item === button));
    applyFilters();
  });
});

searchInput?.addEventListener("input", applyFilters);

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
