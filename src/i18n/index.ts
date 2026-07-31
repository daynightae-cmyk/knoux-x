import { useCallback } from 'react';

import ar from '../locales/ar.json';
import {
  captureStudioArabic,
  captureStudioEnglish,
} from '../locales/captureStudio';
import en from '../locales/en.json';
import {
  imageEditorArabic,
  imageEditorEnglish,
} from '../locales/imageEditor';
import {
  diagnosticsArabic,
  diagnosticsEnglish,
  playerViewportArabic,
  playerViewportEnglish,
} from '../locales/playerDiagnostics';
import { useAppStore } from '../store/appStore';
import type { LocaleType } from '../store/appStore';

export const TRANSLATED_LOCALES = ['en', 'ar'] as const;
export const FUTURE_LOCALES = ['fr', 'es', 'de', 'it', 'pt', 'tr', 'ur', 'hi', 'ru', 'zh-CN', 'ja', 'ko'] as const;

const dictionaries: Record<LocaleType, unknown> = {
  en: {
    ...en,
    nav: {
      ...en.nav,
      imageEditor: 'Image Editor',
    },
    capture: {
      ...en.capture,
      ...captureStudioEnglish,
    },
    imageEditor: imageEditorEnglish,
    playerViewport: playerViewportEnglish,
    diagnostics: diagnosticsEnglish,
  },
  ar: {
    ...ar,
    nav: {
      ...ar.nav,
      imageEditor: 'محرر الصور',
    },
    capture: {
      ...ar.capture,
      ...captureStudioArabic,
    },
    imageEditor: imageEditorArabic,
    playerViewport: playerViewportArabic,
    diagnostics: diagnosticsArabic,
  },
};

function resolveKey(dictionary: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object' || !(segment in value)) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, dictionary);
}

function interpolate(value: string, variables?: Record<string, string | number>): string {
  if (!variables) return value;
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match
  ));
}

export function translate(
  locale: LocaleType,
  key: string,
  variables?: Record<string, string | number>,
): string {
  const localized = resolveKey(dictionaries[locale], key);
  const fallback = resolveKey(dictionaries.en, key);
  const value = typeof localized === 'string' ? localized : typeof fallback === 'string' ? fallback : key;
  return interpolate(value, variables);
}

export function useTranslation(): {
  locale: LocaleType;
  dir: 'ltr' | 'rtl';
  t(key: string, variables?: Record<string, string | number>): string;
} {
  const locale = useAppStore((state) => state.locale);
  const t = useCallback(
    (key: string, variables?: Record<string, string | number>) => translate(locale, key, variables),
    [locale],
  );
  return {
    locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    t,
  };
}

export function localeCoverage(): Record<LocaleType, { total: number; translated: number; percentage: number }> {
  const flatten = (value: unknown, prefix = '', output = new Map<string, string>()): Map<string, string> => {
    if (!value || typeof value !== 'object') return output;
    Object.entries(value).forEach(([key, entry]) => {
      const nextKey = prefix ? `${prefix}.${key}` : key;
      if (typeof entry === 'string') output.set(nextKey, entry);
      else flatten(entry, nextKey, output);
    });
    return output;
  };
  const english = flatten(dictionaries.en);
  const total = english.size;
  return TRANSLATED_LOCALES.reduce<Record<LocaleType, { total: number; translated: number; percentage: number }>>((result, locale) => {
    const target = flatten(dictionaries[locale]);
    const translated = [...english.keys()].filter((key) => target.has(key)).length;
    result[locale] = { total, translated, percentage: total === 0 ? 100 : Math.round((translated / total) * 100) };
    return result;
  }, {} as Record<LocaleType, { total: number; translated: number; percentage: number }>);
}
