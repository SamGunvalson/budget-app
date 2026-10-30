export function isAvailableCategory(category) {
  return category.is_active !== false && category.is_archived !== true;
}

export function categoryLabel(category) {
  return `${category.name}${category.is_archived ? ' (Archived)' : ''}`;
}

export function selectableCategories(categories, existingIds = []) {
  const retained = new Set(existingIds);
  return categories.filter((category) =>
    isAvailableCategory(category) || (
      category.is_active !== false && retained.has(category.id)
    ),
  );
}

export function resolveCategoryId(categories, selectedId) {
  if (categories.some((category) => category.id === selectedId)) return selectedId;
  return selectedId ? '' : categories[0]?.id || '';
}

export function budgetCategoryIds(monthData) {
  return new Set(
    Object.values(monthData).flatMap((data) => Object.keys(data.allocations ?? {})),
  );
}

export function categoriesForBudget(categories, monthData) {
  const savedIds = budgetCategoryIds(monthData);
  return categories.filter((category) => category.is_active !== false && category.type !== 'transfer' &&
    (isAvailableCategory(category) || savedIds.has(category.id)));
}
