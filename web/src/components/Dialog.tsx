import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

interface Props {
  title: string;
  description?: string;
  onClose: () => void;
  children: ComponentChildren;
  testId?: string;
}

/**
 * A modal built on the native <dialog> element.
 *
 * `showModal()` gives us the focus trap, the inert background, Escape-to-close
 * and the ::backdrop pseudo-element for free — all of which would otherwise be
 * a few hundred lines of a11y plumbing to get right by hand.
 */
export function Dialog({ title, description, onClose, children, testId }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    // Escape closes the dialog natively; mirror that back into our own state.
    return () => {
      if (el?.open) el.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      class="dialog"
      data-testid={testId}
      onClose={onClose}
      onCancel={onClose}
      // The backdrop is painted by the <dialog> itself, so a click that lands
      // on the element (rather than on the inner card) is a backdrop click.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div class="dialog-card">
        <div class="dialog-head">
          <h2 class="dialog-title">{title}</h2>
          <button
            type="button"
            class="icon-btn"
            aria-label="Close"
            data-testid={testId ? `${testId}-close` : undefined}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {description && <p class="subtle dialog-desc">{description}</p>}
        {children}
      </div>
    </dialog>
  );
}
