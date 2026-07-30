/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Neon Progress Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * شريط تقدم بتأثيرات نيون
 * 
 * @module Components/Neon
 */

import React from 'react';
import { motion } from 'framer-motion';
import './neon-styles.css';

export interface NeonProgressProps {
  value: number;
  max?: number;
  glowColor?: 'cyan' | 'magenta' | 'green' | 'purple' | 'yellow' | 'red' | 'gradient';
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
  animated?: boolean;
  striped?: boolean;
  className?: string;
}

const colorMap = {
  cyan: '#00f0ff',
  magenta: '#ff00f0',
  green: '#32ff64',
  purple: '#aa00ff',
  yellow: '#ffaa00',
  red: '#ff3232',
  gradient: 'linear-gradient(90deg, #00f0ff, #ff00f0)',
};

const sizeMap = {
  sm: { height: 4, borderRadius: 2 },
  md: { height: 8, borderRadius: 4 },
  lg: { height: 12, borderRadius: 6 },
};

export const NeonProgress: React.FC<NeonProgressProps> = ({
  value,
  max = 100,
  glowColor = 'cyan',
  size = 'md',
  showValue = false,
  animated = true,
  striped = false,
  className = '',
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const color = colorMap[glowColor];
  const { height, borderRadius } = sizeMap[size];

  return (
    <div className={`neon-progress-wrapper ${className}`}>
      <div
        className="neon-progress-track"
        style={{
          height,
          borderRadius,
        }}
      >
        <motion.div
          className={`neon-progress-bar ${striped ? 'striped' : ''}`}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{
            duration: animated ? 0.5 : 0,
            ease: 'easeOut',
          }}
          style={{
            height: '100%',
            borderRadius,
            background: glowColor === 'gradient' ? color : `linear-gradient(90deg, ${color}, ${color}dd)`,
            boxShadow: `0 0 ${height * 2}px ${color}, 0 0 ${height * 4}px ${color}50`,
          }}
        >
          {striped && (
            <div className="neon-progress-stripes" />
          )}
          
          {/* Glow pulse effect */}
          <motion.div
            className="neon-progress-glow"
            animate={{
              opacity: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            style={{
              background: `radial-gradient(circle at right, ${color}80, transparent)`,
            }}
          />
        </motion.div>
        
        {/* Sparkle effect at progress tip */}
        {percentage > 0 && percentage < 100 && (
          <motion.div
            className="neon-progress-sparkle"
            style={{
              left: `${percentage}%`,
              color,
            }}
            animate={{
              scale: [1, 1.5, 1],
              opacity: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}
      </div>
      
      {showValue && (
        <motion.span
          className="neon-progress-value"
          style={{ color }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {Math.round(percentage)}%
        </motion.span>
      )}
    </div>
  );
};

export default NeonProgress;
