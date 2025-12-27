/**
 * Gemini Client Module (via OpenRouter)
 * 
 * Handles multimodal analysis (Video + Audio) using Gemini 2.0 Flash.
 * Uses the OpenRouter API for unified model access.
 */

import fs from 'fs';
import path from 'path';

// ===========================================
// CONFIGURATION
// ===========================================

function getApiKey(): string {
  // Use the OpenRouter API key from .env
  return process.env.OPENROUTER_API_KEY || '';
}

function getModel(): string {
  // Production-stable ID for Gemini 2.0 Flash on OpenRouter
  return process.env.GEMINI_MODEL || 'google/gemini-2.0-flash-001';
}

// ===========================================
// TYPES
// ===========================================

export interface GeminiAnalysisInput {
  videoPath: string;
  theme: string;
  quote: string;
}

export interface GeminiAnalysisResult {
  success: boolean;
  transcript: string;
  analysis?: {
    overallScore: number;
    performanceTier: string;
    tournamentReady: boolean;
    categoryScores: {
      content: { score: number; weight: number; weighted: number };
      delivery: { score: number; weight: number; weighted: number };
      language: { score: number; weight: number; weighted: number };
      bodyLanguage: { score: number; weight: number; weighted: number };
    };
    contentAnalysis: {
      topicAdherence: { score: number; feedback: string };
      argumentStructure: { score: number; feedback: string };
      depthOfAnalysis: { score: number; feedback: string };
      examplesEvidence: { score: number; feedback: string };
      timeManagement: { score: number; feedback: string };
    };
    deliveryAnalysis: {
      vocalVariety: { score: number; feedback: string };
      pacing: { score: number; wpm: number; feedback: string };
      articulation: { score: number; feedback: string };
      fillerWords: {
        score: number;
        total: number;
        perMinute: number;
        breakdown: Record<string, number>;
        feedback: string;
      };
    };
    languageAnalysis: {
      vocabulary: { score: number; feedback: string };
      rhetoricalDevices: { score: number; examples: string[]; feedback: string };
      emotionalAppeal: { score: number; feedback: string };
      logicalAppeal: { score: number; feedback: string };
    };
    bodyLanguageAnalysis: {
      eyeContact: { score: number; percentage: number; feedback: string };
      gestures: { score: number; feedback: string };
      posture: { score: number; feedback: string };
      stagePresence: { score: number; feedback: string };
    };
    speechStats: {
      duration: string;
      wordCount: number;
      wpm: number;
      fillerWordCount: number;
      fillerWordRate: number;
    };
    structureAnalysis: {
      introduction: { timeRange: string; assessment: string };
      bodyPoints: Array<{ timeRange: string; assessment: string }>;
      conclusion: { timeRange: string; assessment: string };
    };
    priorityImprovements: Array<{
      priority: number;
      issue: string;
      action: string;
      impact: string;
    }>;
    strengths: string[];
    practiceDrill: string;
    nextSessionFocus: { primary: string; metric: string };
  };
  error?: string;
}

// ===========================================
// HELPERS
// ===========================================

/**
 * Encodes a local file to Base64 data URL
 */
async function encodeVideoToBase64(videoPath: string): Promise<string> {
  const stats = await fs.promises.stat(videoPath);
  const sizeInMB = stats.size / (1024 * 1024);
  
  // OpenRouter/Gemini usually handles up to 20MB-50MB via Base64. 
  // Warn if it's exceptionally large.
  if (sizeInMB > 15) {
    console.warn(`⚠️ Large video file detected (${sizeInMB.toFixed(2)}MB). Base64 encoding will increase this by ~33%.`);
  }

  const videoBuffer = await fs.promises.readFile(videoPath);
  const base64Video = videoBuffer.toString('base64');
  
  // Determine mime type based on extension
  const ext = path.extname(videoPath).toLowerCase();
  let mimeType = 'video/webm';
  if (ext === '.mp4') mimeType = 'video/mp4';
  if (ext === '.mov') mimeType = 'video/quicktime';

  return `data:${mimeType};base64,${base64Video}`;
}

// ===========================================
// MAIN ANALYSIS FUNCTION
// ===========================================

