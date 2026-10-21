/** In-app output authorization, not an operating-system/browser data-loss boundary. */
export function requireAuthorizedDataOutput(allowed: boolean, authorize?: () => void): void {
  if (!allowed || !authorize) throw new Error('هذا الحساب لا يملك صلاحية تنزيل البيانات أو طباعتها.');
  authorize();
}

export function downloadAuthorizedImage(url: string, filename: string, allowed: boolean, authorize?: () => void): void {
  requireAuthorizedDataOutput(allowed, authorize);
  if (!url) throw new Error('لا توجد صورة متاحة للتنزيل.');
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    // Recheck immediately before output, including account/role changes since opening the modal.
    requireAuthorizedDataOutput(allowed, authorize);
    anchor.click();
  } finally {
    anchor.remove();
  }
}

export function printAuthorizedDocument(allowed: boolean, authorize?: () => void, print: () => void = () => window.print()): void {
  requireAuthorizedDataOutput(allowed, authorize);
  print();
}
