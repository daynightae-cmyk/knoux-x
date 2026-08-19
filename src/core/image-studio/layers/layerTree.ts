import {
  IMAGE_STUDIO_LIMITS,
  type GroupLayer,
  type ImageLayer,
  type ImageStudioDocument,
} from '../document/schema';
import { createGroupLayer } from '../document/document';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export interface LayerTreeNode {
  layer: ImageLayer;
  children: LayerTreeNode[];
}

/** Validate that the layer list forms a well-formed tree: unique ids,
 *  valid parent references, no cycles, no orphaned non-group children. */
export function validateLayerTree(layers: ImageLayer[]): void {
  const ids = new Set<string>();
  for (const layer of layers) {
    if (ids.has(layer.id)) throw new Error('Duplicate layer ID.');
    ids.add(layer.id);
    if (layer.parentId !== null && !layers.some((entry) => entry.id === layer.parentId))
      throw new Error(`Layer parent reference is invalid: ${layer.parentId}`);
  }
  const groupIds = new Set(
    layers.filter((layer) => layer.kind === 'group').map((layer) => layer.id)
  );
  for (const layer of layers) {
    if (layer.parentId === null) continue;
    if (!groupIds.has(layer.parentId))
      throw new Error(`Layer "${layer.id}" is not nested under a group.`);
  }
}

/** Children of a layer in document (array) order. */
export function childrenOf(layers: ImageLayer[], layerId: string): ImageLayer[] {
  return layers.filter((layer) => layer.parentId === layerId);
}

export function isDescendant(layers: ImageLayer[], candidateId: string, ancestorId: string): boolean {
  if (candidateId === ancestorId) return true;
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  let current = byId.get(candidateId);
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    if (current.parentId === null) return false;
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

/** Top-down paint order: parents before children, in array order. */
export function flattenPaintOrder(layers: ImageLayer[]): ImageLayer[] {
  const roots = layers.filter((layer) => layer.parentId === null);
  const ordered: ImageLayer[] = [];
  const visit = (layer: ImageLayer): void => {
    ordered.push(layer);
    const children = layers
      .filter((entry) => entry.parentId === layer.id)
      .sort((a, b) => layers.indexOf(a) - layers.indexOf(b));
    for (const child of children) visit(child);
  };
  for (const root of roots) visit(root);
  const seen = new Set(ordered.map((layer) => layer.id));
  for (const layer of layers) if (!seen.has(layer.id)) ordered.push(layer);
  return ordered;
}

export function reorderLayer(
  layers: ImageLayer[],
  layerId: string,
  destinationIndex: number
): ImageLayer[] {
  const next = clone(layers);
  const index = next.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new Error('Layer does not exist.');
  const layer = next[index];
  const siblingRanks = next
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.parentId === layer.parentId)
    .map(({ i }) => i);
  const removedRank = siblingRanks.indexOf(index);
  const target = Math.max(0, Math.min(siblingRanks.length - 1, Math.round(destinationIndex)));
  if (target === removedRank) return next;
  next.splice(index, 1);
  const siblingPositions = next
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.parentId === layer.parentId)
    .map(({ i }) => i);
  const insertIndex =
    target < removedRank ? siblingPositions[target] : siblingPositions[target - 1] + 1;
  next.splice(insertIndex, 0, layer);
  return next;
}

export function duplicateLayer(
  layers: ImageLayer[],
  layerId: string,
  duplicateId: string
): ImageLayer[] {
  const source = layers.find((layer) => layer.id === layerId);
  if (!source) throw new Error('Layer does not exist.');
  if (layers.some((layer) => layer.id === duplicateId))
    throw new Error('Duplicate layer ID already exists.');
  const duplicates: ImageLayer[] = [];
  const cloneSubtree = (layer: ImageLayer, newId: string, newParentId: string | null): void => {
    const duplicated = { ...clone(layer), id: newId, parentId: newParentId } as ImageLayer;
    duplicates.push(duplicated);
    const children = layers.filter((entry) => entry.parentId === layer.id);
    children.forEach((child, index) => {
      cloneSubtree(child, `${duplicateId}-child-${index}-${child.id}`, newId);
    });
  };
  cloneSubtree(source, duplicateId, source.parentId);
  const index = layers.indexOf(source);
  return [...clone(layers.slice(0, index + 1)), ...duplicates, ...clone(layers.slice(index + 1))];
}

