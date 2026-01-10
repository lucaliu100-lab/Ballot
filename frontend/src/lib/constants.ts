/**
 * Application Constants
 * 
 * Centralized configuration values used throughout the app.
 * Change values here to update the entire application.
 */

// ===========================================
// TIMING
// ===========================================

/** Preparation timer duration in seconds */
export const PREP_TIMER_DURATION = 120; // 2 minutes

// ===========================================
// COLORS
// ===========================================

export const COLORS = {
  // Primary colors (black/dark theme)
  primaryGradient: '#111111',
  primary: '#111111',
  primaryDark: '#000000',
  
  // Background
  backgroundGradient: '#ffffff',
  background: '#ffffff',
  
  // Score colors
  scoreExcellent: '#10b981', // Green (8-10)
  scoreGood: '#fbbf24',      // Yellow (6-7)
  scoreFair: '#f97316',      // Orange (4-5)
  scorePoor: '#ef4444',      // Red (0-3)
  
  // UI colors
  white: '#fff',
  black: '#000000',
  textPrimary: '#111111',
  textSecondary: '#333333',
  textMuted: '#666666',
  textDisabled: '#999999',
  
  // Status colors
  error: '#dc2626',
  errorBg: '#fef2f2',
  errorBorder: '#fecaca',
  success: '#059669',
  successBg: '#ecfdf5',
  successBorder: '#a7f3d0',
  warning: '#d97706',
  warningBg: '#fffbeb',
  
  // Card/surface colors
  cardBg: '#ffffff',
  cardBorder: '#e5e5e5',
  inputBg: '#fafafa',
  inputBorder: '#d4d4d4',
  
  // Border colors
  border: '#000000',
  borderLight: '#e5e5e5',
  borderMedium: '#d4d4d4',
} as const;

// ===========================================
// STEP CONFIGURATION
// ===========================================

import { FlowStep } from '../types';

/** Human-readable labels for each flow step */
export const STEP_LABELS: Record<FlowStep, string> = {
  'start': 'Welcome',
  'theme-preview': 'Theme',
  'quote-select': 'Select Quote',
  'prep': 'Prepare',
  'record': 'Record',
  'processing': 'Analyzing',
  'insufficient': 'Insufficient Speech',
  'report': 'Feedback',
  'ballot': 'Ballot',
};

/** Ordered list of flow steps */
export const FLOW_STEPS: FlowStep[] = [
  'start',
  'theme-preview',
  'quote-select',
  'prep',
  'record',
  'processing',
  'report',
];

// ===========================================
// API CONFIGURATION
// ===========================================

/** Backend API base URL */
export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

/** API endpoints */
export const API_ENDPOINTS = {
  ping: `${API_BASE_URL}/ping`,
  status: `${API_BASE_URL}/status`,
  startRound: `${API_BASE_URL}/start-round`,
  upload: `${API_BASE_URL}/upload`,
  processAll: `${API_BASE_URL}/process-all`,
  analysisStatus: `${API_BASE_URL}/analysis-status`,
} as const;

/** Polling configuration for analysis status */
export const POLLING_CONFIG = {
  intervalMs: 2500,         // Poll every 2.5 seconds
  maxDurationMs: 600_000,   // Max 10 minutes before offering "refresh later"
} as const;

