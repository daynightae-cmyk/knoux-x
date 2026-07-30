/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Neon Input Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * حقل إدخال بتأثيرات نيون
 * 
 * @module Components/Neon
 */

import React, { useState, forwardRef } from 'react';
import { motion } from 'framer-motion';
import './neon-styles.css';

export interface NeonInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  glowColor?: 'cyan' | 'magenta' | 'green' | 'purple' | 'yellow' | 'red';
  icon?: React.ReactNode;
  rightElement?: React.ReactNode;
}

const colorMap = {
  cyan: '#00f0ff',
  magenta: '#ff00f0',
  green: '#32ff64',
  purple: '#aa00ff',
  yellow: '#ffaa00',
  red: '#ff3232',
};

export const NeonInput = forwardRef<HTMLInputElement, NeonInputProps>(
  ({ 
    label, 
    error, 
    glowColor = 'cyan', 
    icon, 
    rightElement,
    className = '',
    ...props 
  }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const color = colorMap[glowColor];

    return (
      <div className={`neon-input-wrapper ${className}`}>
        {label && (
          <motion.label
            className="neon-input-label"
            initial={false}
            animate={{
              color: isFocused ? color : 'rgba(255, 255, 255, 0.6)',
            }}
            transition={{ duration: 0.2 }}
          >
            {label}
          </motion.label>
        )}
        
        <motion.div
          className="neon-input-container"
          initial={false}
          animate={{
            boxShadow: isFocused
              ? `0 0 20px ${color}40, inset 0 0 20px ${color}10`
              : '0 0 0 transparent',
            borderColor: isFocused ? color : 'rgba(255, 255, 255, 0.1)',
          }}
          transition={{ duration: 0.2 }}
        >
          {icon && (
            <motion.span 
              className="neon-input-icon"
              animate={{ color: isFocused ? color : 'rgba(255, 255, 255, 0.4)' }}
            >
              {icon}
            </motion.span>
          )}
          
          <input
            ref={ref}
            className="neon-input"
            onFocus={(e) => {
              setIsFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              props.onBlur?.(e);
            }}
            {...props}
          />
          
          {rightElement && (
            <span className="neon-input-right-element">
              {rightElement}
            </span>
          )}
          
          {/* Animated border */}
          <motion.div
            className="neon-input-border"
            initial={false}
            animate={{
              scaleX: isFocused ? 1 : 0,
              background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
            }}
            transition={{ duration: 0.3 }}
          />
        </motion.div>
        
        {error && (
          <motion.span
            className="neon-input-error"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {error}
          </motion.span>
        )}
      </div>
    );
  }
);

NeonInput.displayName = 'NeonInput';

export default NeonInput;
