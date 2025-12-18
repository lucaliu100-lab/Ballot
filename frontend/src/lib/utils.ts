/**
 * Utility Functions
 * 
 * Shared helper functions used across multiple components.
 */

import { COLORS } from './constants';
import { FlowStep } from '../types';
import { FLOW_STEPS, STEP_LABELS } from './constants';

// ===========================================
// SCORE UTILITIES
// ===========================================

/**
 * Get the appropriate color for a score value (0-10)
 * Used for visual feedback on performance scores.
 */
export function getScoreColor(score: number): string {
  if (score >= 8) return COLORS.scoreExcellent;
  if (score >= 6) return COLORS.scoreGood;
  if (score >= 4) return COLORS.scoreFair;
  return COLORS.scorePoor;
}

// ===========================================
// DATE UTILITIES
// ===========================================

/**
 * Format a timestamp to a human-readable date string
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format seconds to MM:SS format
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ===========================================
// FLOW STEP UTILITIES
// ===========================================

/**
 * Get the numeric index of a flow step
 */
export function getStepIndex(step: FlowStep): number {
  return FLOW_STEPS.indexOf(step);
}

/**
 * Get the human-readable label for a flow step
 */
export function getStepLabel(step: FlowStep): string {
  return STEP_LABELS[step];
}

// ===========================================
// STRING UTILITIES
// ===========================================

/**
 * Extract filename from a file path
 */
export function extractFilename(filePath: string): string {
  return filePath.split('/').pop() || '';
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

// ===========================================
// ERROR UTILITIES
// ===========================================

/**
 * Extract error message from an unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unknown error occurred';
}

