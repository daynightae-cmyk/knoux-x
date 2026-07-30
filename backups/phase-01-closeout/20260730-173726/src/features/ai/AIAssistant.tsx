/**
 * ═══════════════════════════════════════════════════════════════════════
 * KNOUX Player X™ - AI Assistant (Enhanced)
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * مساعد الذكاء الاصطناعي المتقدم - يدعم OpenRouter
 * 
 * @module Features/AI
 * @author KNOUX Development Team
 * @version 2.0.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageSquare, 
  X, 
  Send, 
  Bot, 
  User,
  Sparkles,
  Trash2,
  Settings,
  Cpu,
  Zap,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { NeonPanel } from '../../components/neon/NeonPanel';
import { NeonButton } from '../../components/neon/NeonButton';
import { NeonBadge } from '../../components/neon/NeonBadge';
import { NeonInput } from '../../components/neon/NeonInput';
import { useAppStore } from '../../store/appStore';
import { 
  openRouterService, 
  AVAILABLE_MODELS,
  type AIModel,
  type ServiceStatus 
} from '../../core/services/ai/OpenRouterService';

// ═══════════════════════════════════════════════════════════════════════════
// أنواع البيانات
// ═══════════════════════════════════════════════════════════════════════════

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

interface Suggestion {
  label: string;
  prompt: string;
  icon: React.ReactNode;
}

// ═══════════════════════════════════════════════════════════════════════════
// مكون مساعد الذكاء الاصطناعي المحسن
// ═══════════════════════════════════════════════════════════════════════════

export const AIAssistant: React.FC = () => {
  const { isAIAssistantOpen, toggleAIAssistant } = useAppStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>({
    isOnline: false,
    latency: 0,
    model: AVAILABLE_MODELS[0].id,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ═════════════════════════════════════════════════════════════════════════
  // الاقتراحات المحسنة
  // ═════════════════════════════════════════════════════════════════════════

  const suggestions: Suggestion[] = [
    { 
      label: 'Recommend movies', 
      prompt: 'Recommend some good sci-fi movies to watch',
      icon: <Sparkles size={14} />
    },
    { 
      label: 'Create playlist', 
      prompt: 'Create a relaxing evening music playlist',
      icon: <Zap size={14} />
    },
    { 
      label: 'Audio help', 
      prompt: 'How do I use the Neural DSP equalizer?',
      icon: <Cpu size={14} />
    },
    { 
      label: 'Analyze media', 
      prompt: 'What can you tell me about the currently playing media?',
      icon: <Bot size={14} />
    },
  ];

  // ═════════════════════════════════════════════════════════════════════════
  // التهيئة والتحديث
  // ═════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const updateStatus = () => {
      setServiceStatus(openRouterService.getStatus());
      setSelectedModel(openRouterService.getCurrentModel());
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000);

    // Listen for service events
    openRouterService.on('connected', updateStatus);
    openRouterService.on('error', updateStatus);

    return () => {
      clearInterval(interval);
      openRouterService.off('connected', updateStatus);
      openRouterService.off('error', updateStatus);
    };
  }, []);

  // ═════════════════════════════════════════════════════════════════════════
  // التمرير التلقائي
  // ═════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ═════════════════════════════════════════════════════════════════════════
  // إرسال الرسالة مع دعم البث المباشر
  // ═════════════════════════════════════════════════════════════════════════

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Add streaming message placeholder
    const streamingId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, {
      id: streamingId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    }]);

    try {
      // Try streaming first
      const stream = openRouterService.streamChat(content);
      let fullContent = '';

      for await (const chunk of stream) {
        fullContent += chunk;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === streamingId
              ? { ...msg, content: fullContent }
              : msg
          )
        );
      }

      // Update final message
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === streamingId
            ? { ...msg, content: fullContent, isStreaming: false }
            : msg
        )
      );
    } catch (error) {
      console.error('AI chat error:', error);
      
      // Fallback to non-streaming
      try {
        const response = await openRouterService.chat(content);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === streamingId
              ? { ...msg, content: response, isStreaming: false }
              : msg
          )
        );
      } catch {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === streamingId
              ? { ...msg, content: '❌ Sorry, I encountered an error. Please check your API key and try again.', isStreaming: false }
              : msg
          )
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const clearChat = () => {
    setMessages([]);
    openRouterService.clearContext();
  };

  // ═════════════════════════════════════════════════════════════════════════
  // إعدادات API
  // ═════════════════════════════════════════════════════════════════════════

  const handleSaveApiKey = async () => {
    if (apiKey.trim()) {
      await openRouterService.setApiKey(apiKey.trim());
      setApiKey('');
      setShowSettings(false);
    }
  };

  const handleModelChange = async (modelId: string) => {
    await openRouterService.setModel(modelId);
    setSelectedModel(modelId);
  };

  // ═════════════════════════════════════════════════════════════════════════
  // عرض حالة الخدمة
  // ═════════════════════════════════════════════════════════════════════════

  const renderStatus = () => {
    if (!openRouterService.hasApiKey()) {
      return (
        <NeonBadge variant="warning" size="sm" pulse>
          <AlertCircle size={12} />
          API Key Required
        </NeonBadge>
      );
    }

    if (serviceStatus.isOnline) {
      return (
        <NeonBadge variant="success" size="sm">
          <CheckCircle size={12} />
          {serviceStatus.latency}ms
        </NeonBadge>
      );
    }

    return (
      <NeonBadge variant="error" size="sm" pulse>
        <AlertCircle size={12} />
        Offline
      </NeonBadge>
    );
  };

  // ═════════════════════════════════════════════════════════════════════════
  // عرض المكون
  // ═════════════════════════════════════════════════════════════════════════

  return (
    <AnimatePresence>
      {isAIAssistantOpen && (
        <motion.div
          className="ai-assistant-enhanced"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <NeonPanel
            variant="primary"
            padding="none"
            glowIntensity="high"
            className="ai-panel-enhanced"
          >
            {/* Header */}
            <div className="ai-header-enhanced">
              <div className="ai-title-section">
                <motion.div 
                  className="ai-icon-wrapper"
                  animate={{ 
                    rotate: [0, 5, -5, 0],
                    scale: [1, 1.1, 1]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Sparkles size={20} className="ai-icon" />
                </motion.div>
                <div className="ai-title-text">
                  <span className="ai-title">KNOUX AI</span>
                  <span className="ai-subtitle">
                    {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name || 'AI Assistant'}
                  </span>
                </div>
              </div>
              
              <div className="ai-header-actions">
                {renderStatus()}
                
                <motion.button
                  className="ai-action-btn"
                  onClick={() => setShowSettings(!showSettings)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  title="Settings"
                >
                  <Settings size={16} />
                </motion.button>
                
                <motion.button
                  className="ai-action-btn"
                  onClick={clearChat}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  title="Clear chat"
                >
                  <Trash2 size={16} />
                </motion.button>
                
                <motion.button
                  className="ai-action-btn close"
                  onClick={toggleAIAssistant}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  title="Close"
                >
                  <X size={18} />
                </motion.button>
              </div>
            </div>

            {/* Settings Panel */}
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  className="ai-settings-panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="settings-section">
                    <label className="settings-label">
                      <Sparkles size={14} />
                      OpenRouter API Key
                    </label>
                    <div className="api-key-input">
                      <NeonInput
                        type="password"
                        placeholder="Enter your API key (free at openrouter.ai)"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        glowColor="cyan"
                      />
                      <NeonButton
                        variant="primary"
                        size="sm"
                        onClick={handleSaveApiKey}
                        disabled={!apiKey.trim()}
                      >
                        Save
                      </NeonButton>
                    </div>
                    <p className="settings-hint">
                      Get a free API key at{' '}
                      <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">
                        openrouter.ai
                      </a>
                    </p>
                  </div>

                  <div className="settings-section">
                    <label className="settings-label">
                      <Cpu size={14} />
                      AI Model
                    </label>
                    <select
                      className="model-select"
                      value={selectedModel}
                      onChange={(e) => handleModelChange(e.target.value)}
                    >
                      {AVAILABLE_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} - {model.description}
                        </option>
                      ))}
                    </select>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Messages */}
            <div className="ai-messages-enhanced">
              {messages.length === 0 ? (
                <div className="ai-welcome-enhanced">
                  <motion.div 
                    className="welcome-icon-wrapper"
                    animate={{ 
                      y: [0, -10, 0],
                      rotate: [0, 5, -5, 0]
                    }}
                    transition={{ duration: 3, repeat: Infinity }}
                  >
                    <Bot size={56} className="welcome-icon" />
                  </motion.div>
                  
                  <h3>Hello! I'm KNOUX AI</h3>
                  <p>Your intelligent media assistant powered by cutting-edge AI</p>
                  
                  <div className="welcome-features">
                    <div className="feature-item">
                      <Sparkles size={16} />
                      <span>Smart Recommendations</span>
                    </div>
                    <div className="feature-item">
                      <Zap size={16} />
                      <span>Playlist Generation</span>
                    </div>
                    <div className="feature-item">
                      <Cpu size={16} />
                      <span>Media Analysis</span>
                    </div>
                  </div>

                  <div className="suggestions-enhanced">
                    <span className="suggestions-label">Try asking:</span>
                    <div className="suggestions-grid">
                      {suggestions.map((suggestion, index) => (
                        <motion.button
                          key={suggestion.label}
                          className="suggestion-chip-enhanced"
                          onClick={() => sendMessage(suggestion.prompt)}
                          whileHover={{ scale: 1.03, y: -2 }}
                          whileTap={{ scale: 0.97 }}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.1 }}
                        >
                          {suggestion.icon}
                          {suggestion.label}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((message, index) => (
                    <motion.div
                      key={message.id}
                      className={`message-enhanced ${message.role}`}
                      initial={{ opacity: 0, x: message.role === 'user' ? 20 : -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                    >
                      <div className={`message-avatar ${message.role}`}>
                        {message.role === 'assistant' ? (
                          <Bot size={18} />
                        ) : (
                          <User size={18} />
                        )}
                      </div>
                      <div className="message-bubble">
                        <div className="message-content">
                          <p>{message.content || (message.isStreaming ? '' : '...')}</p>
                          {message.isStreaming && (
                            <span className="streaming-cursor">▋</span>
                          )}
                        </div>
                        <span className="message-time">
                          {message.timestamp.toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                  
                  {isLoading && !messages.some(m => m.isStreaming) && (
                    <motion.div
                      className="message-enhanced assistant loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <div className="message-avatar assistant">
                        <Bot size={18} />
                      </div>
                      <div className="message-bubble">
                        <div className="typing-indicator-enhanced">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input */}
            <form className="ai-input-enhanced" onSubmit={handleSubmit}>
              <div className="input-wrapper">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={openRouterService.hasApiKey() 
                    ? "Ask me anything about your media..." 
                    : "Configure API key in settings to use AI..."
                  }
                  disabled={isLoading || !openRouterService.hasApiKey()}
                />
                <motion.button
                  type="submit"
                  disabled={!input.trim() || isLoading || !openRouterService.hasApiKey()}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="send-btn"
                >
                  <Send size={18} />
                </motion.button>
              </div>
            </form>
          </NeonPanel>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AIAssistant;
