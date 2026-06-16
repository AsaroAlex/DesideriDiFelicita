import React from 'react';

export interface GalleryFigureProps {
  src: string;
  alt?: string;
  /** CSS aspect-ratio. @default "3 / 4" */
  ratio?: string;
  /** CSS object-position for the crop, e.g. "center top". @default "center" */
  objectPosition?: string;
  /** Caption shown on hover. */
  caption?: React.ReactNode;
  /** Small uppercase gold category label above the caption. */
  category?: string;
  style?: React.CSSProperties;
}

/**
 * Gallery image in a fixed editorial crop with a soft zoom and gradient
 * caption overlay on hover.
 *
 * @startingPoint section="Content" subtitle="Gallery image, 3:4 crop" viewport="320x420"
 */
export function GalleryFigure(props: GalleryFigureProps): JSX.Element;
