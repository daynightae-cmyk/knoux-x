import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';

import { NeonButton } from '../../components/neon/NeonButton';
import { NeonPanel } from '../../components/neon/NeonPanel';
import {
  DEFAULT_RECORDING_CONFIGURATION,
  DEFAULT_RECORDING_TOOLBAR,
  DEFAULT_SHORTCUTS,
  DEFAULT_WORKSPACE_SETTINGS,
  STUDIO_PRESET_KINDS,
  WORKSPACE_MODULES,
  createStudioPreset,
  duplicateStudioPreset,
  renameStudioPreset,
  validateShortcutBindings,
  validateStudioPresets,
  type ApplicationSettingKey,
  type ApplicationSettings,
  type KnouxCommandCategory,
  type RecordingToolbarButtonId,
  type ShortcutBinding,
  type StudioPreset,
  type StudioPresetKind,
  type WorkspaceModuleId,
  type WorkspacePreset,
} from '../../core/settings/applicationSettings';
import { useTranslation } from '../../i18n';

interface Props {
  settings: ApplicationSettings;
  busy: boolean;
  updateSetting<K extends ApplicationSettingKey>(key: K, value: ApplicationSettings[K]): Promise<void>;
  reportError(message: string): void;
  reportNotice(message: string): void;
}

const commandLabels: Record<string, { en: string; ar: string }> = {
  'play-pause': { en: 'Play / Pause', ar: 'تشغيل / إيقاف مؤقت' },
  stop: { en: 'Stop', ar: 'إيقاف' },
  'seek-backward': { en: 'Seek backward', ar: 'ترجيع' },
  'seek-forward': { en: 'Seek forward', ar: 'تقديم' },
  'frame-step-backward': { en: 'Previous frame', ar: 'الإطار السابق' },
  'frame-step-forward': { en: 'Next frame', ar: 'الإطار التالي' },
  screenshot: { en: 'Screenshot', ar: 'لقطة شاشة' },
  'record-start-stop': { en: 'Start / Stop recording', ar: 'بدء / إيقاف التسجيل' },
  'record-pause-resume': { en: 'Pause / Resume recording', ar: 'إيقاف / استئناف التسجيل' },
  'region-capture': { en: 'Region capture', ar: 'التقاط منطقة' },
  'split-clip': { en: 'Split clip', ar: 'تقسيم المقطع' },
  'trim-in': { en: 'Trim In', ar: 'بداية القص' },
  'trim-out': { en: 'Trim Out', ar: 'نهاية القص' },
  undo: { en: 'Undo', ar: 'تراجع' }, redo: { en: 'Redo', ar: 'إعادة' },
  save: { en: 'Save', ar: 'حفظ' }, export: { en: 'Export', ar: 'تصدير' },
  fullscreen: { en: 'Fullscreen', ar: 'ملء الشاشة' },
  'theater-mode': { en: 'Theater mode', ar: 'وضع المسرح' },
  mute: { en: 'Mute', ar: 'كتم' }, 'volume-up': { en: 'Volume up', ar: 'رفع الصوت' },
  'volume-down': { en: 'Volume down', ar: 'خفض الصوت' }, 'open-file': { en: 'Open file', ar: 'فتح ملف' },
};

function move<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const destination = index + direction;
  if (destination < 0 || destination >= items.length) return [...items];
  const next = [...items];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

function downloadName(kind: StudioPresetKind): string {
  return `KNOUX-${kind}-presets.json`;
}

