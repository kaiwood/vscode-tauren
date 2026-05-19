export const copyIconSvg = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5 1.75A1.75 1.75 0 0 1 6.75 0h6.5A1.75 1.75 0 0 1 15 1.75v6.5A1.75 1.75 0 0 1 13.25 10h-1.5v1.25A1.75 1.75 0 0 1 10 13H3.75A1.75 1.75 0 0 1 2 11.25v-6.5A1.75 1.75 0 0 1 3.75 3H5V1.75Zm1.75-.25a.25.25 0 0 0-.25.25V3H10a1.75 1.75 0 0 1 1.75 1.75V8.5h1.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25h-6.5ZM3.75 4.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25H10a.25.25 0 0 0 .25-.25v-6.5A.25.25 0 0 0 10 4.5H3.75Z"/></svg>';

export function createIconActionButton(className: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = copyIconSvg;

  const tooltip = document.createElement('span');
  tooltip.className = 'tau-icon-action-tooltip';
  tooltip.textContent = label;
  button.append(tooltip);

  return button;
}
