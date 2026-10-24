import React from 'react';

interface Props {
  title: string;
  description?: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export function EmptyState({ title, description, ctaLabel, onCta }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3rem 1.5rem',
        textAlign: 'center',
        color: 'var(--text-muted)',
      }}
      role="status"
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        style={{ marginBottom: '1rem', opacity: 0.45 }}
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 9h6M9 13h4" />
      </svg>
      <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem', color: 'var(--text-secondary)' }}>
        {title}
      </p>
      {description && (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.84rem' }}>{description}</p>
      )}
      {ctaLabel && onCta && (
        <button
          type="button"
          className="pl-btn pl-btn-forest"
          style={{ marginTop: '1.25rem' }}
          onClick={onCta}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
