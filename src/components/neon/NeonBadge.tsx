/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Neon Badge Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * شارة بتأثيرات نيون
 * 
 * @module Components/Neon
 */

import React from 'react';
import { motion } from 'framer-motion';
import './neon-styles.css';

export interface NeonBadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'premium';
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  glow?: boolean;
  className?: string;
  onClick?: () => void;
}

const variantMap = {
  default: { bg: 'rgba(0, 240, 255, 0.15)', border: '#00f0ff', text: '#00f0ff' },
  success: { bg: 'rgba(50, 255, 100, 0.15)', border: '#32ff64', text: '#32ff64' },
  warning: { bg: 'rgba(255, 170, 0, 0.15)', border: '#ffaa00', text: '#ffaa00' },
  error: { bg: 'rgba(255, 50, 50, 0.15)', border: '#ff3232', text: '#ff3232' },
  info: { bg: 'rgba(170, 0, 255, 0.15)', border: '#aa00ff', text: '#aa00ff' },
  premium: { bg: 'linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 170, 0, 0.2))', border: '#ffd700', text: '#ffd700' },
};

const sizeMap = {
  sm: { padding: '2px 8px', fontSize: '0.625rem' },
  md: { padding: '4px 12px', fontSize: '0.75rem' },
  lg: { padding: '6px 16px', fontSize: '0.875rem' },
};

export const NeonBadge: React.FC<NeonBadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  pulse = false,
  glow = true,
  className = '',
  onClick,
}) => {
  const { bg, border, text } = variantMap[variant];
  const { padding, fontSize } = sizeMap[size];

  return (
    <motion.span
      className={`neon-badge ${className}`}
      style={{
        padding,
        fontSize,
        background: bg,
        border: `1px solid ${border}`,
        color: text,
        boxShadow: glow ? `0 0 10px ${border}40` : 'none',
        cursor: onClick ? 'pointer' : 'default',
      }}
      whileHover={onClick ? { scale: 1.05 } : {}}
      whileTap={onClick ? { scale: 0.95 } : {}}
      onClick={onClick}
      animate={pulse ? {
        boxShadow: [
          `0 0 5px ${border}40`,
          `0 0 20px ${border}80`,
          `0 0 5px ${border}40`,
        ],
      } : {}}
      transition={pulse ? {
        duration: 1.5,
        repeat: Infinity,
        ease: 'easeInOut',
      } : {}}
    >
      {variant === 'premium' && (
        <motion.span
          className="neon-badge-shine"
          animate={{
            x: ['-100%', '100%'],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      )}
      {children}
    </motion.span>
  );
};

export default NeonBadge;
