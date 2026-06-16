import React from 'react';

/**
 * Eyebrow — the spaced uppercase gold label that opens most sections.
 * Optionally preceded by a short gold rule (matches the logo's lettering).
 */
export function Eyebrow({ children, rule = true, onDark = false, style, ...rest }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.7em',
        fontFamily: 'var(--font-body)',
        fontSize: 'var(--fs-100)',
        fontWeight: 600,
        letterSpacing: 'var(--tracking-wide)',
        textTransform: 'uppercase',
        color: onDark ? 'var(--color-gold-on-dark)' : 'var(--color-gold-text)',
        ...style,
      }}
      {...rest}
    >
      {rule && (
        <span
          aria-hidden="true"
          style={{ width: '2rem', height: '1px', background: 'currentColor', opacity: 0.7 }}
        />
      )}
      {children}
    </span>
  );
}
