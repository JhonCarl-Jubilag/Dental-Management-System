// Keep this whitespace/case rule aligned with normalized_inventory_item_name in SQL.
export const normalizeInventoryName = value => String(value ?? '').replace(/\u00a0/g, ' ')
  .replace(/[ \t\r\n\f\v]+/g, ' ').trim().toLowerCase();
export const cleanInventoryName = value => String(value ?? '').replace(/\u00a0/g, ' ')
  .replace(/[ \t\r\n\f\v]+/g, ' ').trim();
export const INVENTORY_DUPLICATE_MESSAGE = 'This inventory item already exists. Update its stock quantity instead of adding a duplicate. If it is inactive, review and reactivate the existing item.';

// Similarity is advisory. Shared product words detect size/concentration variants;
// trigram similarity also catches small spelling differences, without merging items.
const tokens = name => normalizeInventoryName(name).match(/[\p{L}\p{N}]+/gu) || [];
const grams = name => {
  const text = normalizeInventoryName(name).replace(/[^\p{L}\p{N}]/gu, '');
  return new Set(Array.from({ length: Math.max(0, text.length - 2) }, (_, i) => text.slice(i, i + 3)));
};
const oneEditApart = (left, right) => {
  if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) i++;
    if (right.length >= left.length) j++;
  }
  return edits + (left.length - i) + (right.length - j) <= 1;
};
export const inventoryNamesSimilar = (left, right) => {
  const a = tokens(left), b = tokens(right);
  if (a.some(word => word.length >= 4 && !/^\d+$/.test(word) && b.includes(word))) return true;
  if (oneEditApart(normalizeInventoryName(left), normalizeInventoryName(right))) return true;
  const x = grams(left), y = grams(right);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter(gram => y.has(gram)).length;
  return 2 * shared / (x.size + y.size) >= 0.65;
};

export const reviewInventoryName = async (client, name, excludeId = null) => {
  const key = normalizeInventoryName(name);
  if (!key || cleanInventoryName(name).length > 200) throw new Error('Enter an item name of 1 to 200 characters.');
  const items = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await client.from('inventory')
      .select('item_id, item_name, category, unit_type, status').order('item_id').range(from, from + 499);
    if (error) throw new Error('Could not check existing inventory items. Please retry before saving.');
    items.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  const others = items.filter(item => String(item.item_id) !== String(excludeId));
  const exact = others.filter(item => normalizeInventoryName(item.item_name) === key);
  const matches = exact.length ? exact : others.filter(item => inventoryNamesSimilar(name, item.item_name));
  return { key, exact: exact.length > 0, matches,
    signature: JSON.stringify(matches.map(item => [item.item_id, item.item_name, item.unit_type, item.status])) };
};
