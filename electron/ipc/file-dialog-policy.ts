export interface DialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: string[];
}

export type DialogKind = 'open' | 'open-multiple' | 'open-directory' | 'save';

export type OpenDialogProperty = 'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory';
export type SaveDialogProperty = 'createDirectory' | 'showOverwriteConfirmation';
export type FileDialogProperty = OpenDialogProperty | SaveDialogProperty;

const DIALOG_BASE_PROPERTIES: Record<DialogKind, readonly FileDialogProperty[]> = {
  open: ['openFile'],
  'open-multiple': ['openFile', 'multiSelections'],
  'open-directory': ['openDirectory'],
  save: [],
};

const DIALOG_ALLOWED_PROPERTIES: Record<DialogKind, readonly FileDialogProperty[]> = {
  open: ['openFile'],
  'open-multiple': ['openFile', 'multiSelections'],
  'open-directory': ['openDirectory', 'createDirectory'],
  save: ['createDirectory', 'showOverwriteConfirmation'],
};

const KNOWN_DIALOG_PROPERTIES = new Set<string>([
  'openFile', 'openDirectory', 'multiSelections', 'createDirectory', 'showOverwriteConfirmation',
]);

function requireDialogProperties(value: unknown): FileDialogProperty[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new TypeError('File dialog properties are invalid.');
  for (const property of value) {
    if (typeof property !== 'string' || !KNOWN_DIALOG_PROPERTIES.has(property)) throw new TypeError('File dialog property is invalid.');
  }
  return [...new Set(value as FileDialogProperty[])];
}

export function dialogProperties(kind: 'save', value: unknown): SaveDialogProperty[];
export function dialogProperties(kind: Exclude<DialogKind, 'save'>, value: unknown): OpenDialogProperty[];
export function dialogProperties(kind: DialogKind, value: unknown): OpenDialogProperty[] | SaveDialogProperty[] {
  const allowed = new Set<FileDialogProperty>(DIALOG_ALLOWED_PROPERTIES[kind]);
  return [...new Set([
    ...DIALOG_BASE_PROPERTIES[kind],
    ...requireDialogProperties(value).filter((property) => allowed.has(property)),
  ])] as OpenDialogProperty[] | SaveDialogProperty[];
}

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
  requireDialogProperties(options.properties);
  return structuredClone(options);
}

export function cancelledDialogResult(kind: 'open-multiple'): string[];
export function cancelledDialogResult(kind: Exclude<DialogKind, 'open-multiple'>): null;
export function cancelledDialogResult(kind: DialogKind): null | string[] {
  return kind === 'open-multiple' ? [] : null;
}
