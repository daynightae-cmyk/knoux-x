import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Plus, RotateCcw, Trash2 } from 'lucide-react';

import {
  createStudioPreset,
  duplicateStudioPreset,
  renameStudioPreset,
  validateStudioPresets,
  type StudioPreset,
  type StudioPresetKind,
} from '../../core/settings/productCustomization';
import { NeonButton } from '../neon/NeonButton';
import { NeonSelect } from '../neon/NeonSelect';

interface Props {
  kind: StudioPresetKind;
  values: StudioPreset['values'];
  onApply(values: StudioPreset['values']): void;
}

export const StudioPresetBar: React.FC<Props> = ({ kind, values, onApply }) => {
  const [presets, setPresets] = useState<StudioPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.knouxAPI.settings.get('studioPresets', []),
      window.knouxAPI.settings.get('lastSelectedPresets', {}),
    ]).then(([stored, selected]) => {
      if (!active) return;
      setPresets(validateStudioPresets(stored));
      setSelectedId((selected as Record<string, string | null>)[kind] ?? null);
    });
    const unsubscribe = window.knouxAPI.settings.onChange((key, value) => {
      if (key === 'studioPresets') setPresets(validateStudioPresets(value));
      if (key === 'lastSelectedPresets') setSelectedId((value as Record<string, string | null>)[kind] ?? null);
    });
    return () => { active = false; unsubscribe(); };
  }, [kind]);

  const available = useMemo(() => presets.filter((preset) => preset.kind === kind), [kind, presets]);

  const selectPreset = async (id: string): Promise<void> => {
    const preset = available.find((entry) => entry.id === id);
    if (!preset) return;
    const selected = await window.knouxAPI.settings.get<Record<string, string | null>>('lastSelectedPresets', {});
    await window.knouxAPI.settings.set('lastSelectedPresets', { ...selected, [kind]: id });
    setSelectedId(id);
    onApply(structuredClone(preset.values));
  };

  const create = async (): Promise<void> => {
    const name = window.prompt('Preset name')?.trim();
    if (!name) return;
    const preset = createStudioPreset(kind, name, values);
    await window.knouxAPI.settings.set('studioPresets', [...presets, preset]);
    const selected = await window.knouxAPI.settings.get<Record<string, string | null>>('lastSelectedPresets', {});
    await window.knouxAPI.settings.set('lastSelectedPresets', { ...selected, [kind]: preset.id });
    setSelectedId(preset.id);
    onApply(structuredClone(preset.values));
  };

  const duplicate = async (): Promise<void> => {
    const selected = available.find((preset) => preset.id === selectedId);
    if (!selected) return;
    const copy = duplicateStudioPreset(selected, `${selected.name} Copy`);
    await window.knouxAPI.settings.set('studioPresets', [...presets, copy]);
  };

  const rename = async (): Promise<void> => {
    const selected = available.find((preset) => preset.id === selectedId);
    if (!selected) return;
    const name = window.prompt('New preset name', selected.name)?.trim();
    if (!name) return;
    await window.knouxAPI.settings.set('studioPresets', presets.map((preset) => preset.id === selected.id ? renameStudioPreset(preset, name) : preset));
  };

  const remove = async (): Promise<void> => {
    if (!selectedId) return;
    await window.knouxAPI.settings.set('studioPresets', presets.filter((preset) => preset.id !== selectedId));
    setSelectedId(null);
  };

  return (
    <div className="studio-preset-bar">
      <strong>Preset</strong>
      <NeonSelect value={selectedId ?? ''} onChange={(value) => void selectPreset(value)} options={[{ value: '', label: 'Custom' }, ...available.map((preset) => ({ value: preset.id, label: preset.name }))]} />
      <NeonButton variant="ghost" size="sm" leftIcon={<Plus size={13} />} onClick={() => void create()}>Save</NeonButton>
      <NeonButton variant="ghost" size="sm" leftIcon={<Copy size={13} />} disabled={!selectedId} onClick={() => void duplicate()}>Duplicate</NeonButton>
      <NeonButton variant="ghost" size="sm" leftIcon={<RotateCcw size={13} />} disabled={!selectedId} onClick={() => void rename()}>Rename</NeonButton>
      <NeonButton variant="ghost" size="sm" leftIcon={<Trash2 size={13} />} disabled={!selectedId} onClick={() => void remove()}>Delete</NeonButton>
    </div>
  );
};
