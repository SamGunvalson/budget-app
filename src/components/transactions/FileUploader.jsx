import { useRef, useState } from 'react';

/**
 * FileUploader — drag-and-drop / click-to-browse file input for CSV/Excel.
 *
 * Props:
 *  - onFileSelected(file: File): called when a valid file is chosen
 *  - isLoading: boolean (disable while parsing)
 */
export default function FileUploader({ onFileSelected, isLoading = false }) {
  const fileRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  const ACCEPTED_TYPES = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  const ACCEPTED_EXT = ['.csv', '.xls', '.xlsx'];

  function isValidFile(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    return ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXT.includes(ext);
  }

  function handleFile(file) {
    setError('');
    if (!file) return;
    if (!isValidFile(file)) {
      setError('Please upload a CSV or Excel file (.csv, .xls, .xlsx).');
      setFileName('');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File is too large. Maximum size is 10 MB.');
      setFileName('');
      return;
    }
    setFileName(file.name);
    onFileSelected(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    handleFile(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleInputChange(e) {
    const file = e.target.files?.[0];
    handleFile(file);
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !isLoading && fileRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
          isDragOver
            ? 'border-amber-400 bg-amber-50/50 dark:border-amber-600 dark:bg-amber-900/30'
            : 'border-stone-300 bg-stone-50/30 hover:border-amber-300 hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-700/30 dark:hover:border-amber-600 dark:hover:bg-stone-700'
        } ${isLoading ? 'pointer-events-none opacity-50' : ''}`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xls,.xlsx"
          onChange={handleInputChange}
          className="hidden"
          disabled={isLoading}
        />

        {/* Upload icon */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900">
          <svg className="h-7 w-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
        </div>

        {fileName ? (
          <div>
            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">{fileName}</p>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Click or drag to replace</p>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-stone-700 dark:text-stone-300">
              <span className="text-amber-600 font-semibold">Click to upload</span> or drag and drop
            </p>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">CSV, XLS, or XLSX — max 10 MB
            </p>
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/70 dark:bg-stone-800/70">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          <span className="mr-1.5">⚠</span>{error}
        </div>
      )}
    </div>
  );
}
