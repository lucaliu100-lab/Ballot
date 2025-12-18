/**
 * Qwen2.5-VL Video Analysis Client
 * 
 * This module handles body language analysis using Qwen2.5-VL (Vision-Language model).
 * It analyzes video frames to provide feedback on:
 * - Eye contact
 * - Posture
 * - Hand gestures
 * - Fidgeting/swaying
 * 
 * SETUP:
 * 1. Get API key from: https://dashscope.console.aliyun.com/
 * 2. Enable Qwen-VL model in Model Plaza
 * 3. Add to .env:
 *    QWEN_VL_API_KEY=your_key
 *    QWEN_VL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
 */

// ===========================================
// CONFIGURATION
// ===========================================

/**
 * Get API key - using lazy evaluation to ensure env vars are loaded
 */
function getApiKey(): string {
  // Try VL-specific key first, then fall back to general audio key
  return process.env.QWEN_VL_API_KEY || process.env.QWEN_AUDIO_API_KEY || '';
}

/**
 * Get base URL for the API
 */
function getBaseUrl(): string {
  return process.env.QWEN_VL_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
}

/**
 * Get model name (if specified in env, otherwise we'll try multiple)
 */
function getModel(): string {
  return process.env.QWEN_VL_MODEL || '';
}

// ===========================================
// TYPES
// ===========================================

/**
 * OpenAI-compatible response format for vision models
 */
interface VLResponse {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
}

/**
 * Result of body language analysis
 */
interface AnalysisResult {
  success: boolean;
  summary?: string;
  error?: string;
}

// ===========================================
// BODY LANGUAGE ANALYSIS PROMPT
// ===========================================

const BODY_LANGUAGE_PROMPT = `You are a body-language coach evaluating an IMPROMPTU SPEECH.

You are given a series of video frames taken every few seconds from the same speech.
Look across ALL frames together, not just one frame, and infer patterns.

For the speaker's BODY LANGUAGE, analyze:

- Eye contact: how often do they look at the camera vs away?
- Posture: upright vs slouched; relaxed vs stiff.
- Hand gestures: none / occasional / frequent; are they purposeful or distracting?
- Movement and fidgeting: still / natural movement / pacing / swaying / fidgeting.
- Facial expression and energy: flat / neutral / expressive; confident vs nervous.

Output a SHORT, concrete analysis in 3–6 sentences:
- Mention at least one clear strength.
- Mention at least one specific behavior to improve.
- Refer to visible behaviors (e.g., "often looks down to the side", "hands stay out of frame").

Do NOT score or grade. Do NOT comment on the content of the speech.
Just describe and evaluate visible delivery.`;

// ===========================================
// MAIN ANALYSIS FUNCTION
// ===========================================

/**
 * Analyze body language from video frames using Qwen2.5-VL
 * 
 * @param frames - Array of image buffers (PNG/JPEG frames from video)
 * @returns Promise with analysis summary or error
 * 
 * EXAMPLE USAGE:
 * ```typescript
 * const frames = [frameBuffer1, frameBuffer2, frameBuffer3];
 * const result = await analyzeBodyLanguageFromFrames(frames);
 * if (result.success) {
 *   console.log('Analysis:', result.summary);
 * }
 * ```
 */
export async function analyzeBodyLanguageFromFrames(
  frames: Buffer[]
): Promise<AnalysisResult> {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const specifiedModel = getModel();

  // Validate API key
  if (!apiKey) {
    console.error('❌ QWEN_VL_API_KEY is not set');
    return {
      success: false,
      error: 'Qwen VL API key not configured. Add QWEN_VL_API_KEY to .env file.',
    };
  }

  // Validate frames
  if (!frames || frames.length === 0) {
    return {
      success: false,
      error: 'No frames provided for analysis',
    };
  }

  console.log('\n🎬 Starting body language analysis...');
  console.log('   Number of frames:', frames.length);
  console.log('   API Key:', `${apiKey.substring(0, 8)}...`);
  console.log('   Base URL:', baseUrl);

  // Convert frames to base64 for the API
  const frameImages = frames.map((frame, index) => {
    const base64 = frame.toString('base64');
    console.log(`   Frame ${index + 1} size:`, (base64.length * 0.75 / 1024).toFixed(1), 'KB');
    return {
      type: 'image_url' as const,
      image_url: {
        url: `data:image/jpeg;base64,${base64}`,
      },
    };
  });

  // Models to try (in order of preference)
  const modelsToTry = specifiedModel 
    ? [specifiedModel]
    : [
        'qwen-vl-plus',           // Most commonly available
        'qwen-vl-max',            // Higher quality
        'qwen2-vl-7b-instruct',   // Newer version
        'qwen2.5-vl-7b-instruct', // Latest version
        'qwen-vl-chat-v1',        // Legacy version
      ];

  // Build the message content with frames and prompt
  const messageContent = [
    ...frameImages,
    {
      type: 'text' as const,
      text: BODY_LANGUAGE_PROMPT,
    },
  ];

  // Try each model until one works
  for (const model of modelsToTry) {
    console.log(`\n📡 Trying model: ${model}`);

    // Build OpenAI-compatible request
    const requestBody = {
      model,
      messages: [
        {
          role: 'user',
          content: messageContent,
        },
      ],
      max_tokens: 500,
    };

    try {
      const apiUrl = `${baseUrl}/chat/completions`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      const responseText = await response.text();

      // Check HTTP status
      if (!response.ok) {
        console.log(`   Model ${model} HTTP error:`, response.status);
        
        // If model not found, try next model
        if (responseText.includes('model_not_found') || 
            responseText.includes('does not exist') ||
            responseText.includes('InvalidModel')) {
          console.log(`   Model ${model} not available, trying next...`);
          continue;
        }
        
        // For other errors, log and continue
        console.log(`   Error response:`, responseText.substring(0, 200));
        continue;
      }

      // Parse response
      let data: VLResponse;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.log(`   Failed to parse response as JSON`);
        continue;
      }

      // Check for API-level errors
      if (data.error) {
        console.log(`   API error:`, data.error.message || data.error.code);
        if (data.error.code === 'model_not_found' || 
            data.error.code === 'InvalidModel') {
          continue;
        }
        continue;
      }

      // Extract the analysis from the response
      const summary = data.choices?.[0]?.message?.content;

      if (summary) {
        console.log(`✅ Body language analysis successful with model: ${model}`);
        console.log(`   Summary length: ${summary.length} characters`);
        return {
          success: true,
          summary: summary.trim(),
        };
      }

      console.log(`   No content in response from ${model}`);
    } catch (error) {
      console.log(`   Error with model ${model}:`, error instanceof Error ? error.message : error);
      continue;
    }
  }

  // All models failed
  return {
    success: false,
    error: `Unable to analyze video. Please check:\n` +
           `1. Go to dashscope.console.aliyun.com\n` +
           `2. Enable Qwen-VL model in Model Plaza\n` +
           `3. Make sure your API key has access to vision models`,
  };
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

/**
 * Check if the Qwen VL API is configured
 */
export function isQwenVLConfigured(): boolean {
  const apiKey = getApiKey();
  return Boolean(apiKey);
}

/**
 * Get configuration status for debugging
 */
export function getQwenVLStatus(): {
  configured: boolean;
  baseUrl: string;
  model: string;
} {
  return {
    configured: isQwenVLConfigured(),
    baseUrl: getBaseUrl(),
    model: getModel() || '(auto-detect)',
  };
}




