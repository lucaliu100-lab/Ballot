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
  bodyLanguageAnalysis: string;
  feedback: {
    scores: {
      structure: number;
      content: number;
      delivery: number;
    };
    strengths: string[];
    improvements: string[];
    practiceDrill: string;
    contentSummary: string;
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
      bodyLanguageAnalysis: '',
      feedback: {
        scores: { structure: 0, content: 0, delivery: 0 },
        strengths: [],
        improvements: [],
        practiceDrill: '',
        contentSummary: ''
      },
      error: 'OPENROUTER_API_KEY not found in environment variables.',
    };
  }

  console.log(`\n🌟 Analyzing via OpenRouter [Model: ${modelName}]...`);

  try {
    const base64Video = await encodeVideoToBase64(input.videoPath);

    const prompt = `
      You are an expert DEBATE JUDGE. Analyze this IMPROMPTU SPEECH recording.
      
      THEME: ${input.theme}
      QUOTE: ${input.quote}
      
      INSTRUCTIONS:
      1. TRANSCRIPT: Transcribe the speech exactly as spoken.
      2. BODY LANGUAGE: Analyze eye contact, posture, and gestures.
      3. SCORES: Give 1-10 scores for Structure, Content, and Delivery.
      4. DRILL: Provide one concrete practice exercise.
      
      Respond ONLY in valid JSON format with this structure:
      {
        "transcript": "...",
        "bodyLanguageAnalysis": "...",
        "feedback": {
          "contentSummary": "2-3 sentence summary",
          "scores": { "structure": 0, "content": 0, "delivery": 0 },
          "strengths": ["...", "..."],
          "improvements": ["...", "..."],
          "practiceDrill": "..."
        }
      }
    `;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000", 
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
    });

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
    
    console.log('✅ Analysis successful!');
    return {
      success: true,
      transcript: analysis.transcript,
      bodyLanguageAnalysis: analysis.bodyLanguageAnalysis,
      feedback: analysis.feedback,
    };

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Analysis failed:', msg);
    return {
      success: false,
      transcript: '',
      bodyLanguageAnalysis: '',
      feedback: {
        scores: { structure: 0, content: 0, delivery: 0 },
        strengths: [],
        improvements: [],
        practiceDrill: '',
        contentSummary: ''
      },
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
