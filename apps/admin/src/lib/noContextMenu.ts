/**
 * Nexo panels: no right-click menu, except inside fields (to paste, spell-check…). Text selection is
 * blocked with CSS (.nx-shell, .nx-auth) so fields keep working.
 */
export function blockContextMenu() {
  document.addEventListener("contextmenu", (e) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest("input, textarea, select, [contenteditable='true'], .nx-selectable, .nx-copy__value, .nx-codeblock")) return;
    e.preventDefault();
  });
}
