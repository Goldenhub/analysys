import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpModal, HelpIcon } from './HelpModal';

describe('HelpModal', () => {
  it('renders nothing when closed', () => {
    render(<HelpModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a centered dialog with the full guide', () => {
    render(<HelpModal isOpen onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'How to use Analysys' });
    expect(dialog).toBeDefined();
    expect(screen.getByText('Build your architecture', { exact: false })).toBeDefined();
    expect(screen.getByText('Run a simulation', { exact: false })).toBeDefined();
    expect(screen.getByText('Test resilience with chaos', { exact: false })).toBeDefined();
    expect(screen.getByText('Analyse a run', { exact: false })).toBeDefined();
    expect(screen.getByText('Save and export', { exact: false })).toBeDefined();
    expect(
      screen.getByText(/same topology \+ settings \+ seed replays identical behaviour/i),
    ).toBeDefined();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<HelpModal isOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on the scrim backdrop and the close button', () => {
    const onClose = vi.fn();
    render(<HelpModal isOpen onClose={onClose} />);
    // Scrim is aria-hidden, so target it via the dialog container.
    fireEvent.click(screen.getByRole('dialog').parentElement!.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close help' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('returns focus to the opener when closed', () => {
    const container = render(
      <div>
        <button data-testid="opener">Open help</button>
        <HelpModal isOpen onClose={() => {}} />
      </div>,
    );
    const opener = container.getByTestId('opener');
    opener.focus();
    expect(document.activeElement).toBe(opener);
    container.rerender(
      <div>
        <button data-testid="opener">Open help</button>
        <HelpModal isOpen={false} onClose={() => {}} />
      </div>,
    );
    expect(document.activeElement).toBe(opener);
  });
});

describe('HelpIcon', () => {
  it('is a labelled button target for accessibility', () => {
    render(
      <button aria-label="How to use Analysys">
        <HelpIcon />
      </button>,
    );
    expect(screen.getByRole('button', { name: 'How to use Analysys' })).toBeDefined();
  });
});