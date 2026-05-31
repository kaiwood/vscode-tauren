export function createTooltipElement(text: string): HTMLSpanElement {
  const tooltip = document.createElement('span');
  tooltip.className = 'tauren-icon-action-tooltip';
  tooltip.textContent = text;
  return tooltip;
}

export function setTooltipText(element: HTMLElement, text: string): void {
  const tooltip = element.querySelector<HTMLElement>('.tauren-icon-action-tooltip');

  if (tooltip) {
    tooltip.textContent = text;
  }
}
