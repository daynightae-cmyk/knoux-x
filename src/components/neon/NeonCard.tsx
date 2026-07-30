/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Neon Card Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * بطاقة زجاجية بتأثيرات نيون متقدمة
 * 
 * @module Components/Neon
 */

import React from 'react';
import { motion } from 'framer-motion';
import './neon-styles.css';

export interface NeonCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: 'cyan' | 'magenta' | 'green' | 'purple' | 'yellow' | 'red';
  intensity?: 'low' | 'medium' | 'high';
  hoverScale?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}

const colorMap = {
  cyan: '#00f0ff',
  magenta: '#ff00f0',
  green: '#32ff64',
  purple: '#aa00ff',
  yellow: '#ffaa00',
  red: '#ff3232',
};

const intensityMap = {
  low: { blur: 10, spread: 5 },
  medium: { blur: 20, spread: 10 },
  high: { blur: 40, spread: 20 },
};

export const NeonCard: React.FC<NeonCardProps> = ({
  children,
  className = '',
  glowColor = 'cyan',
  intensity = 'medium',
  hoverScale = true,
  onClick,
  style,
}) => {
  const color = colorMap[glowColor];
  const { blur, spread } = intensityMap[intensity];

  return (
    <motion.div
      className={`neon-card ${className}`}
      style={{
        '--glow-color': color,
        '--glow-blur': `${blur}px`,
        '--glow-spread': `${spread}px`,
        ...style,
      } as React.CSSProperties}
      whileHover={hoverScale ? { 
        scale: 1.02,
        boxShadow: `0 0 ${blur * 2}px ${color}, 0 0 ${blur * 4}px ${color}40`,
      } : {}}
      whileTap={onClick ? { scale: 0.98 } : {}}
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="neon-card-border" />
      <div className="neon-card-content">
        {children}
      </div>
      <div className="neon-card-shine" />
    </motion.div>
  );
};

export default NeonCard;
