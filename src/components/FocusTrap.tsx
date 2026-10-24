import React, { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface FocusTrapProps {
  children: React.ReactNode;
  active?: boolean;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export function FocusTrap({ children, active = true, returnFocusRef }: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    if (!active) return;
    previouslyFocused.current = document.activeElement;
    const container = containerRef.current;
    if (!container) return;
    const first = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)[0];
    const timer = setTimeout(() => first?.focus(), 10);
    return () => clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last || !container.contains(document.activeElement)) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const target = returnFocusRef?.current ?? (previouslyFocused.current as HTMLElement | null);
      if (target && typeof (target as HTMLElement).focus === 'function') {
        (target as HTMLElement).focus();
      }
    };
  }, [active, returnFocusRef]);

  return <div ref={containerRef}>{children}</div>;
}
