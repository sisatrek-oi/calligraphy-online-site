// Use the secure clipboard API first; older browsers can still copy from a selection.
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; }
    catch { /* Try the browser's selection-based copy before offering manual copy. */ }
  }
  const previous = document.activeElement;
  const selection = previous && typeof previous.selectionStart === 'number'
    ? [previous.selectionStart, previous.selectionEnd, previous.selectionDirection] : null;
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(field);
  let copied = false;
  try {
    field.focus({ preventScroll: true });
    field.select();
    copied = document.execCommand('copy');
  } finally {
    field.remove();
    if (previous?.isConnected) {
      previous.focus({ preventScroll: true });
      if (selection) previous.setSelectionRange(...selection);
    }
  }
  if (!copied) throw new Error('Clipboard unavailable');
}
