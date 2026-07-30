/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Neon Slider Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * شريط تمرير نيون - مكون شريط تمرير بتصميم نيون
 * 
 * @module Components/Neon
 * @author KNOUX Development Team
 * @version 1.0.0
 */

import React, { forwardRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

export interface NeonSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  onChangeStart?: () => void;
  onChangeEnd?: () => void;
  glowColor?: string;
  trackColor?: string;
  fillColor?: string;
  thumbColor?: string;
  height?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  tooltipFormatter?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// مكون شريط التمرير النيون
// ═══════════════════════════════════════════════════════════════════════════

export const NeonSlider = forwardRef<HTMLDivElement, NeonSliderProps>(
  (
    {
      value,
      min = 0,
      max = 100,
      step = 1,
      onChange,
      onChangeStart,
      onChangeEnd,
      glowColor = '#00f0ff',
      trackColor = 'rgba(255, 255, 255, 0.1)',
      fillColor,
      thumbColor,
      height = 'md',
      showTooltip = false,
      tooltipFormatter = (v) => `${Math.round(v)}`,
      disabled = false,
      className = '',
    },
    ref
  ) => {
    const [isDragging, setIsDragging] = useState(false);
    const [showTooltipState, setShowTooltipState] = useState(false);

    const actualFillColor = fillColor || glowColor;
    const actualThumbColor = thumbColor || glowColor;

    // ═══════════════════════════════════════════════════════════════════════
    // حسابات
    // ═══════════════════════════════════════════════════════════════════════

    const percentage = ((value - min) / (max - min)) * 100;

    const heightStyles = {
      sm: { track: 4, thumb: 12 },
      md: { track: 6, thumb: 16 },
      lg: { track: 8, thumb: 20 },
    };

    const currentHeight = heightStyles[height];

    // ═══════════════════════════════════════════════════════════════════════
    // معالجات الأحداث
    // ═══════════════════════════════════════════════════════════════════════

    const handleMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (disabled) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const clickPosition = (e.clientX - rect.left) / rect.width;
        const newValue = min + clickPosition * (max - min);
        const steppedValue = Math.round(newValue / step) * step;
        const clampedValue = Math.max(min, Math.min(max, steppedValue));

        onChange(clampedValue);
        setIsDragging(true);
        setShowTooltipState(true);
        onChangeStart?.();
      },
      [disabled, min, max, step, onChange, onChangeStart]
    );

    const handleMouseMove = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDragging || disabled) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const clickPosition = (e.clientX - rect.left) / rect.width;
        const newValue = min + clickPosition * (max - min);
        const steppedValue = Math.round(newValue / step) * step;
        const clampedValue = Math.max(min, Math.min(max, steppedValue));

        onChange(clampedValue);
      },
      [isDragging, disabled, min, max, step, onChange]
    );

    const handleMouseUp = useCallback(() => {
      if (isDragging) {
        setIsDragging(false);
        setShowTooltipState(false);
        onChangeEnd?.();
      }
    }, [isDragging, onChangeEnd]);

    const handleMouseLeave = useCallback(() => {
      if (isDragging) {
        setIsDragging(false);
        setShowTooltipState(false);
        onChangeEnd?.();
      }
    }, [isDragging, onChangeEnd]);

    // ═══════════════════════════════════════════════════════════════════════
    // عرض المكون
    // ═══════════════════════════════════════════════════════════════════════

    return (
      <div
        ref={ref}
        className={`
          neon-slider
          relative
          w-full
          select-none
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${className}
        `}
        style={{ height: currentHeight.thumb }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {/* Track */}
        <div
          className="absolute rounded-full"
          style={{
            top: '50%',
            transform: 'translateY(-50%)',
            left: 0,
            right: 0,
            height: currentHeight.track,
            background: trackColor,
            boxShadow: `inset 0 0 5px rgba(0, 0, 0, 0.3)`,
          }}
        />

        {/* Fill */}
        <motion.div
          className="absolute rounded-full"
          style={{
            top: '50%',
            transform: 'translateY(-50%)',
            left: 0,
            height: currentHeight.track,
            background: `linear-gradient(90deg, ${actualFillColor}, ${actualFillColor}dd)`,
            boxShadow: `0 0 10px ${actualFillColor}50, 0 0 20px ${actualFillColor}30`,
          }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.05 }}
        />

        {/* Thumb */}
        <motion.div
          className="absolute rounded-full"
          style={{
            top: '50%',
            transform: 'translate(-50%, -50%)',
            left: `${percentage}%`,
            width: currentHeight.thumb,
            height: currentHeight.thumb,
            background: actualThumbColor,
            boxShadow: `
              0 0 10px ${actualThumbColor},
              0 0 20px ${actualThumbColor}80,
              0 0 30px ${actualThumbColor}40,
              inset 0 0 5px rgba(255, 255, 255, 0.5)
            `,
          }}
          animate={{
            scale: isDragging ? 1.2 : 1,
          }}
          transition={{ duration: 0.1 }}
        />

        {/* Tooltip */}
        {(showTooltip || showTooltipState) && (
          <motion.div
            className="absolute px-2 py-1 text-xs font-medium rounded"
            style={{
              bottom: '100%',
              left: `${percentage}%`,
              transform: 'translateX(-50%)',
              background: 'rgba(0, 0, 0, 0.8)',
              color: glowColor,
              border: `1px solid ${glowColor}50`,
              boxShadow: `0 0 10px ${glowColor}30`,
              marginBottom: 8,
            }}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
          >
            {tooltipFormatter(value)}
          </motion.div>
        )}
      </div>
    );
  }
);

NeonSlider.displayName = 'NeonSlider';
