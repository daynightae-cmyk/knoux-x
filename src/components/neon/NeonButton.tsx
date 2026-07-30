/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Neon Button Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * زر نيون - مكون زر بتصميم نيون متوهج
 * 
 * @module Components/Neon
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import React, { forwardRef } from 'react';
import { motion } from 'framer-motion';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface NeonButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  glowColor?: string;
  glowIntensity?: 'low' | 'medium' | 'high';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// مكون الزر النيون
// ═══════════════════════════════════════════════════════════════════════════

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
      ...props
    },
    ref
  ) => {
    // ═══════════════════════════════════════════════════════════════════════
    // تكوين الأنماط
    // ═══════════════════════════════════════════════════════════════════════

    const variantStyles = {
      primary: {
        background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.15) 0%, rgba(0, 160, 255, 0.1) 100%)',
        borderColor: 'rgba(0, 240, 255, 0.5)',
        textColor: '#00f0ff',
        glowColor: glowColor || '#00f0ff',
      },
      secondary: {
        background: 'linear-gradient(135deg, rgba(255, 0, 240, 0.15) 0%, rgba(160, 0, 255, 0.1) 100%)',
        borderColor: 'rgba(255, 0, 240, 0.5)',
        textColor: '#ff00f0',
        glowColor: glowColor || '#ff00f0',
      },
      danger: {
        background: 'linear-gradient(135deg, rgba(255, 50, 50, 0.15) 0%, rgba(200, 0, 0, 0.1) 100%)',
        borderColor: 'rgba(255, 50, 50, 0.5)',
        textColor: '#ff3232',
        glowColor: glowColor || '#ff3232',
      },
      success: {
        background: 'linear-gradient(135deg, rgba(50, 255, 100, 0.15) 0%, rgba(0, 200, 50, 0.1) 100%)',
        borderColor: 'rgba(50, 255, 100, 0.5)',
        textColor: '#32ff64',
        glowColor: glowColor || '#32ff64',
      },
      ghost: {
        background: 'transparent',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        textColor: 'rgba(255, 255, 255, 0.8)',
        glowColor: glowColor || '#ffffff',
      },
    };

    const sizeStyles = {
      sm: {
        padding: '8px 16px',
        fontSize: '12px',
        borderRadius: '6px',
      },
      md: {
        padding: '12px 24px',
        fontSize: '14px',
        borderRadius: '8px',
      },
      lg: {
        padding: '16px 32px',
        fontSize: '16px',
        borderRadius: '10px',
      },
    };

    const glowIntensities = {
      low: {
        boxShadow: `0 0 10px {color}40, 0 0 20px {color}20`,
        hoverBoxShadow: `0 0 15px {color}60, 0 0 30px {color}30`,
      },
      medium: {
        boxShadow: `0 0 15px {color}50, 0 0 30px {color}30, 0 0 45px {color}10`,
        hoverBoxShadow: `0 0 20px {color}70, 0 0 40px {color}40, 0 0 60px {color}20`,
      },
      high: {
        boxShadow: `0 0 20px {color}60, 0 0 40px {color}40, 0 0 60px {color}20, 0 0 80px {color}10`,
        hoverBoxShadow: `0 0 30px {color}80, 0 0 60px {color}50, 0 0 90px {color}30, 0 0 120px {color}15`,
      },
    };

    const currentVariant = variantStyles[variant];
    const currentSize = sizeStyles[size];
    const currentGlow = glowIntensities[glowIntensity];

    const isDisabled = disabled || isLoading;

    // ═══════════════════════════════════════════════════════════════════════
    // عرض المكون
    // ═══════════════════════════════════════════════════════════════════════

    return (
      <motion.button
        ref={ref}
        className={`
          neon-button
          relative
          font-medium
          tracking-wide
          uppercase
          border
          cursor-pointer
          transition-all
          duration-200
          flex
          items-center
          justify-center
          gap-2
          ${fullWidth ? 'w-full' : ''}
          ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${className}
        `}
        style={{
          background: currentVariant.background,
          borderColor: currentVariant.borderColor,
          color: currentVariant.textColor,
          padding: currentSize.padding,
          fontSize: currentSize.fontSize,
          borderRadius: currentSize.borderRadius,
          boxShadow: currentGlow.boxShadow.replace(/{color}/g, currentVariant.glowColor),
          textShadow: `0 0 10px ${currentVariant.glowColor}50`,
        }}
        whileHover={
          isDisabled
            ? {}
            : {
                scale: 1.02,
                boxShadow: currentGlow.hoverBoxShadow.replace(/{color}/g, currentVariant.glowColor),
              }
        }
        whileTap={isDisabled ? {} : { scale: 0.98 }}
        disabled={isDisabled}
        {...props}
      >
        {/* Glow overlay */}
        <motion.div
          className="absolute inset-0 rounded-inherit pointer-events-none"
          style={{
            borderRadius: currentSize.borderRadius,
            background: `radial-gradient(circle at center, ${currentVariant.glowColor}10 0%, transparent 70%)`,
          }}
          animate={
            isDisabled
              ? {}
              : {
                  opacity: [0.5, 0.8, 0.5],
                }
          }
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Loading spinner */}
        {isLoading && (
          <motion.div
            className="w-4 h-4 border-2 border-current border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        )}

        {/* Left icon */}
        {!isLoading && leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}

        {/* Content */}
        <span className="relative z-10">{children}</span>

        {/* Right icon */}
        {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
      </motion.button>
    );
  }
);

NeonButton.displayName = 'NeonButton';
