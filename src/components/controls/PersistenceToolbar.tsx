import { useState, useCallback, useRef, useEffect } from 'react';
import { usePersistenceStore } from '@/store/persistenceStore';
import { formatStorageSize } from '@/utils/localStorage';

// ─── Toast Component ─────────────────────────────────────────────

interface ToastMessage {
  id: number;
  type: 'success' | 'error';
  message: string;
}

let toastId = 0;

function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={`rounded-lg px-4 py-2 text-sm shadow-lg transition-all ${
        toast.type === 'success'
          ? 'bg-green-800/90 text-green-100 border border-green-600'
          : 'bg-red-800/90 text-red-100 border border-red-600'
      }`}
      role="alert"
    >
      {toast.message}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────

export function PersistenceToolbar() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const savedTopologies = usePersistenceStore((s) => s.savedTopologies);
  const saveTopology = usePersistenceStore((s) => s.saveTopology);
  const loadSavedTopology = usePersistenceStore((s) => s.loadSavedTopology);
  const deleteSavedTopology = usePersistenceStore((s) => s.deleteSavedTopology);
  const exportJSON = usePersistenceStore((s) => s.exportJSON);
  const importJSON = usePersistenceStore((s) => s.importJSON);
  const getStorageUsage = usePersistenceStore((s) => s.getStorageUsage);

  const addToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ─── Export ─────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    exportJSON();
    addToast('success', 'Topology exported as JSON.');
  }, [exportJSON, addToast]);

  // ─── Import ─────────────────────────────────────────────────

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        await importJSON(file);
        addToast('success', 'Topology imported successfully.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown import error.';
        addToast('error', msg);
      }

      // Reset input so same file can be re-imported
      e.target.value = '';
    },
    [importJSON, addToast],
  );

  // ─── Save ───────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (!saveName.trim()) return;
    saveTopology(saveName.trim());
    addToast('success', `Saved "${saveName.trim()}".`);
    setSaveName('');
    setShowSaveDialog(false);
  }, [saveName, saveTopology, addToast]);

  // ─── Load ───────────────────────────────────────────────────

  const handleLoad = useCallback(
    (name: string) => {
      const confirmed = window.confirm(
        `Load "${name}"? This will replace your current topology.`,
      );
      if (!confirmed) return;
      loadSavedTopology(name);
      addToast('success', `Loaded "${name}".`);
      setShowLoadMenu(false);
    },
    [loadSavedTopology, addToast],
  );

  // ─── Delete ─────────────────────────────────────────────────

  const handleDelete = useCallback(
    (name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const confirmed = window.confirm(`Delete "${name}"? This cannot be undone.`);
      if (!confirmed) return;
      deleteSavedTopology(name);
      addToast('success', `Deleted "${name}".`);
    },
    [deleteSavedTopology, addToast],
  );

  // ─── Storage Usage ──────────────────────────────────────────

  const { bytes, warning } = getStorageUsage();
  const usageDisplay = formatStorageSize(bytes);

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Export */}
        <button
          onClick={handleExport}
          className="rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
          title="Export topology as JSON"
        >
          Export
        </button>

        {/* Import */}
        <button
          onClick={handleImportClick}
          className="rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
          title="Import topology from JSON"
        >
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleFileSelected}
        />

        {/* Save */}
        <div className="relative">
          <button
            onClick={() => setShowSaveDialog(!showSaveDialog)}
            className="rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
            title="Save topology"
          >
            Save
          </button>
          {showSaveDialog && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-gray-700 bg-gray-800 p-3 shadow-xl">
              <label className="block text-xs text-gray-400 mb-1">Topology name</label>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="My Topology"
                className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                autoFocus
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={!saveName.trim()}
                  className="flex-1 rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="rounded bg-gray-600 px-2 py-1 text-xs text-white hover:bg-gray-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Load */}
        <div className="relative">
          <button
            onClick={() => setShowLoadMenu(!showLoadMenu)}
            disabled={savedTopologies.length === 0}
            className="rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-40 transition-colors"
            title="Load saved topology"
          >
            Load
          </button>
          {showLoadMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-700 bg-gray-800 shadow-xl">
              <div className="px-3 py-2 border-b border-gray-700">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Saved Topologies
                </span>
              </div>
              <ul className="max-h-48 overflow-y-auto">
                {savedTopologies.map((entry) => (
                  <li
                    key={entry.name}
                    className="flex items-center justify-between px-3 py-2 hover:bg-gray-700/50"
                  >
                    <button
                      onClick={() => handleLoad(entry.name)}
                      className="flex-1 text-left"
                    >
                      <span className="block text-sm text-gray-200">{entry.name}</span>
                      <span className="block text-[10px] text-gray-500">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </button>
                    <button
                      onClick={(e) => handleDelete(entry.name, e)}
                      className="ml-2 rounded p-1 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300"
                      title={`Delete "${entry.name}"`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              {/* Storage indicator */}
              <div className="border-t border-gray-700 px-3 py-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-500">Storage used</span>
                  <span className={warning ? 'text-amber-400' : 'text-gray-400'}>
                    {usageDisplay} / 5 MB
                  </span>
                </div>
                <div className="mt-1 h-1 w-full rounded-full bg-gray-700">
                  <div
                    className={`h-1 rounded-full transition-all ${warning ? 'bg-amber-400' : 'bg-indigo-500'}`}
                    style={{ width: `${Math.min((bytes / (5 * 1024 * 1024)) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Storage usage inline indicator */}
        <span
          className={`ml-1 text-[10px] ${warning ? 'text-amber-400' : 'text-gray-500'}`}
          title={`localStorage: ${usageDisplay} / 5 MB`}
        >
          {usageDisplay}
        </span>
      </div>

      {/* Click outside handlers */}
      {(showLoadMenu || showSaveDialog) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setShowLoadMenu(false);
            setShowSaveDialog(false);
          }}
          aria-hidden="true"
        />
      )}

      {/* Toast container */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
          {toasts.map((toast) => (
            <Toast key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
          ))}
        </div>
      )}
    </>
  );
}
