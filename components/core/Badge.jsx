import React from 'react';

/**
 * Badge — small pill label. `tbc` = "da confermare" / "su richiesta" note
 * (blush bg, gold text); `gold`, `blush`, `neutral` for general tags.
 */
export function Badge({ children, variant = 'tbc', style, ...rest }) {
  const palettes = {
    tbc: { bg: 'var(--color-blush-soft)', fg: 'var(--color-gold-text)' },
    gold: { bg: 'color-mix(in srgb, var(--color-gold) 18%, #fff)', fg: 'var(--color-gold-text)' },
    blush: { bg: 'var(--color-blush)', fg: '#7c4a4e' },
    neutral: { bg: 'var(--color-surface-alt)', fg: 'var(--color-ink-soft)' },
  };
  const p = palettes[variant] || palettes.tbc;
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-body)',
        fontSize: '0.7rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: p.fg,
        background: p.bg,
        borderRadius: 'var(--radius-pill)',
        padding: '0.2em 0.75em',
        verticalAlign: 'middle',
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
