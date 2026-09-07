import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
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

function MoreIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-4"
    >
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

// ─── Floating Menus ─────────────────────────────────────────────

interface LoadDropdownProps {
  open: boolean;
  entries: { name: string; timestamp: string }[];
  onLoad: (name: string) => void;
  onDelete: (name: string, e: React.MouseEvent) => void;
  usageDisplay: string;
  usageWarning: boolean;
  bytes: number;
}

function LoadDropdown({
  open,
  entries,
  onLoad,
  onDelete,
  usageDisplay,
  usageWarning,
  bytes,
}: LoadDropdownProps) {
  if (!open) return null;
  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-[#5b5347]/30 bg-[#5b5347]/80 shadow-xl max-md:left-0 max-md:right-auto">
      <div className="px-3 py-2 border-b border-[#5b5347]/30">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#f3ede2]/75">
          Saved Topologies
        </span>
      </div>
      <ul className="max-h-48 overflow-y-auto">
        {entries.map((entry) => (
          <li
            key={entry.name}
            className="flex items-center justify-between px-3 py-2 hover:bg-[#5b5347]/60/50"
          >
            <button onClick={() => onLoad(entry.name)} className="flex-1 text-left">
              <span className="block text-sm text-[#f3ede2]">{entry.name}</span>
              <span className="block text-[10px] text-[#f3ede2]/70">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
            </button>
            <button
              onClick={(e) => onDelete(entry.name, e)}
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
          <span className={usageWarning ? 'text-[#e8c473]' : 'text-[#f3ede2]/90'}>
            {usageDisplay} / 5 MB
          </span>
        </div>
        <div className="mt-1 h-1 w-full rounded-full bg-[#5b5347]/60">
          <div
            className={`h-1 rounded-full transition-all ${usageWarning ? 'bg-[#c49a3c]' : 'bg-[#b8402e]'}`}
            style={{ width: `${Math.min((bytes / (5 * 1024 * 1024)) * 100, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

interface SaveDialogProps {
  saveName: string;
  onNameChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function SaveDialog({ saveName, onNameChange, onSave, onCancel }: SaveDialogProps) {
  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-[#5b5347]/30 bg-[#5b5347]/80 p-3 shadow-xl max-md:left-0 max-md:right-auto">
      <label className="block text-xs text-[#f3ede2]/80 mb-1">Topology name</label>
      <input
        type="text"
        value={saveName}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSave()}
        placeholder="My Topology"
        className="w-full rounded border border-[#5b5347]/40 bg-[#5b5347] px-2 py-1 text-xs text-[#f3ede2] placeholder-[#f3ede2]/50 focus:border-[#b8402e] focus:outline-none"
        autoFocus
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={onSave}
          disabled={!saveName.trim()}
          className="flex-1 rounded bg-[#b8402e] px-2 py-1 text-xs text-[#f3ede2] hover:bg-[#b8402e] disabled:opacity-40"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded bg-[#5b5347]/50 px-2 py-1 text-xs text-[#f3ede2] hover:bg-[#5b5347]/80"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Hooks ───────────────────────────────────────────────────────

const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)';

function subscribeToViewport(callback: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mq = window.matchMedia(MOBILE_VIEWPORT_QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getMobileViewportSnapshot() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(MOBILE_VIEWPORT_QUERY).matches
  );
}

/** True when the viewport is a phone-sized screen (max-width 767px). */
function useIsMobile() {
  return useSyncExternalStore(subscribeToViewport, getMobileViewportSnapshot, () => false);
}

// ─── Component ───────────────────────────────────────────────────

export function PersistenceToolbar() {
  const isMobile = useIsMobile();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [mobileLoadOpen, setMobileLoadOpen] = useState(false);
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
      {!isMobile && (
      <div data-tour="persist" className="flex flex-wrap items-center gap-1.5 max-md:hidden">
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
            <SaveDialog
              saveName={saveName}
              onNameChange={setSaveName}
              onSave={handleSave}
              onCancel={() => setShowSaveDialog(false)}
            />
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
          <LoadDropdown
            open={showLoadMenu}
            entries={savedTopologies}
            onLoad={handleLoad}
            onDelete={handleDelete}
            usageDisplay={usageDisplay}
            usageWarning={warning}
            bytes={bytes}
          />
        </div>

        {/* Storage usage inline indicator */}
        <span
          className={`ml-1 text-[10px] max-md:hidden ${warning ? 'text-[#8a6418]' : 'text-[#5b5347]/70'}`}
          title={`localStorage: ${usageDisplay} / 5 MB`}
        >
          {usageDisplay}
        </span>
      </div>
      )}

      {/* ── Mobile: grouped tools menu + Load ─────────────────── */}
      {isMobile && (
      <div className="flex items-center gap-1.5 max-md:order-6">
        <div className="relative">
          <button
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            aria-label="More tools"
            aria-haspopup="menu"
            aria-expanded={showMobileMenu}
            className="grid size-7 place-items-center rounded-md border border-[#5b5347]/30 text-[#5b5347]/80 transition hover:border-[#b8402e]/50 hover:bg-[#b8402e]/10"
            title="Export, import, or save"
          >
            <MoreIcon />
          </button>
          {showMobileMenu && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-[#5b5347]/30 bg-[#5b5347]/80 p-1 shadow-xl"
              role="menu"
            >
              <button
                onClick={() => {
                  handleExport();
                  setShowMobileMenu(false);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-[#f3ede2] hover:bg-[#5b5347]/60"
              >
                Export
              </button>
              <button
                onClick={() => {
                  handleImportClick();
                  setShowMobileMenu(false);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-[#f3ede2] hover:bg-[#5b5347]/60"
              >
                Import
              </button>
              <button
                onClick={() => {
                  setShowMobileMenu(false);
                  setShowSaveDialog(true);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-xs text-[#f3ede2] hover:bg-[#5b5347]/60"
              >
                Save…
              </button>
              <div className="mt-1 border-t border-[#5b5347]/30 px-2 py-1.5 text-[10px] text-[#f3ede2]/70">
                Storage used: {usageDisplay}
              </div>
            </div>
          )}
          {showSaveDialog && (
            <SaveDialog
              saveName={saveName}
              onNameChange={setSaveName}
              onSave={handleSave}
              onCancel={() => setShowSaveDialog(false)}
            />
          )}
        </div>

        {/* Load */}
        <div className="relative">
          <button
            onClick={() => setMobileLoadOpen(!mobileLoadOpen)}
            disabled={savedTopologies.length === 0}
            className="rounded px-2 py-1 text-xs text-[#5b5347]/80 hover:bg-[#5b5347]/15 hover:text-[#5b5347] disabled:opacity-40 transition-colors"
            title="Load saved topology"
          >
            Load
          </button>
          <LoadDropdown
            open={mobileLoadOpen}
            entries={savedTopologies}
            onLoad={handleLoad}
            onDelete={handleDelete}
            usageDisplay={usageDisplay}
            usageWarning={warning}
            bytes={bytes}
          />
        </div>
      </div>
      )}

      {/* Click outside handlers */}
      {(showLoadMenu || showSaveDialog || showMobileMenu || mobileLoadOpen) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setShowLoadMenu(false);
            setShowSaveDialog(false);
            setShowMobileMenu(false);
            setMobileLoadOpen(false);
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
