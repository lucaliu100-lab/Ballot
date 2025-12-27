/**
 * InstantDB Configuration
 * 
 * This file initializes InstantDB with:
 * - Schema definition for practice sessions
 * - Database initialization with App ID
 * - Exports the db instance for use throughout the app
 */

import { init, i } from "@instantdb/react";

// Define the schema for our database
const schema = i.schema({
  entities: {
    // Practice sessions - stores all feedback data from completed rounds
    sessions: i.entity({
      // Context
      theme: i.string(),
      quote: i.string(),
      
      // Processed content
      transcript: i.string(),
      bodyLanguageAnalysis: i.string(),
      
      // Speech stats
      durationSeconds: i.number(),
      duration: i.string(), // Formatted duration string
      wordCount: i.number(),
      wordsPerMinute: i.number(),
      wpm: i.number(), // Words per minute
      fillerCount: i.number(),
      fillerWordCount: i.number(), // Total filler words
      
      // New feedback scores (structure, content, delivery)
      structureScore: i.number(),
      contentScore: i.number(),
      deliveryScore: i.number(),
      languageScore: i.number(),
      bodyLanguageScore: i.number(),
      
      // Legacy: overall score (for backward compatibility)
      overallScore: i.number(),
      
      // Competitive context
      performanceTier: i.string(),
      tournamentReady: i.boolean(),
      contentAnalysis: i.string(),
      deliveryAnalysis: i.string(),
      
      // Lists (stored as JSON)
      strengths: i.json<string[]>(),
      improvements: i.json<string[]>(),      // New format
      areasForImprovement: i.json<string[]>(), // Legacy format
      specificTips: i.json<string[]>(),      // Legacy format
      
      // Practice drill (new format)
      practiceDrill: i.string(),
      
      // Content summary
      contentSummary: i.string(),
      
      // Summary (legacy)
      summary: i.string(),
      
      // File reference (video stored on server filesystem)
      videoFilename: i.string(),
      
      // Full analysis JSON (for future-proofing)
      fullAnalysisJson: i.string(),
      
      // Timestamp
      createdAt: i.number(),
    }),
  },
});

// Initialize InstantDB with your App ID
// Disable devtools in production
export const db = init({
  appId: "45ff8c3e-0325-4bab-b3fc-f9911a91f453",
  schema,
  devtool: false, // Disable the InstantDB devtools icon
});

// Export schema type for TypeScript inference
export type Schema = typeof schema;

