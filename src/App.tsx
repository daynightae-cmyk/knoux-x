/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - Main App Component
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * المكون الرئيسي للتطبيق - نسخة محسنة مع شاشة بداية مذهلة
 * 
 * @module App
 * @author KNOUX Development Team
 * @version 2.0.0 Ultimate
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { PlayerView } from './features/player/PlayerView';
import { LibraryView } from './features/library/LibraryView';
import { SettingsView } from './features/settings/SettingsView';
import { AIAssistant } from './features/ai/AIAssistant';
import { useAppStore } from './store/appStore';
import { openRouterService } from './core/services/ai/OpenRouterService';
import './styles/global.css';
import './styles/splash.css';

// ═══════════════════════════════════════════════════════════════════════════
// شاشة البداية المذهلة
// ═══════════════════════════════════════════════════════════════════════════

interface SplashScreenProps {
  onComplete: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [loadingText, setLoadingText] = useState('Initializing');
  const [particles, setParticles] = useState<Array<{ id: number; x: number; delay: number; color: string }>>([]);

  const loadingTexts = [
    'Initializing Core Systems',
    'Loading Neural DSP Engine',
    'Connecting AI Services',
    'Optimizing Video Pipeline',
    'Loading Media Library',
    'Ready to Launch',
  ];

  // Generate particles on mount
  useEffect(() => {
    const colors = ['#00f0ff', '#ff00f0', '#aa00ff', '#32ff64'];
    const newParticles = Array.from({ length: 25 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    setParticles(newParticles);
  }, []);

  // Progress animation
  useEffect(() => {
    const duration = 4000; // 4 seconds
    const interval = 50;
    const steps = duration / interval;
    let currentStep = 0;

    const timer = setInterval(() => {
      currentStep++;
      const newProgress = Math.min(100, (currentStep / steps) * 100);
      setProgress(newProgress);

      // Update loading text based on progress
      const textIndex = Math.min(
        loadingTexts.length - 1,
        Math.floor((newProgress / 100) * loadingTexts.length)
      );
      setLoadingText(loadingTexts[textIndex]);

      if (newProgress >= 100) {
        clearInterval(timer);
        setTimeout(onComplete, 500);
      }
    }, interval);

    return () => clearInterval(timer);
  }, [onComplete]);

  return (
    <motion.div
      className="splash-screen-enhanced"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Animated Background Grid */}
      <div className="splash-bg-grid" />
      
      {/* Scan Lines Effect */}
      <div className="splash-scan-lines" />
      
      {/* Floating Orbs */}
      <motion.div 
        className="splash-orb splash-orb-1"
        animate={{
          x: [0, 30, -20, 0],
          y: [0, -30, 20, 0],
          scale: [1, 1.1, 0.9, 1],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div 
        className="splash-orb splash-orb-2"
        animate={{
          x: [0, -25, 25, 0],
          y: [0, 25, -25, 0],
          scale: [1, 0.9, 1.1, 1],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
      />
      <motion.div 
        className="splash-orb splash-orb-3"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.1, 0.2, 0.1],
        }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      />

      {/* Floating Particles */}
      <div className="splash-particles">
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            className="splash-particle"
            style={{
              left: `${particle.x}%`,
              background: particle.color,
              boxShadow: `0 0 10px ${particle.color}, 0 0 20px ${particle.color}`,
            }}
            initial={{ y: '100vh', opacity: 0 }}
            animate={{
              y: '-100vh',
              opacity: [0, 0.6, 0.6, 0],
            }}
            transition={{
              duration: 8 + Math.random() * 4,
              repeat: Infinity,
              delay: particle.delay,
              ease: 'linear',
            }}
          />
        ))}
      </div>

      {/* Corner Decorations */}
      <div className="splash-corner splash-corner-tl" />
      <div className="splash-corner splash-corner-tr" />
      <div className="splash-corner splash-corner-bl" />
      <div className="splash-corner splash-corner-br" />

      {/* Main Content */}
      <div className="splash-content">
        {/* Logo Container */}
        <motion.div 
          className="splash-logo-container"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          {/* Rotating Rings */}
          <motion.div 
            className="splash-logo-ring"
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          />
          <motion.div 
            className="splash-logo-ring-2"
            animate={{ rotate: -360 }}
            transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
          />
          
          {/* Logo Image */}
          <motion.img
            src="./assets/logo.png"
            alt="KNOUX Player X"
            className="splash-logo-image"
            animate={{
              scale: [1, 1.05, 1],
              filter: [
                'drop-shadow(0 0 30px rgba(0, 240, 255, 0.5))',
                'drop-shadow(0 0 50px rgba(0, 240, 255, 0.8)) drop-shadow(0 0 80px rgba(255, 0, 240, 0.4))',
                'drop-shadow(0 0 30px rgba(0, 240, 255, 0.5))',
              ],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>

        {/* Brand Text */}
        <motion.div 
          className="splash-brand"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <motion.h1 
            className="splash-brand-name"
            animate={{
              backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
            }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
          >
            KNOUX
          </motion.h1>
          <span className="splash-brand-subtitle">Player X™</span>
          <span className="splash-brand-tagline">Next-Gen Media Experience</span>
        </motion.div>

        {/* Progress Section */}
        <motion.div 
          className="splash-progress-section"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {/* Progress Bar */}
          <div className="splash-progress-container">
            <motion.div
              className="splash-progress-bar"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.1, ease: 'linear' }}
            />
            <motion.div
              className="splash-progress-glow"
              style={{ left: `${progress}%` }}
              animate={{
                opacity: [0.5, 1, 0.5],
                scale: [1, 1.2, 1],
              }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />
          </div>

          {/* Progress Segments */}
          <div className="splash-progress-segments">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                className="splash-segment"
                animate={{
                  backgroundColor: progress > i * 20 ? '#00f0ff' : 'rgba(255, 255, 255, 0.1)',
                  boxShadow: progress > i * 20 ? '0 0 10px #00f0ff' : 'none',
                }}
                transition={{ duration: 0.2 }}
              />
            ))}
          </div>