export async function analyzeSpeechWithGemini(
  input: GeminiAnalysisInput
): Promise<GeminiAnalysisResult> {
  const apiKey = getApiKey();
  const modelName = getModel();

  if (!apiKey) {
    return {
      success: false,
      transcript: '',
      error: 'OPENROUTER_API_KEY not found in environment variables.',
    };
  }

  console.log(`\n🌟 Analyzing via OpenRouter [Model: ${modelName}]...`);
  console.log(`   API Key present: ${apiKey ? 'Yes (starts with ' + apiKey.substring(0, 7) + '...)' : 'No'}`);
  console.log(`   Video path: ${input.videoPath}`);

  try {
    const base64Video = await encodeVideoToBase64(input.videoPath);
    console.log(`   Video encoded (Base64 length: ${base64Video.length})`);

    const prompt = `
      You are updating the Gemini judging prompt for BALLOT, a professional debate training platform. The current prompt produces generic feedback. We need NSDA-standard competitive impromptu judging.
      
      THEME: ${input.theme}
      QUOTE: ${input.quote}
      
      CRITICAL REQUIREMENTS:

      1. SPEECH LENGTH VALIDATION (IMPLEMENT FIRST):
      - Extract speech duration from video metadata
      - If duration < 3:00 minutes:
        * Apply automatic 2-point penalty to content score
        * Add prominent warning: "⚠️ INSUFFICIENT LENGTH: Competitive impromptu requires 5-7 minutes. This speech is too short to adequately develop arguments."
        * In feedback, explain: "Content score reduced due to insufficient development time."
      - If duration < 2:00 minutes:
        * Content score capped at 4.0/10 maximum
        * Major warning: "🚫 CRITICAL: Speech under 2 minutes. Unable to demonstrate competitive-level content."
      - Optimal range: 5:00-7:00 minutes
      - Note if speech > 7:00: "Slightly over time - practice conciseness"

      2. WEIGHTED SCORING SYSTEM:
      Create 4 category scores, weighted as follows:
      - Content (40% weight): Structure, arguments, examples, depth, topic adherence, time management
      - Delivery (30% weight): Vocal variety, pacing (140-160 WPM ideal), articulation, strategic pauses, energy
      - Language (15% weight): Vocabulary sophistication, rhetorical devices, sentence variety, emotional appeal (pathos), logical appeal (logos)
      - Body Language (15% weight): Eye contact (>75% target), purposeful gestures, confident posture, facial expressions, stage presence

      Overall Score = (Content × 0.40) + (Delivery × 0.30) + (Language × 0.15) + (Body Language × 0.15)

      3. CONTENT ANALYSIS (40% - Most Important):
      Evaluate and provide specific scores for:
      - Topic Adherence (0-10): Did speaker directly address the quote/theme? Stay on topic?
      - Argument Structure (0-10): Clear intro with thesis + roadmap, 2-3 body points, strong conclusion
      - Depth of Analysis (0-10): Surface-level vs sophisticated thinking, nuance, originality (not cliché)
      - Examples & Evidence (0-10): Number (need 2-3), quality, specificity, relevance
      - Time Allocation (0-10): Intro 20-30s, Body 4-5min, Conclusion 20-30s, balanced point development

      For EACH sub-score, provide:
      - Numerical score
      - Specific reasoning
      - Time-stamped evidence ("at 1:45, you...")

      4. DELIVERY ANALYSIS (30%):
      Evaluate with specific metrics:
      - Vocal Variety (0-10): Tone changes, pitch modulation, volume variation, emotional expression (not monotone)
      - Pacing (0-10): WPM count (extract from transcript), identify if too fast (>170 WPM) or too slow (<120 WPM), note rushed sections
      - Articulation (0-10): Clear pronunciation, enunciation, projection, no mumbling
      - Filler Word Control (0-10): Count "um", "uh", "like", "you know" - calculate per-minute rate, target <5/min

      Provide:
      - Exact filler word count by type
      - WPM calculation
      - Specific timestamps where pacing issues occur

      5. LANGUAGE USE (15%):
      Analyze linguistic sophistication:
      - Vocabulary Level (0-10): Word choice complexity, precise terminology, avoiding repetition
      - Rhetorical Devices (0-10): Metaphors, analogies, rhetorical questions, parallel structure, rule of three
      - Emotional Appeal/Pathos (0-10): Storytelling, relatable scenarios, evoking feeling
      - Logical Appeal/Logos (0-10): Clear reasoning, cause-effect, logical connectors, argument coherence

      Extract specific examples from transcript for each.

      6. BODY LANGUAGE (15%):
      Multimodal video analysis:
      - Eye Contact (0-10): Percentage of time, scanning pattern, note when dropped (timestamps)
      - Gestures (0-10): Purposeful vs distracting, variety, natural, emphasis timing, hand positioning
      - Posture & Stance (0-10): Upright, confident, not slouching, professional presence
      - Facial Expressions (0-10): Matching tone, genuine, animated, avoiding blank expression
      - Stage Presence (0-10): Confidence, energy, comfort level, authority, audience connection

      Provide timestamps for notable moments (good and bad).

      7. STRUCTURE BREAKDOWN:
      Analyze speech structure with time ranges:
      - Introduction (target 20-30s): Hook quality, thesis clarity, point preview, engagement
      - Body Points (target 4-5min total): Identify each distinct main point/argument (typically 2-3 points)
        * For EACH body point, provide separate timeRange and assessment
        * Evaluate transitions, balance, example placement, logical flow for each
      - Conclusion (target 20-30s): Recap, return to thesis, memorable closer, no new points, definitive ending

      IMPORTANT: In structureAnalysis.bodyPoints array, provide separate entries for EACH distinct argument/point (not just one combined assessment).
      Flag if intro or conclusion is too long (>45s each).

      8. COMPETITIVE CONTEXT:
      Provide tournament-level assessment:
      - Performance Tier: "This speech is [Finals/Semifinals/Quarterfinals/Local/Developing] level"
      - Specific comparison: "Your delivery is semifinals-ready, but content needs depth to break at competitive tournaments"
      - Tournament Readiness: Yes/No + estimated prep time needed
      - Key blockers preventing competitive success

      9. ACTIONABLE FEEDBACK FORMAT:
      Return valid JSON matching this structure:
      {
        "transcript": "...",
        "overallScore": 0.0,
        "performanceTier": "string",
        "tournamentReady": true,
        "categoryScores": {
          "content": {"score": 0.0, "weight": 0.40, "weighted": 0.00},
          "delivery": {"score": 0.0, "weight": 0.30, "weighted": 0.00},
          "language": {"score": 0.0, "weight": 0.15, "weighted": 0.00},
          "bodyLanguage": {"score": 0.0, "weight": 0.15, "weighted": 0.00}
        },
        "contentAnalysis": {
          "topicAdherence": {"score": 0, "feedback": "string"},
          "argumentStructure": {"score": 0, "feedback": "string"},
          "depthOfAnalysis": {"score": 0, "feedback": "string"},
          "examplesEvidence": {"score": 0, "feedback": "string"},
          "timeManagement": {"score": 0, "feedback": "string"}
        },
        "deliveryAnalysis": {
          "vocalVariety": {"score": 0, "feedback": "string"},
          "pacing": {"score": 0, "wpm": 0, "feedback": "string"},
          "articulation": {"score": 0, "feedback": "string"},
          "fillerWords": {"score": 0, "total": 0, "perMinute": 0.0, "breakdown": {}, "feedback": "string"}
        },
        "languageAnalysis": {
          "vocabulary": {"score": 0, "feedback": "string"},
          "rhetoricalDevices": {"score": 0, "examples": [], "feedback": "string"},
          "emotionalAppeal": {"score": 0, "feedback": "string"},
          "logicalAppeal": {"score": 0, "feedback": "string"}
        },
        "bodyLanguageAnalysis": {
          "eyeContact": {"score": 0, "percentage": 0, "feedback": "string"},
          "gestures": {"score": 0, "feedback": "string"},
          "posture": {"score": 0, "feedback": "string"},
          "stagePresence": {"score": 0, "feedback": "string"}
        },
        "speechStats": {
          "duration": "string",
          "wordCount": 0,
          "wpm": 0,
          "fillerWordCount": 0,
          "fillerWordRate": 0.0
        },
        "structureAnalysis": {
          "introduction": {"timeRange": "0:00-0:25", "assessment": "Strong hook with clear thesis"},
          "bodyPoints": [
            {"timeRange": "0:25-1:40", "assessment": "First main point with evidence"},
            {"timeRange": "1:40-3:00", "assessment": "Second point builds on first"},
            {"timeRange": "3:00-4:35", "assessment": "Final argument ties together"}
          ],
          "conclusion": {"timeRange": "4:35-5:00", "assessment": "Memorable closing statement"}
        },
        "priorityImprovements": [
          {"priority": 1, "issue": "string", "action": "string", "impact": "string"}
        ],
        "strengths": ["string"],
        "practiceDrill": "string",
        "nextSessionFocus": {"primary": "string", "metric": "string"}
      }

      10. TONE REQUIREMENTS:
      - Professional and direct (not casual)
      - Specific and technical (not vague)
      - Constructive but honest (no sugarcoating)
      - Use competitive debate terminology
      - Reference NSDA standards where relevant
      - Comparative context (tournament levels)
    `;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173", 
        "X-Title": "Ballot Speech App",
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "video_url",
                video_url: {
                  url: base64Video,
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" }, 
        temperature: 0.3, 
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown API Error' } }));
      throw new Error(errorData.error?.message || `OpenRouter API Error (${response.status})`);
    }

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content;

    if (!resultText) {
      throw new Error("Empty response from model.");
    }

    const analysis = JSON.parse(resultText);
    const transcript = analysis.transcript || '';
    
    // Remove transcript from the nested analysis object if it's there
    if (analysis.transcript) {
      delete analysis.transcript;
    }
    
    console.log('✅ Analysis successful!');
    return {
      success: true,
      transcript,
      analysis,
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Analysis failed:', msg);
    if (error instanceof Error && (error as any).cause) {
      console.error('   Cause:', (error as any).cause);
    }
    return {
      success: false,
      transcript: '',
      error: msg,
    };
  }
}

export function isGeminiConfigured(): boolean {
  return Boolean(getApiKey());
}

export function getGeminiStatus(): { configured: boolean; model: string } {
  return {
    configured: isGeminiConfigured(),
    model: getModel(),
  };
}
