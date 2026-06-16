import React, { useState } from 'react';

/**
 * GalleryFigure — image in a fixed editorial crop (default 3:4) with a soft
 * gold-tinted zoom on hover and an optional caption overlay.
 */
export function GalleryFigure({ src, alt = '', ratio = '3 / 4', objectPosition = 'center', caption, category, style, ...rest }) {
  const [hover, setHover] = useState(false);
  return (
    <figure
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        margin: 0,
        aspectRatio: ratio,
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        transition: 'box-shadow var(--transition)',
        ...style,
      }}
      {...rest}
    >
      {/* hairline inner frame keeps a uniform editorial edge across photos
         whose own backgrounds/lighting vary */}
      <span aria-hidden="true" style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', boxShadow: 'inset 0 0 0 1px rgba(34,44,57,0.07)', pointerEvents: 'none', zIndex: 1 }} />
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition,
          display: 'block',
          transform: hover ? 'scale(1.045)' : 'none',
          transition: 'transform var(--transition-slow)',
        }}
      />
      {(caption || category) && (
        <figcaption
          style={{
            position: 'absolute',
            inset: 'auto 0 0 0',
            padding: 'var(--space-lg) var(--space-md) var(--space-md)',
            background: 'linear-gradient(to top, rgba(30,39,51,0.72), transparent)',
            color: 'var(--color-on-dark)',
            opacity: hover ? 1 : 0,
            transform: hover ? 'none' : 'translateY(6px)',
            transition: 'opacity var(--transition), transform var(--transition)',
          }}
        >
          {category && (
            <span style={{ display: 'block', fontSize: '0.66rem', letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase', color: 'var(--color-gold-on-dark)', marginBottom: '0.25em' }}>
              {category}
            </span>
          )}
          {caption && <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-300)' }}>{caption}</span>}
        </figcaption>
      )}
    </figure>
  );
}
