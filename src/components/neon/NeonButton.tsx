import { forwardRef, type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

import './neon-styles.css';

export interface NeonButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  glowColor?: string;
  glowIntensity?: 'low' | 'medium' | 'high';
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

/**
 * The legacy public name is retained to avoid breaking feature modules. The
 * implementation is now the shared KNOUX Button primitive: theme-aware,
 * motion-safe, keyboard-visible and free of idle glow animations.
 */
export const NeonButton = forwardRef<HTMLButtonElement, NeonButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      glowColor,
      glowIntensity = 'medium',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      className = '',
      disabled,
      style,
      type = 'button',
      ...props
    },
    ref,
  ) => {
    const isDisabled = Boolean(disabled || isLoading);
    const controlStyle = {
      ...style,
      '--knoux-control-accent': glowColor ?? 'var(--knoux-accent)',
    } as HTMLMotionProps<'button'>['style'];

    return (
      <motion.button
        ref={ref}
        type={type}
        className={[
          'neon-button',
          `neon-button--${variant}`,
          `neon-button--${size}`,
          `neon-button--glow-${glowIntensity}`,
          fullWidth ? 'neon-button--full' : '',
          className,
        ].filter(Boolean).join(' ')}
        style={controlStyle}
        whileTap={isDisabled ? undefined : { scale: 0.98 }}
        disabled={isDisabled}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading && <span className="neon-button__spinner" aria-hidden="true" />}
        {!isLoading && leftIcon && <span className="neon-button__icon" aria-hidden="true">{leftIcon}</span>}
        {children != null && <span className="neon-button__label">{children}</span>}
        {rightIcon && <span className="neon-button__icon" aria-hidden="true">{rightIcon}</span>}
      </motion.button>
    );
  },
);

NeonButton.displayName = 'NeonButton';
