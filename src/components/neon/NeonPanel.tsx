import { forwardRef, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

import './neon-styles.css';

export interface NeonPanelProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children?: ReactNode;
  variant?: 'default' | 'primary' | 'secondary' | 'dark';
  borderGlow?: boolean;
  glowColor?: string;
  glowIntensity?: 'low' | 'medium' | 'high';
  glassEffect?: boolean;
  glassOpacity?: number;
  borderRadius?: 'sm' | 'md' | 'lg' | 'xl';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

/** Shared KNOUX surface primitive. Legacy prop names remain API-compatible. */
export const NeonPanel = forwardRef<HTMLDivElement, NeonPanelProps>(
  (
    {
      children,
      variant = 'default',
      borderGlow = true,
      glowColor,
      glowIntensity = 'medium',
      glassEffect = true,
      glassOpacity: _glassOpacity,
      borderRadius = 'lg',
      padding = 'md',
      className = '',
      style,
      ...props
    },
    ref,
  ) => {
    const panelStyle = {
      ...style,
      '--knoux-panel-accent': glowColor ?? 'var(--knoux-accent)',
    } as HTMLMotionProps<'div'>['style'];

    return (
      <motion.div
        ref={ref}
        className={[
          'neon-panel',
          `neon-panel--${variant}`,
          `neon-panel--radius-${borderRadius}`,
          `neon-panel--padding-${padding}`,
          `neon-panel--glow-${glowIntensity}`,
          borderGlow ? 'neon-panel--bordered' : '',
          glassEffect ? 'neon-panel--glass' : '',
          className,
        ].filter(Boolean).join(' ')}
        style={panelStyle}
        {...props}
      >
        {children}
      </motion.div>
    );
  },
);

NeonPanel.displayName = 'NeonPanel';
