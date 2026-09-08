import { blushTemplates } from './blushTemplates';
import { lipstickTemplates } from './lipstickTemplates';
import { lipShapeTemplates } from './lipShapeTemplates';
import type { RetouchMediaType, RetouchTemplate, TemplateCategory } from './TemplateTypes';

const ALL_TEMPLATES: readonly RetouchTemplate[] = Object.freeze([
  ...lipstickTemplates,
  ...blushTemplates,
  ...lipShapeTemplates,
]);

function matchesMedia(template: RetouchTemplate, mediaType: RetouchMediaType): boolean {
  return template.compatibleMedia.includes(mediaType);
}

/** Read-only central registry. UI components query this service instead of embedding preset data in JSX. */
export class TemplateRegistry {
  private readonly byId = new Map(ALL_TEMPLATES.map((template) => [template.id, template]));

  all(mediaType?: RetouchMediaType): RetouchTemplate[] {
    return ALL_TEMPLATES
      .filter((template) => !mediaType || matchesMedia(template, mediaType))
      .map((template) => ({ ...template, parameters: { ...template.parameters } }));
  }

  get(templateId: string): RetouchTemplate | null {
    const template = this.byId.get(templateId);
    return template ? { ...template, parameters: { ...template.parameters } } : null;
  }

  byCategory(category: TemplateCategory, mediaType?: RetouchMediaType): RetouchTemplate[] {
    return this.all(mediaType).filter((template) => template.category === category);
  }

  byRegion(targetRegion: string, mediaType?: RetouchMediaType): RetouchTemplate[] {
    return this.all(mediaType).filter((template) => template.targetRegion === targetRegion);
  }

  search(query: string, mediaType?: RetouchMediaType): RetouchTemplate[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return this.all(mediaType);
    return this.all(mediaType).filter((template) => [
      template.id,
      template.name,
      template.localizedName.en,
      template.localizedName.ar,
      template.category,
      template.targetRegion,
    ].some((value) => value.toLocaleLowerCase().includes(normalized)));
  }
}

export const retouchTemplateRegistry = new TemplateRegistry();
