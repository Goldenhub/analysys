import { useState, useCallback, useRef, useEffect } from 'react';
import { usePersistenceStore } from '@/store/persistenceStore';
import { formatStorageSize } from '@/utils/localStorage';

// ─── Toast Component ─────────────────────────────────────────────

interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'warning';
  message: string;
}

let toastId = 0;

const TOAST_CLASSES: Record<ToastMessage['type'], string> = {
  success: 'bg-[#6b8f71]/20/90 text-[#6b8f71]/80 border border-[#6b8f71]',
  error: 'bg-[#8b2e1e]/20/90 text-[#8b2e1e]/70 border border-[#8b2e1e]',
  warning: 'bg-[#c49a3c]/20/90 text-[#c49a3c]/70 border border-[#c49a3c]',
};

function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.type === 'warning' ? 6000 : 4000);
    return () => clearTimeout(timer);
  }, [onDismiss, toast.type]);

  return (
    <div
      className={`rounded-lg px-4 py-2 text-sm shadow-lg transition-all ${TOAST_CLASSES[toast.type]}`}
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

  const addToast = useCallback((type: 'success' | 'error' | 'warning', message: string) => {
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
        const warnings = await importJSON(file);
        addToast('success', 'Topology imported successfully.');
        // Surface migration warnings (R34.4, R34.8)
        if (warnings && warnings.length > 0) {
          const count = warnings.length;
          const summary =
            count <= 3
              ? warnings
                  .map((w) => `${w.label}: ${w.field} → ${JSON.stringify(w.appliedValue)}`)
                  .join('; ')
              : `${warnings
                  .slice(0, 3)
                  .map((w) => `${w.label}: ${w.field} → ${JSON.stringify(w.appliedValue)}`)
                  .join('; ')} (+${count - 3} more)`;
          addToast('warning', `Migration applied ${count} default(s): ${summary}`);
        }
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
    const { warnings } = saveTopology(saveName.trim());
    addToast('success', `Saved "${saveName.trim()}".`);
    // R34.7 — surface storage size warning
    if (warnings.length > 0) {
      for (const w of warnings) {
        addToast('warning', w);
      }
    }
    setSaveName('');
    setShowSaveDialog(false);
  }, [saveName, saveTopology, addToast]);

  // ─── Load ───────────────────────────────────────────────────

  const handleLoad = useCallback(
    (name: string) => {
      const confirmed = window.confirm(`Load "${name}"? This will replace your current topology.`);
      if (!confirmed) return;
      const warnings = loadSavedTopology(name);
      addToast('success', `Loaded "${name}".`);
      // Surface migration warnings on load (R34.4, R34.8)
      if (warnings && warnings.length > 0) {
        const count = warnings.length;
        addToast('warning', `Migration applied ${count} default(s) to "${name}".`);
      }
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
      <div data-tour="persist" className="flex items-center gap-1.5">
        {/* Export */}
        <button
          onClick={handleExport}
          className="rounded px-2 py-1 text-xs text-[#5b5347]/80 hover:bg-[#5b5347]/15 hover:text-[#5b5347] transition-colors"
          title="Export topology as JSON"
        >
          Export
        </button>

        {/* Import */}
        <button
          onClick={handleImportClick}
          className="rounded px-2 py-1 text-xs text-[#5b5347]/80 hover:bg-[#5b5347]/15 hover:text-[#5b5347] transition-colors"
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
            className="rounded px-2 py-1 text-xs text-[#5b5347]/80 hover:bg-[#5b5347]/15 hover:text-[#5b5347] transition-colors"
            title="Save topology"
          >
            Save
          </button>
          {showSaveDialog && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-[#5b5347]/30 bg-[#5b5347]/80 p-3 shadow-xl">
              <label className="block text-xs text-[#f3ede2]/80 mb-1">Topology name</label>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="My Topology"
                className="w-full rounded border border-[#5b5347]/40 bg-[#5b5347] px-2 py-1 text-xs text-[#f3ede2] placeholder-[#f3ede2]/50 focus:border-[#b8402e] focus:outline-none"
                autoFocus
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={!saveName.trim()}
                  className="flex-1 rounded bg-[#b8402e] px-2 py-1 text-xs text-[#f3ede2] hover:bg-[#b8402e] disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowSaveDialog(false)}
                  className="rounded bg-[#5b5347]/50 px-2 py-1 text-xs text-[#f3ede2] hover:bg-[#5b5347]/80"
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
            className="rounded px-2 py-1 text-xs text-[#5b5347]/80 hover:bg-[#5b5347]/15 hover:text-[#5b5347] disabled:opacity-40 transition-colors"
            title="Load saved topology"
          >
            Load
          </button>
          {showLoadMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-[#5b5347]/30 bg-[#5b5347]/80 shadow-xl">
              <div className="px-3 py-2 border-b border-[#5b5347]/30">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#f3ede2]/75">
                  Saved Topologies
                </span>
              </div>
              <ul className="max-h-48 overflow-y-auto">
                {savedTopologies.map((entry) => (
                  <li
                    key={entry.name}
                    className="flex items-center justify-between px-3 py-2 hover:bg-[#5b5347]/60/50"
                  >
                    <button onClick={() => handleLoad(entry.name)} className="flex-1 text-left">
                      <span className="block text-sm text-[#f3ede2]">{entry.name}</span>
                      <span className="block text-[10px] text-[#f3ede2]/70">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </button>
                    <button
                      onClick={(e) => handleDelete(entry.name, e)}
                      className="ml-2 rounded p-1 text-xs text-[#f3ede2] hover:bg-[#8b2e1e]/40 hover:text-[#f3ede2]"
                      title={`Delete "${entry.name}"`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              {/* Storage indicator */}
              <div className="border-t border-[#5b5347]/30 px-3 py-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-[#f3ede2]/75">Storage used</span>
                  <span className={warning ? 'text-[#e8c473]' : 'text-[#f3ede2]/90'}>
                    {usageDisplay} / 5 MB
                  </span>
                </div>
                <div className="mt-1 h-1 w-full rounded-full bg-[#5b5347]/60">
                  <div
                    className={`h-1 rounded-full transition-all ${warning ? 'bg-[#c49a3c]' : 'bg-[#b8402e]'}`}
                    style={{ width: `${Math.min((bytes / (5 * 1024 * 1024)) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Storage usage inline indicator */}
        <span
          className={`ml-1 text-[10px] ${warning ? 'text-[#8a6418]' : 'text-[#5b5347]/70'}`}
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
