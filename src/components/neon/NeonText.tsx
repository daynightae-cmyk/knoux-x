/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Neon Text Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * نص بتأثيرات نيون متقدمة
 * 
 * @module Components/Neon
 */

import React from 'react';
import { motion } from 'framer-motion';
import './neon-styles.css';

export interface NeonTextProps {
  children: React.ReactNode;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'span';
  className?: string;
  glowColor?: 'cyan' | 'magenta' | 'green' | 'purple' | 'yellow' | 'red' | 'gradient';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  weight?: 'light' | 'normal' | 'medium' | 'semibold' | 'bold' | 'extrabold';
  animate?: boolean;
  flicker?: boolean;
  style?: React.CSSProperties;
}

const colorMap = {
  cyan: '#00f0ff',
  magenta: '#ff00f0',
  green: '#32ff64',
  purple: '#aa00ff',
  yellow: '#ffaa00',
  red: '#ff3232',
  gradient: 'linear-gradient(135deg, #00f0ff, #ff00f0)',
};

const sizeMap = {
  xs: '0.75rem',
  sm: '0.875rem',
  md: '1rem',
  lg: '1.25rem',
  xl: '1.5rem',
  '2xl': '2rem',
  '3xl': '3rem',
};

const weightMap = {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
};

export const NeonText: React.FC<NeonTextProps> = ({
  children,
  as: Component = 'span',
  className = '',
  glowColor = 'cyan',
  size = 'md',
  weight = 'normal',
  animate = false,
  flicker = false,
  style,
}) => {
  const color = colorMap[glowColor];
  const fontSize = sizeMap[size];
  const fontWeight = weightMap[weight];

  const animationProps = animate
    ? {
        animate: {
          textShadow: [
            `0 0 5px ${color}`,
            `0 0 20px ${color}`,
            `0 0 40px ${color}`,
            `0 0 20px ${color}`,
            `0 0 5px ${color}`,
          ],
        },
        transition: {
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        },
      }
    : {};

  const flickerProps = flicker
    ? {
        animate: {
          opacity: [1, 0.8, 1, 0.9, 1, 0.7, 1],
        },
        transition: {
          duration: 0.5,
          repeat: Infinity,
          repeatDelay: 3,
        },
      }
    : {};

  return (
    <motion.div
      className={`neon-text-wrapper ${className}`}
      {...animationProps}
      {...flickerProps}
    >
      <Component
        className="neon-text"
        style={{
          fontSize,
          fontWeight,
          color: glowColor === 'gradient' ? 'transparent' : color,
          background: glowColor === 'gradient' ? color : 'none',
          WebkitBackgroundClip: glowColor === 'gradient' ? 'text' : 'initial',
          WebkitTextFillColor: glowColor === 'gradient' ? 'transparent' : 'initial',
          textShadow: animate ? undefined : `0 0 10px ${color}, 0 0 20px ${color}50`,
          ...style,
        }}
      >
        {children}
      </Component>
    </motion.div>
  );
};

export default NeonText;