export function groupLayers(
  layers: ImageLayer[],
  memberIds: string[],
  groupId: string
): ImageLayer[] {
  if (memberIds.length === 0) throw new RangeError('Group requires at least one layer.');
  if (memberIds.length === 1)
    throw new RangeError('Group requires at least two layers.');
  const ids = new Set(memberIds);
  for (const id of memberIds) {
    if (!layers.some((layer) => layer.id === id)) throw new Error(`Layer "${id}" does not exist.`);
  }
  const first = layers.find((layer) => layer.id === memberIds[0]);
  const parents = new Set(memberIds.map((id) => layers.find((layer) => layer.id === id)?.parentId));
  if (parents.size !== 1 || !first) throw new Error('Grouped layers must share a parent.');
  const parentId = first.parentId;
  const newGroup: GroupLayer = createGroupLayer({ id: groupId, name: 'Group', parentId });
  const result: ImageLayer[] = [];
  let inserted = false;
  for (const layer of layers) {
    if (!ids.has(layer.id)) {
      if (layer.id === newGroup.id) throw new Error('Group ID conflicts with an existing layer.');
      result.push(clone(layer));
      continue;
    }
    if (!inserted) {
      result.push(clone(newGroup));
      inserted = true;
    }
    result.push({ ...clone(layer), parentId: groupId });
  }
  if (!inserted) result.push(clone(newGroup));
  return result;
}

export function ungroup(layers: ImageLayer[], groupId: string): ImageLayer[] {
  const group = layers.find((layer) => layer.id === groupId);
  if (!group) throw new Error('Group does not exist.');
  if (group.kind !== 'group') throw new TypeError('Layer is not a group.');
  const parentId = group.parentId;
  const result: ImageLayer[] = [];
  let groupSeen = false;
  for (const layer of layers) {
    if (layer.id === groupId) {
      groupSeen = true;
      continue;
    }
    if (layer.parentId === groupId) {
      result.push({ ...clone(layer), parentId });
      continue;
    }
    if (!groupSeen && layer.parentId === null) {
      result.push(clone(layer));
      continue;
    }
    result.push(clone(layer));
  }
  return result;
}

export function removeLayer(layers: ImageLayer[], layerId: string): ImageLayer[] {
  if (!layers.some((layer) => layer.id === layerId)) throw new Error('Layer does not exist.');
  const removeSet = new Set<string>();
  const collect = (id: string): void => {
    if (removeSet.has(id)) return;
    removeSet.add(id);
    for (const layer of layers) {
      if (layer.parentId === id) collect(layer.id);
    }
  };
  collect(layerId);
  return clone(layers.filter((layer) => !removeSet.has(layer.id)));
}

export function visiblePaintLayers(
  document: Pick<ImageStudioDocument, 'layers'>,
  includeHidden: boolean
): ImageLayer[] {
  const ordered = flattenPaintOrder(document.layers);
  if (includeHidden) return ordered;
  const hiddenAncestors = new Set<string>();
  const result: ImageLayer[] = [];
  for (const layer of ordered) {
    if (layer.parentId !== null && hiddenAncestors.has(layer.parentId)) {
      if (!layer.visible) hiddenAncestors.add(layer.id);
      continue;
    }
    if (!layer.visible) {
      hiddenAncestors.add(layer.id);
      continue;
    }
    result.push(layer);
  }
  return result;
}

export function layerCountWithinLimit(count: number): boolean {
  return count >= 0 && count <= IMAGE_STUDIO_LIMITS.layerCountMax;
}

export function topLevelLayerCount(layers: ImageLayer[]): number {
  return layers.filter((layer) => layer.parentId === null).length;
}