          {/* Loading Text */}
          <div className="splash-loading-text-container">
            <motion.span 
              className="splash-loading-text"
              key={loadingText}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {loadingText}
            </motion.span>
            <div className="splash-loading-dots">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="splash-dot"
                  animate={{
                    y: [0, -8, 0],
                    opacity: [0.4, 1, 0.4],
                  }}
                  transition={{
                    duration: 0.6,
                    repeat: Infinity,
                    delay: i * 0.2,
                  }}
                />
              ))}
            </div>
          </div>
        </motion.div>

        {/* Feature Tags */}
        <motion.div 
          className="splash-feature-tags"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
        >
          {[
            { text: 'AI Powered', color: '#00f0ff' },
            { text: '4K HDR', color: '#ff00f0' },
            { text: 'Neural DSP', color: '#aa00ff' },
          ].map((tag, i) => (
            <motion.span
              key={tag.text}
              className="splash-feature-tag"
              style={{
                borderColor: `${tag.color}40`,
                background: `${tag.color}15`,
                color: tag.color,
              }}
              animate={{
                boxShadow: [
                  `0 0 5px ${tag.color}30`,
                  `0 0 15px ${tag.color}60`,
                  `0 0 5px ${tag.color}30`,
                ],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                delay: i * 0.3,
              }}
            >
              {tag.text}
            </motion.span>
          ))}
        </motion.div>
      </div>

      {/* Version */}
      <motion.span 
        className="splash-version"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        v2.0.0 Ultimate
      </motion.span>
    </motion.div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// المكون الرئيسي
// ═══════════════════════════════════════════════════════════════════════════

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const { currentView, theme, accentColor } = useAppStore();

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة
  // ═════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const initialize = async () => {
      try {
        // Initialize AI service
        await openRouterService.initialize();
        
        setIsInitialized(true);
      } catch (error) {
        console.error('Initialization error:', error);
        // Continue even if some services fail
        setIsInitialized(true);
      }
    };

    initialize();

    return () => {
      openRouterService.shutdown();
    };
  }, []);

  const handleSplashComplete = useCallback(() => {
    setIsLoading(false);
  }, []);

  // ═════════════════════════════════════════════════════════════════════════
  // عرض شاشة البداية
  // ═════════════════════════════════════════════════════════════════════════

  if (isLoading) {
    return (
      <AnimatePresence mode="wait">
        <SplashScreen key="splash" onComplete={handleSplashComplete} />
      </AnimatePresence>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════
  // عرض التطبيق الرئيسي
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="app"
        className={`app-container theme-${theme}`}
        style={{ '--accent-color': accentColor } as React.CSSProperties}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Title Bar */}
        <TitleBar />

        {/* Main Content */}
        <div className="main-layout">
          {/* Sidebar */}
          <Sidebar />

          {/* Content Area */}
          <main className="content-area">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentView}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="view-container"
              >
                {currentView === 'player' && <PlayerView />}
                {currentView === 'library' && <LibraryView />}
                {currentView === 'settings' && <SettingsView />}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        {/* AI Assistant */}
        <AIAssistant />

        {/* Initialization Status Indicator */}
        {!isInitialized && (
          <motion.div
            className="init-status"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <span className="init-status-dot" />
            Initializing services...
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default App;