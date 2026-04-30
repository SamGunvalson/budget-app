import { useEffect, useState } from 'react';
import CategoryForm from '../components/budgets/CategoryForm';
import CategoryList from '../components/budgets/CategoryList';
import TopBar from '../components/common/TopBar';
import Modal from '../components/common/Modal';
import {
  createCategoryOffline as createCategory,
  deleteCategoryOffline as deleteCategory,
  updateCategoryOffline as updateCategory,
} from '../services/offlineAware';
import { useCategories } from '../hooks/queries';

// Confirm delete dialog
function ConfirmDeleteModal({ category, onConfirm, onCancel, isDeleting }) {
  return (
    <Modal title="Delete Category" onClose={onCancel}>
      <p className="mb-2 text-base text-stone-700 dark:text-stone-300">
        Are you sure you want to delete{' '}
        <span className="font-semibold text-stone-900 dark:text-stone-100">{category.name}</span>?
      </p>
      <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
        This category will be hidden and can no longer be used in new transactions.
        Existing transactions with this category are unaffected.
      </p>
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isDeleting}
          className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-red-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDeleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Modal>
  );
}

function CategoriesPage() {
  const {
    data: categories = [],
    isLoading,
    error: loadErrorObj,
  } = useCategories();
  const loadError = loadErrorObj?.message || '';

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [deletingCategory, setDeletingCategory] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [mutationError, setMutationError] = useState('');

  useEffect(() => { document.title = 'Budget App | Categories'; }, []);

  // CRUD handlers — react-query auto-refreshes via the bridge after each
  // mutation calls notifyTable inside the offlineAware wrapper.
  const handleCreate = async (values) => {
    await createCategory(values);
    setShowCreateModal(false);
  };

  const handleUpdate = async (values) => {
    await updateCategory(editingCategory.id, values);
    setEditingCategory(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingCategory) return;
    setDeletingId(deletingCategory.id);
    try {
      await deleteCategory(deletingCategory.id);
      setDeletingCategory(null);
    } catch (err) {
      setMutationError(err?.message || 'Failed to delete category.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <TopBar pageName="Categories" />

      {/* Main content */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Page header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Categories
            </h1>
            <p className="mt-2 text-base text-stone-500 dark:text-stone-400">
              Organise your spending into needs, wants, and savings categories.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Category
          </button>
        </div>

        {/* Error banner */}
        {(loadError || mutationError) && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
            <span className="mr-1.5">⚠</span>{mutationError || loadError}
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl bg-stone-200/60 dark:bg-stone-700/60"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : (
          <CategoryList
            categories={categories}
            onEdit={setEditingCategory}
            onDelete={setDeletingCategory}
            deletingId={deletingId}
          />
        )}
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <Modal title="New Category" onClose={() => setShowCreateModal(false)}>
          <CategoryForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreateModal(false)}
          />
        </Modal>
      )}

      {/* Edit modal */}
      {editingCategory && (
        <Modal title="Edit Category" onClose={() => setEditingCategory(null)}>
          <CategoryForm
            initialValues={editingCategory}
            onSubmit={handleUpdate}
            onCancel={() => setEditingCategory(null)}
            isEditing
          />
        </Modal>
      )}

      {/* Confirm delete */}
      {deletingCategory && (
        <ConfirmDeleteModal
          category={deletingCategory}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingCategory(null)}
          isDeleting={!!deletingId}
        />
      )}
    </div>
  );
}

export default CategoriesPage;
