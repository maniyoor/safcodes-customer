// Customer-visible plan features only. Migration provenance stays in the database/admin.
// Keep this file identical to api/lib/public-specifications.mjs.
const keyName = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const internalKey = key => {
  const name = keyName(key);
  return !name || String(key).startsWith('_') ||
    /^(legacy|migration|migrated|import|imported|source|internal|audit|metadata|raw)(_|$)/.test(name) ||
    /(^|_)(id|ids|uuid|table|schema|password|secret|token|credential|credentials)(_|$)/.test(name) ||
    /(^|_)(price|pricing|cost|amount|tax|vat)(_|$)/.test(name) ||
    ['constructor', 'prototype', 'specifications_status', 'created_at', 'updated_at'].includes(name);
};
const displayKey = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());

function featureText(value, depth = 0) {
  if (value == null || depth > 5) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') {
    const text = value.trim();
    // Older catalogues can contain serialized arrays/objects. Never show raw JSON.
    if (/^[\[{]/.test(text)) {
      try { return featureText(JSON.parse(text), depth + 1); } catch { return ''; }
    }
    return text;
  }
  if (Array.isArray(value)) {
    return [...new Set(value.slice(0, 100).map(entry => featureText(entry, depth + 1)).filter(Boolean))].join(', ');
  }
  if (typeof value !== 'object') return '';
  return Object.entries(value).slice(0, 100).filter(([key]) => !internalKey(key))
    .map(([key, entry]) => {
      const text = featureText(entry, depth + 1);
      return text ? displayKey(key) + ': ' + text : '';
    }).filter(Boolean).join(' · ');
}

export function specificationEntries(value) {
  // A specification must be a named feature map, not an unlabelled record array.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).slice(0, 100).filter(([key]) => !internalKey(key))
    .map(([key, entry]) => [key, featureText(entry)]).filter(([, text]) => text !== '');
}

export const publicSpecifications = value => Object.fromEntries(specificationEntries(value));