export const CustomizationSettingsPanel: React.FC<Props> = ({
  settings,
  busy,
  updateSetting,
  reportError,
  reportNotice,
}) => {
  const { locale } = useTranslation();
  const rtl = locale === 'ar';
  const [shortcutSearch, setShortcutSearch] = useState('');
  const [shortcutCategory, setShortcutCategory] = useState<'all' | KnouxCommandCategory>('all');
  const [shortcutDrafts, setShortcutDrafts] = useState<Record<string, string>>({});
  const [presetKind, setPresetKind] = useState<StudioPresetKind>('recording');
  const [presetName, setPresetName] = useState('');
  const [workspacePresetName, setWorkspacePresetName] = useState('');

  const visibleShortcuts = useMemo(() => settings.shortcuts.filter((binding) => {
    if (shortcutCategory !== 'all' && binding.category !== shortcutCategory) return false;
    const label = commandLabels[binding.command]?.[locale] ?? binding.command;
    return `${label} ${binding.accelerator}`.toLocaleLowerCase(locale).includes(shortcutSearch.trim().toLocaleLowerCase(locale));
  }), [locale, settings.shortcuts, shortcutCategory, shortcutSearch]);

  const updateShortcuts = async (next: ShortcutBinding[]): Promise<boolean> => {
    try {
      await updateSetting('shortcuts', validateShortcutBindings(next));
      return true;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : 'Shortcut settings are invalid.');
      return false;
    }
  };

  const commitShortcutDraft = async (binding: ShortcutBinding): Promise<void> => {
    const accelerator = shortcutDrafts[binding.command] ?? binding.accelerator;
    const saved = await updateShortcuts(settings.shortcuts.map((entry) => entry.command === binding.command ? { ...entry, accelerator } : entry));
    if (saved) setShortcutDrafts((current) => {
      const next = { ...current };
      delete next[binding.command];
      return next;
    });
  };

  const updateToolbar = async (patch: Partial<ApplicationSettings['recordingToolbar']>): Promise<void> => {
    await updateSetting('recordingToolbar', { ...settings.recordingToolbar, ...patch });
  };

  const toggleToolbarButton = async (button: RecordingToolbarButtonId): Promise<void> => {
    const hidden = settings.recordingToolbar.hidden.includes(button)
      ? settings.recordingToolbar.hidden.filter((entry) => entry !== button)
      : [...settings.recordingToolbar.hidden, button];
    await updateToolbar({ hidden });
  };

  const updateWorkspace = async (patch: Partial<ApplicationSettings['workspace']>): Promise<void> => {
    await updateSetting('workspace', { ...settings.workspace, ...patch });
  };

  const applyWorkspacePreset = async (id: string): Promise<void> => {
    if (id === 'default') {
      await updateSetting('workspace', { ...structuredClone(DEFAULT_WORKSPACE_SETTINGS), presets: settings.workspace.presets });
      return;
    }
    const preset = settings.workspace.presets.find((entry) => entry.id === id);
    if (!preset) return;
    await updateSetting('workspace', {
      ...settings.workspace,
      moduleOrder: preset.moduleOrder,
      hiddenModules: preset.hiddenModules,
      sidebarWidth: preset.sidebarWidth,
      timelineHeight: preset.timelineHeight,
      panelSizes: preset.panelSizes,
      collapsedSections: preset.collapsedSections,
      selectedWorkspace: preset.id,
    });
  };

  const saveWorkspacePreset = async (): Promise<void> => {
    const name = workspacePresetName.trim();
    if (!name) return;
    const preset: WorkspacePreset = {
      id: `workspace-${crypto.randomUUID()}`,
      name,
      moduleOrder: [...settings.workspace.moduleOrder],
      hiddenModules: [...settings.workspace.hiddenModules],
      sidebarWidth: settings.workspace.sidebarWidth,
      timelineHeight: settings.workspace.timelineHeight,
      panelSizes: { ...settings.workspace.panelSizes },
      collapsedSections: [...settings.workspace.collapsedSections],
    };
    await updateWorkspace({ presets: [...settings.workspace.presets, preset], selectedWorkspace: preset.id });
    setWorkspacePresetName('');
  };

  const addPreset = async (): Promise<void> => {
    const name = presetName.trim();
    if (!name) return;
    const values: StudioPreset['values'] = presetKind === 'recording'
      ? { ...settings.recordingConfiguration }
      : presetKind === 'capture'
        ? { format: 'png', delay: settings.recordingConfiguration.countdown }
        : presetKind === 'video-editing'
          ? { timelineHeight: settings.workspace.timelineHeight }
          : { selected: settings.lastSelectedPresets[presetKind] ?? '' };
    const preset = createStudioPreset(presetKind, name, values);
    await updateSetting('studioPresets', [...settings.studioPresets, preset]);
    await updateSetting('lastSelectedPresets', { ...settings.lastSelectedPresets, [presetKind]: preset.id });
    setPresetName('');
  };

  const exportPresets = async (): Promise<void> => {
    const destination = await window.knouxAPI.file.saveFile({
      title: rtl ? 'تصدير الإعدادات المسبقة' : 'Export presets',
      defaultPath: downloadName(presetKind),
      filters: [{ name: 'KNOUX Presets', extensions: ['json'] }],
    });
    if (!destination) return;
    const selected = settings.studioPresets.filter((preset) => preset.kind === presetKind);
    await window.knouxAPI.file.writeFile(destination, JSON.stringify({ product: 'KNOUX Player X', kind: presetKind, presets: selected }, null, 2));
    reportNotice(rtl ? 'تم تصدير الإعدادات المسبقة.' : 'Presets exported.');
  };

  const importPresets = async (): Promise<void> => {
    try {
      const source = await window.knouxAPI.file.openFile({
        title: rtl ? 'استيراد الإعدادات المسبقة' : 'Import presets',
        filters: [{ name: 'KNOUX Presets', extensions: ['json'] }],
      });
      if (!source) return;
      const raw = await window.knouxAPI.file.readFile(source);
      const decoded = JSON.parse(new TextDecoder().decode(raw)) as { product?: string; kind?: string; presets?: unknown };
      if (decoded.product !== 'KNOUX Player X') throw new TypeError('Preset file belongs to another product.');
      if (decoded.kind !== presetKind) throw new TypeError('Preset file belongs to another studio.');
      const imported = validateStudioPresets(decoded.presets);
      if (imported.some((preset) => preset.kind !== presetKind)) throw new TypeError('Preset file contains a mismatched studio kind.');
      const merged = settings.studioPresets.filter((preset) => !imported.some((entry) => entry.id === preset.id));
      await updateSetting('studioPresets', [...merged, ...imported]);
      reportNotice(rtl ? 'تم استيراد الإعدادات المسبقة.' : 'Presets imported.');
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : 'Preset import failed.');
    }
  };

  const currentPresets = settings.studioPresets.filter((preset) => preset.kind === presetKind);

  return (
    <div className="customization-settings-stack">
      <NeonPanel variant="dark" padding="lg">
        <div className="settings-section-heading">
          <div><strong>{rtl ? 'شريط تحكم التسجيل' : 'Recording toolbar'}</strong><small>{rtl ? 'إظهار وإخفاء وترتيب عناصر التحكم الفعلية.' : 'Show, hide and reorder the live recording commands.'}</small></div>
          <NeonButton variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={() => void updateSetting('recordingToolbar', structuredClone(DEFAULT_RECORDING_TOOLBAR))}>
            {rtl ? 'الافتراضي' : 'Reset'}
          </NeonButton>
        </div>
        <div className="settings-two-columns">
          <label><span>{rtl ? 'الوضع' : 'Mode'}</span><select value={settings.recordingToolbar.mode} onChange={(event) => void updateToolbar({ mode: event.target.value as ApplicationSettings['recordingToolbar']['mode'] })}><option value="full">Full toolbar</option><option value="compact">Compact toolbar</option><option value="floating">Floating mini-controller</option></select></label>
          <label><span>{rtl ? 'الحجم' : 'Control size'}</span><select value={settings.recordingToolbar.size} onChange={(event) => void updateToolbar({ size: event.target.value as ApplicationSettings['recordingToolbar']['size'] })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
          <label><span>X</span><input type="number" min="0" max="7680" value={settings.recordingToolbar.position.x} onChange={(event) => void updateToolbar({ position: { ...settings.recordingToolbar.position, x: Number(event.target.value) } })} /></label>
          <label><span>Y</span><input type="number" min="0" max="4320" value={settings.recordingToolbar.position.y} onChange={(event) => void updateToolbar({ position: { ...settings.recordingToolbar.position, y: Number(event.target.value) } })} /></label>
        </div>
        <div className="customization-order-list">
          {settings.recordingToolbar.order.map((button, index) => (
            <div key={button}>
              <label><input type="checkbox" checked={!settings.recordingToolbar.hidden.includes(button)} onChange={() => void toggleToolbarButton(button)} /> <span>{button.replaceAll('-', ' ')}</span></label>
              <span className="customization-move-actions"><button type="button" disabled={index === 0} onClick={() => void updateToolbar({ order: move(settings.recordingToolbar.order, index, -1) })}><ArrowUp size={14} /></button><button type="button" disabled={index === settings.recordingToolbar.order.length - 1} onClick={() => void updateToolbar({ order: move(settings.recordingToolbar.order, index, 1) })}><ArrowDown size={14} /></button></span>
            </div>
          ))}
        </div>
      </NeonPanel>

      <NeonPanel variant="dark" padding="lg">
        <div className="settings-section-heading"><div><strong>{rtl ? 'اختصارات لوحة المفاتيح' : 'Keyboard shortcuts'}</strong><small>{rtl ? 'تُرفض التعارضات قبل الحفظ.' : 'Conflicts are rejected before saving.'}</small></div><NeonButton variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={() => void updateShortcuts(structuredClone(DEFAULT_SHORTCUTS))}>{rtl ? 'إعادة ضبط الكل' : 'Reset all'}</NeonButton></div>
        <div className="settings-two-columns"><label><span>{rtl ? 'بحث' : 'Search'}</span><input type="search" value={shortcutSearch} onChange={(event) => setShortcutSearch(event.target.value)} /></label><label><span>{rtl ? 'الفئة' : 'Category'}</span><select value={shortcutCategory} onChange={(event) => setShortcutCategory(event.target.value as typeof shortcutCategory)}><option value="all">All</option><option value="playback">Playback</option><option value="recording">Recording</option><option value="editing">Editing</option><option value="workspace">Workspace</option><option value="file">File</option></select></label></div>
        <div className="shortcut-manager-list">
          {visibleShortcuts.map((binding) => {
            const reset = DEFAULT_SHORTCUTS.find((entry) => entry.command === binding.command) ?? binding;
            return <div key={binding.command}><label><input type="checkbox" checked={binding.enabled} onChange={(event) => void updateShortcuts(settings.shortcuts.map((entry) => entry.command === binding.command ? { ...entry, enabled: event.target.checked } : entry))} /><span>{commandLabels[binding.command]?.[locale] ?? binding.command}</span></label><input aria-label={`${binding.command} accelerator`} dir="ltr" value={shortcutDrafts[binding.command] ?? binding.accelerator} onChange={(event) => setShortcutDrafts((current) => ({ ...current, [binding.command]: event.target.value }))} onBlur={() => void commitShortcutDraft(binding)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><button type="button" title={rtl ? 'إعادة ضبط هذا الاختصار' : 'Reset this shortcut'} onClick={() => { setShortcutDrafts((current) => ({ ...current, [binding.command]: reset.accelerator })); void updateShortcuts(settings.shortcuts.map((entry) => entry.command === binding.command ? reset : entry)); }}><RotateCcw size={14} /></button></div>;
          })}
        </div>
      </NeonPanel>

      <NeonPanel variant="dark" padding="lg">
        <div className="settings-section-heading"><div><strong>{rtl ? 'مساحة العمل' : 'Workspace'}</strong><small>{rtl ? 'ترتيب الوحدات وأحجام اللوحات مع إبقائها داخل الشاشة.' : 'Module order and viewport-bounded panel sizes.'}</small></div><NeonButton variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={() => void updateSetting('workspace', { ...structuredClone(DEFAULT_WORKSPACE_SETTINGS), presets: settings.workspace.presets })}>{rtl ? 'إعادة ضبط المساحة' : 'Reset workspace'}</NeonButton></div>
        <div className="settings-two-columns"><label><span>{rtl ? 'مساحة محفوظة' : 'Workspace preset'}</span><select value={settings.workspace.selectedWorkspace} onChange={(event) => void applyWorkspacePreset(event.target.value)}><option value="default">Default</option>{settings.workspace.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label><label><span>{rtl ? 'حفظ المساحة الحالية' : 'Save current workspace'}</span><span className="customization-name-field"><input value={workspacePresetName} maxLength={100} onChange={(event) => setWorkspacePresetName(event.target.value)} /><button type="button" disabled={!workspacePresetName.trim()} onClick={() => void saveWorkspacePreset()}><Plus size={15} /></button></span></label></div>
        {settings.workspace.presets.length > 0 && <div className="preset-manager-list">{settings.workspace.presets.map((preset) => <div key={preset.id}><button type="button" className={settings.workspace.selectedWorkspace === preset.id ? 'active' : ''} onClick={() => void applyWorkspacePreset(preset.id)}>{preset.name}</button><button type="button" title={rtl ? 'حذف' : 'Delete'} onClick={() => void updateWorkspace({ presets: settings.workspace.presets.filter((entry) => entry.id !== preset.id), selectedWorkspace: settings.workspace.selectedWorkspace === preset.id ? 'default' : settings.workspace.selectedWorkspace })}><Trash2 size={14} /></button></div>)}</div>}
        <div className="settings-two-columns"><label><span>{rtl ? 'عرض الشريط الجانبي' : 'Sidebar width'}</span><input type="range" min="220" max="480" value={settings.workspace.sidebarWidth} onChange={(event) => void updateWorkspace({ sidebarWidth: Number(event.target.value) })} /></label><label><span>{rtl ? 'ارتفاع الخط الزمني' : 'Timeline height'}</span><input type="range" min="160" max="900" value={settings.workspace.timelineHeight} onChange={(event) => void updateWorkspace({ timelineHeight: Number(event.target.value) })} /></label><label><span>{rtl ? 'لوحة الفاحص' : 'Inspector panel'}</span><input type="number" min="80" max="4096" value={settings.workspace.panelSizes.inspector ?? 320} onChange={(event) => void updateWorkspace({ panelSizes: { ...settings.workspace.panelSizes, inspector: Number(event.target.value) } })} /></label><label><span>{rtl ? 'لوحة الوسائط' : 'Media bin panel'}</span><input type="number" min="80" max="4096" value={settings.workspace.panelSizes.mediaBin ?? 280} onChange={(event) => void updateWorkspace({ panelSizes: { ...settings.workspace.panelSizes, mediaBin: Number(event.target.value) } })} /></label><label><span>{rtl ? 'لوحة المعاينة' : 'Preview panel'}</span><input type="number" min="80" max="4096" value={settings.workspace.panelSizes.preview ?? 520} onChange={(event) => void updateWorkspace({ panelSizes: { ...settings.workspace.panelSizes, preview: Number(event.target.value) } })} /></label></div>
        <div className="customization-order-list">
          {settings.workspace.moduleOrder.map((module, index) => <div key={module}><label><input type="checkbox" checked={!settings.workspace.hiddenModules.includes(module) || module === 'settings'} disabled={module === 'settings'} onChange={() => void updateWorkspace({ hiddenModules: settings.workspace.hiddenModules.includes(module) ? settings.workspace.hiddenModules.filter((entry) => entry !== module) : [...settings.workspace.hiddenModules, module] })} /><span>{module}</span></label><span className="customization-move-actions"><button type="button" disabled={index === 0} onClick={() => void updateWorkspace({ moduleOrder: move(settings.workspace.moduleOrder, index, -1) })}><ArrowUp size={14} /></button><button type="button" disabled={index === settings.workspace.moduleOrder.length - 1} onClick={() => void updateWorkspace({ moduleOrder: move(settings.workspace.moduleOrder, index, 1) })}><ArrowDown size={14} /></button></span></div>)}
        </div>
        <div className="settings-two-columns"><label><span>{rtl ? 'آخر قسم' : 'Last section'}</span><select value={settings.workspace.lastOpenedSection} onChange={(event) => void updateWorkspace({ lastOpenedSection: event.target.value as WorkspaceModuleId })}>{WORKSPACE_MODULES.filter((module) => !settings.workspace.hiddenModules.includes(module)).map((module) => <option key={module}>{module}</option>)}</select></label><label><span>{rtl ? 'قسم مطوي' : 'Collapsed section'}</span><input value={settings.workspace.collapsedSections[0] ?? ''} onChange={(event) => void updateWorkspace({ collapsedSections: event.target.value ? [event.target.value] : [] })} /></label></div>
      </NeonPanel>

      <NeonPanel variant="dark" padding="lg">
        <div className="settings-section-heading"><div><strong>{rtl ? 'الإعدادات المسبقة' : 'Studio presets'}</strong><small>{rtl ? 'إنشاء ونسخ وإعادة تسمية واستيراد وتصدير.' : 'Create, duplicate, rename, import and export.'}</small></div><div className="customization-inline-actions"><NeonButton variant="ghost" size="sm" leftIcon={<Upload size={14} />} onClick={() => void importPresets()}>{rtl ? 'استيراد' : 'Import'}</NeonButton><NeonButton variant="ghost" size="sm" leftIcon={<Download size={14} />} onClick={() => void exportPresets()}>{rtl ? 'تصدير' : 'Export'}</NeonButton></div></div>
        <div className="settings-two-columns"><label><span>{rtl ? 'الاستوديو' : 'Studio'}</span><select value={presetKind} onChange={(event) => setPresetKind(event.target.value as StudioPresetKind)}>{STUDIO_PRESET_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label><span>{rtl ? 'اسم جديد' : 'New preset name'}</span><span className="customization-name-field"><input value={presetName} maxLength={100} onChange={(event) => setPresetName(event.target.value)} /><button type="button" disabled={!presetName.trim() || busy} onClick={() => void addPreset()}><Plus size={15} /></button></span></label></div>
        <div className="preset-manager-list">
          {currentPresets.map((preset) => <div key={preset.id}><button type="button" className={settings.lastSelectedPresets[presetKind] === preset.id ? 'active' : ''} onClick={() => void updateSetting('lastSelectedPresets', { ...settings.lastSelectedPresets, [presetKind]: preset.id })}>{preset.name}</button><button type="button" title={rtl ? 'نسخ' : 'Duplicate'} onClick={() => void updateSetting('studioPresets', [...settings.studioPresets, duplicateStudioPreset(preset, `${preset.name} Copy`)])}><Copy size={14} /></button><button type="button" title={rtl ? 'إعادة تسمية' : 'Rename'} onClick={() => { const name = window.prompt(rtl ? 'الاسم الجديد' : 'New name', preset.name); if (name?.trim()) void updateSetting('studioPresets', settings.studioPresets.map((entry) => entry.id === preset.id ? renameStudioPreset(entry, name) : entry)); }}><span aria-hidden="true">✎</span></button><button type="button" title={rtl ? 'حذف' : 'Delete'} onClick={() => void updateSetting('studioPresets', settings.studioPresets.filter((entry) => entry.id !== preset.id))}><Trash2 size={14} /></button></div>)}
          {currentPresets.length === 0 && <div className="creative-empty">{rtl ? 'لا توجد إعدادات مسبقة مخصصة.' : 'No custom presets yet.'}</div>}
        </div>
        <div className="customization-inline-actions"><NeonButton variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={() => void updateSetting('studioPresets', settings.studioPresets.filter((preset) => preset.kind !== presetKind))}>{rtl ? 'إعادة ضبط هذه الفئة' : 'Reset category'}</NeonButton><NeonButton variant="ghost" size="sm" leftIcon={<RotateCcw size={14} />} onClick={() => void updateSetting('recordingConfiguration', structuredClone(DEFAULT_RECORDING_CONFIGURATION))}>{rtl ? 'إعادة ضبط التسجيل' : 'Reset recording options'}</NeonButton></div>
      </NeonPanel>
    </div>
  );
};
