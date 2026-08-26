// Close the other FAQ items when one opens. The page works without this —
// <details> is already functional — so keep it to that one behaviour.
const items = document.querySelectorAll('#faq details');
items.forEach(item => {
  item.addEventListener('toggle', () => {
    if (!item.open) return;
    items.forEach(other => { if (other !== item) other.open = false; });
  });
});
