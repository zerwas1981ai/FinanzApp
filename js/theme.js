// Wird im <head> geladen, damit Hell/Dunkel gesetzt ist, bevor etwas gezeichnet wird.
// Gespeicherte Wahl in localStorage ("hell" / "dunkel"); ohne Wahl gilt die Systemeinstellung.
(function () {
  var t = null;
  try { t = localStorage.getItem('finanzapp-theme'); } catch (e) { /* z. B. privater Modus */ }
  if (t !== 'hell' && t !== 'dunkel') {
    t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dunkel' : 'hell';
  }
  document.documentElement.setAttribute('data-theme', t);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dunkel' ? '#0e1013' : '#f5f6f8');
})();
