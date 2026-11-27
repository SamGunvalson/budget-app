import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import CategoryForm from '../components/budgets/CategoryForm';
import CategoryList from '../components/budgets/CategoryList';
import CategoryColorsModal from '../components/budgets/CategoryColorsModal';
import Button from '../components/common/Button';
import TopBar from '../components/common/TopBar';
import PageHeader from '../components/common/PageHeader';
import Modal from '../components/common/Modal';
import {
  createCategoryOffline as createCategory,
  deleteCategoryOffline as deleteCategory,
  updateCategoryOffline as updateCategory,
  archiveCategoryOffline,
  restoreCategoryOffline,
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
  const [showArchived, setShowArchived] = useState(false);
  const [archivingCategory, setArchivingCategory] = useState(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [showColors, setShowColors] = useState(false);

  const handleArchiveChange = async (category) => {
    setArchiveBusy(true);
    setMutationError('');
    try {
      if (category.is_archived) await restoreCategoryOffline(category.id);
      else await archiveCategoryOffline(category.id);
      setArchivingCategory(null);
    } catch (err) {
      setMutationError(err?.message || 'Failed to change category archive status.');
    } finally {
      setArchiveBusy(false);
    }
  };

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

  // Sequential so offline edits enqueue in order.
  const handleRecolor = async (updates) => {
    for (const { id, color } of updates) {
      await updateCategory(id, { color });
    }
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
    <div className="min-h-screen app-bg">
      <TopBar pageName="Categories" />

      {/* Main content */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Page header */}
        <PageHeader eyebrow="Budget setup" title="Categories" description="Archive unused categories without losing their history.">
          <Button
            onClick={() => setShowColors(true)}
            disabled={isLoading || categories.length === 0}
            className="flex-shrink-0"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
            </svg>
            Colors
          </Button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-stone-950 shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Category
          </button>
        </PageHeader>

        <label className="mb-6 flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived ({categories.filter((c) => c.is_archived).length})
        </label>

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
            categories={categories.filter((c) => showArchived || !c.is_archived)}
            onEdit={setEditingCategory}
            onDelete={setDeletingCategory}
            deletingId={deletingId}
            onArchive={(category) => { setMutationError(''); setArchivingCategory(category); }}
            archiveBusy={archiveBusy}
          />
        )}
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <Modal title="New Category" onClose={() => setShowCreateModal(false)}>
          <CategoryForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreateModal(false)}
            categories={categories}
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
            categories={categories}
          />
        </Modal>
      )}

      {/* Confirm delete */}
      {archivingCategory && (
        <Modal title={archivingCategory.is_archived ? 'Restore Category' : 'Archive Category'} onClose={() => { if (!archiveBusy) setArchivingCategory(null); }}>
          <p className="mb-4 text-sm text-stone-700 dark:text-stone-300">
            {archivingCategory.is_archived
              ? `Restore "${archivingCategory.name}" to new-entry lists? This will not resume any schedules.`
              : `Archive "${archivingCategory.name}"? It will be hidden from new-entry lists. Historical transactions and budgets will remain unchanged. Archiving requires a connection.`}
          </p>
          <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
            First change or pause any <Link className="text-amber-600 underline dark:text-amber-400" to="/app/transactions">recurring schedules</Link> and change or remove <Link className="text-amber-600 underline dark:text-amber-400" to="/app/settings">quick-entry templates</Link> using this category.
          </p>
          {mutationError && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{mutationError}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" disabled={archiveBusy} onClick={() => setArchivingCategory(null)} className="rounded-xl border border-stone-200/60 px-4 py-2 text-stone-600 dark:border-stone-700/60 dark:text-stone-300">Cancel</button>
            <button type="button" disabled={archiveBusy} onClick={() => handleArchiveChange(archivingCategory)} className="rounded-xl bg-amber-500 px-4 py-2 font-semibold text-stone-950 disabled:opacity-50">
              {archiveBusy ? 'Saving…' : archivingCategory.is_archived ? 'Restore' : 'Archive'}
            </button>
          </div>
        </Modal>
      )}
      {showColors && (
        <CategoryColorsModal
          categories={categories.filter((c) => !c.is_archived)}
          onRecolor={handleRecolor}
          onClose={() => setShowColors(false)}
        />
      )}
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
