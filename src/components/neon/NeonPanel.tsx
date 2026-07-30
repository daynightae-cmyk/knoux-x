/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Neon Panel Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * لوحة نيون - مكون لوحة بتصميم زجاجي نيون
 * 
 * @module Components/Neon
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import React, { forwardRef } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface NeonPanelProps extends HTMLMotionProps<"div"> {
  variant?: 'default' | 'primary' | 'secondary' | 'dark';
  borderGlow?: boolean;
  glowColor?: string;
  glowIntensity?: 'low' | 'medium' | 'high';
  glassEffect?: boolean;
  glassOpacity?: number;
  borderRadius?: 'sm' | 'md' | 'lg' | 'xl';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

// ═══════════════════════════════════════════════════════════════════════════
// مكون اللوحة النيون
// ═══════════════════════════════════════════════════════════════════════════

export const NeonPanel = forwardRef<HTMLDivElement, NeonPanelProps>(
  (
    {
      children,
      variant = 'default',
      borderGlow = true,
      glowColor,
      glowIntensity = 'medium',
      glassEffect = true,
      glassOpacity = 0.1,
      borderRadius = 'lg',
      padding = 'md',
      className = '',
      style,
      ...props
    },
    ref
  ) => {
    // ═══════════════════════════════════════════════════════════════════════
    // تكوين الأنماط
    // ═══════════════════════════════════════════════════════════════════════

    const variantStyles = {
      default: {
        background: glassEffect
          ? `linear-gradient(135deg, rgba(255, 255, 255, ${glassOpacity}) 0%, rgba(255, 255, 255, ${glassOpacity * 0.5}) 100%)`
          : 'rgba(10, 14, 26, 0.9)',
        borderColor: glowColor || 'rgba(0, 240, 255, 0.3)',
        glowColor: glowColor || '#00f0ff',
      },
      primary: {
        background: glassEffect
          ? `linear-gradient(135deg, rgba(0, 240, 255, ${glassOpacity}) 0%, rgba(0, 160, 255, ${glassOpacity * 0.5}) 100%)`
          : 'rgba(0, 240, 255, 0.1)',
        borderColor: glowColor || 'rgba(0, 240, 255, 0.5)',
        glowColor: glowColor || '#00f0ff',
      },
      secondary: {
        background: glassEffect
          ? `linear-gradient(135deg, rgba(255, 0, 240, ${glassOpacity}) 0%, rgba(160, 0, 255, ${glassOpacity * 0.5}) 100%)`
          : 'rgba(255, 0, 240, 0.1)',
        borderColor: glowColor || 'rgba(255, 0, 240, 0.5)',
        glowColor: glowColor || '#ff00f0',
      },
      dark: {
        background: 'rgba(5, 8, 15, 0.95)',
        borderColor: glowColor || 'rgba(255, 255, 255, 0.1)',
        glowColor: glowColor || '#ffffff',
      },
    };

    const borderRadiusStyles = {
      sm: '8px',
      md: '12px',
      lg: '16px',
      xl: '24px',
    };

    const paddingStyles = {
      none: '0',
      sm: '12px',
      md: '20px',
      lg: '32px',
    };

    const glowIntensities = {
      low: '0 0 10px {color}20, 0 0 20px {color}10',
      medium: '0 0 15px {color}30, 0 0 30px {color}15, inset 0 0 20px {color}05',
      high: '0 0 20px {color}40, 0 0 40px {color}20, 0 0 60px {color}10, inset 0 0 30px {color}10',
    };

    const currentVariant = variantStyles[variant];
    const currentGlow = glowIntensities[glowIntensity];

    // ═══════════════════════════════════════════════════════════════════════
    // عرض المكون
    // ═══════════════════════════════════════════════════════════════════════

    return (
      <motion.div
        ref={ref}
        className={`
          neon-panel
          relative
          overflow-hidden
          ${className}
        `}
        style={{
          background: currentVariant.background,
          border: `1px solid ${currentVariant.borderColor}`,
          borderRadius: borderRadiusStyles[borderRadius],
          padding: paddingStyles[padding],
          boxShadow: borderGlow
            ? currentGlow.replace(/{color}/g, currentVariant.glowColor)
            : undefined,
          backdropFilter: glassEffect ? 'blur(20px)' : undefined,
          WebkitBackdropFilter: glassEffect ? 'blur(20px)' : undefined,
          ...style,
        }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        {...props}
      >
        {/* Inner glow effect */}
        {borderGlow && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at top, ${currentVariant.glowColor}08 0%, transparent 50%)`,
              borderRadius: 'inherit',
            }}
          />
        )}

        {/* Corner accents */}
        {borderGlow && (
          <>
            <div
              className="absolute top-0 left-0 w-8 h-px"
              style={{
                background: `linear-gradient(90deg, ${currentVariant.glowColor}, transparent)`,
              }}
            />
            <div
              className="absolute top-0 left-0 w-px h-8"
              style={{
                background: `linear-gradient(180deg, ${currentVariant.glowColor}, transparent)`,
              }}
            />
            <div
              className="absolute top-0 right-0 w-8 h-px"
              style={{
                background: `linear-gradient(-90deg, ${currentVariant.glowColor}, transparent)`,
              }}
            />
            <div
              className="absolute top-0 right-0 w-px h-8"
              style={{
                background: `linear-gradient(180deg, ${currentVariant.glowColor}, transparent)`,
              }}
            />
            <div
              className="absolute bottom-0 left-0 w-8 h-px"
              style={{
                background: `linear-gradient(90deg, ${currentVariant.glowColor}, transparent)`,
              }}
            />
            <div
              className="absolute bottom-0 left-0 w-px h-8"
              style={{
                background: `linear-gradient(0deg, ${currentVariant.glowColor}, transparent)`,
              }}
            />
            <div
              className="absolute bottom-0 right-0 w-8 h-px"
              style={{
                background: `linear-gradient(-90deg, ${currentVariant.glowColor}, transparent)`,
              }}
            />
            <div
              className="absolute bottom-0 right-0 w-px h-8"
              style={{
                background: `linear-gradient(0deg, ${currentVariant.glowColor}, transparent)`,
              }}
            />
          </>
        )}

        {/* Content */}
        <div className="relative z-10">{children}</div>
      </motion.div>
    );
  }
);

NeonPanel.displayName = 'NeonPanel';