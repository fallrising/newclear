'use strict';
(() => {
  const form = document.querySelector('.filters');
  if (!form) return;
  const search = document.querySelector('#search');
  const category = document.querySelector('#category');
  const status = document.querySelector('#status');
  const cards = [...document.querySelectorAll('.card')];
  const count = document.querySelector('#count');
  const empty = document.querySelector('#empty');
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase();
  const searchable = cards.map(card => normalize(card.dataset.search));
  function filter() {
    const terms = normalize(search.value).trim().split(/\s+/u).filter(Boolean);
    let visible = 0;
    cards.forEach((card, index) => {
      const match = (!category.value || card.dataset.category === category.value)
        && (!status || !status.value || card.dataset.status === status.value)
        && terms.every(term => searchable[index].includes(term));
      card.hidden = !match;
      visible += Number(match);
    });
    count.textContent = `顯示 ${visible} / ${cards.length} 篇`;
    empty.hidden = visible !== 0;
  }
  form.addEventListener('submit', event => event.preventDefault());
  search.addEventListener('input', filter);
  category.addEventListener('change', filter);
  status?.addEventListener('change', filter);
  form.addEventListener('reset', () => {
    search.value = '';
    category.value = '';
    if (status) status.value = '';
    filter();
  });
  filter();
})();
