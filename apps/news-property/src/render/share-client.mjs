/** Copy an article's canonical URL without an inline event handler. */
export function shareClientScript() {
  return `(function(){
  document.querySelectorAll(".share-links [data-copy-link]").forEach(function(button){
    button.addEventListener("click", async function(){
      var status=button.nextElementSibling;
      if (!status) return;
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        status.textContent="Copy unavailable. Select the address bar URL.";
        return;
      }
      try {
        await navigator.clipboard.writeText(button.dataset.copyLink);
        status.textContent="Link copied.";
      } catch (_) {
        status.textContent="Copy unavailable. Select the address bar URL.";
      }
    });
  });
})();`;
}
