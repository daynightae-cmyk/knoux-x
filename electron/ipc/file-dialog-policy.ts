export interface DialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export type DialogKind = 'open' | 'open-multiple' | 'open-directory' | 'save';

export function validateFileDialogOptions(value: unknown): DialogOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('File dialog options are invalid.');
  const options = value as DialogOptions;
  for (const text of [options.title, options.defaultPath, options.buttonLabel]) {
    if (text !== undefined && (typeof text !== 'string' || text.length > 4096 || text.includes('\u0000'))) throw new TypeError('File dialog text is invalid.');
  }
  if (options.filters !== undefined) {
    if (!Array.isArray(options.filters) || options.filters.length > 32) throw new TypeError('File dialog filters are invalid.');
    for (const filter of options.filters) {
      if (!filter || typeof filter.name !== 'string' || filter.name.length === 0 || filter.name.length > 128 || !Array.isArray(filter.extensions)) {
        throw new TypeError('File dialog filter is invalid.');
      }
      if (filter.extensions.length === 0 || filter.extensions.length > 64 || filter.extensions.some((extension) => (
        typeof extension !== 'string' || !/^(\*|[a-z0-9]{1,12})$/i.test(extension)
      ))) throw new TypeError('File dialog extension is invalid.');
    }
  }
  return structuredClone(options);
}

export function cancelledDialogResult(kind: 'open-multiple'): string[];
export function cancelledDialogResult(kind: Exclude<DialogKind, 'open-multiple'>): null;
export function cancelledDialogResult(kind: DialogKind): null | string[] {
  return kind === 'open-multiple' ? [] : null;
}
