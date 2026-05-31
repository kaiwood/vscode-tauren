export function shouldOpenSessionListContextMenu(
  event: Pick<MouseEvent, 'button'>,
  options: { nameEditing: boolean }
): boolean {
  return !options.nameEditing && event.button === 2;
}
