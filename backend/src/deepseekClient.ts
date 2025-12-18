/**
 * DeepSeek Client Module
 * 
 * This module handles communication with the DeepSeek API for generating
 * comprehensive debate feedback based on transcript and body language analysis.
 * 
 * SETUP:
 * 1. Get your API key from: https://platform.deepseek.com/
 * 2. Add to .env: DEEPSEEK_API_KEY=your_key
 * 
 * MODEL: deepseek-chat (best for reasoning and analysis tasks)
 */

// ===========================================
// CONFIGURATION
// ===========================================

function getApiKey(): string {
  return process.env.DEEPSEEK_API_KEY || '';
}

function getBaseUrl(): string {
  return process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
}

function getModel(): string {
  return process.env.DEEPSEEK_MODEL || 'deepseek-chat';
}

// ===========================================
// TYPES
// ===========================================

interface DeepSeekResponse {
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
  };
}

interface FeedbackInput {
  transcript: string;
  bodyLanguageAnalysis: string;
  quote: string;        // The quote they were speaking about
  theme: string;        // The theme of the round
  durationSeconds?: number;    // Speech duration in seconds
  wordCount?: number;          // Total word count
  wordsPerMinute?: number;     // Speaking pace
  fillerCount?: number;        // Count of filler words
}

interface FeedbackResult {
  success: boolean;
  feedback?: {
    scores: {
      structure: number;    // 1-10 score for organization
      content: number;      // 1-10 score for analysis/reasoning
      delivery: number;     // 1-10 score for vocal/physical delivery
    };
    strengths: string[];           // List of specific strengths
    improvements: string[];        // List of specific improvements
    practiceDrill: string;         // One concrete drill to practice
    contentSummary: string;        // Brief summary of speech content
  };
  rawResponse?: string;
  error?: string;
}

// ===========================================
// DEBATE JUDGE PROMPT
// ===========================================

function buildDebateJudgePrompt(input: FeedbackInput): string {
  return `You are an experienced IMPROMPTU SPEAKING JUDGE.

Context:
- Event type: 7-minute impromptu speech based on a quotation.
- Your judging style: specific, honest, and constructive.
- Audience: high school student who wants to improve quickly.

Here is the speech data:

THEME:
${input.theme}

QUOTE:
${input.quote}

TRANSCRIPT:
${input.transcript}

DELIVERY STATS (approximate):
- Speech duration (seconds): ${input.durationSeconds ?? 'N/A'}
- Word count: ${input.wordCount ?? 'N/A'}
- Words per minute: ${input.wordsPerMinute ?? 'N/A'}
- Filler words count ("um", "uh", "like", "you know"): ${input.fillerCount ?? 'N/A'}

BODY LANGUAGE SUMMARY (from video model):
${input.bodyLanguageAnalysis}

Your task:
Evaluate this speech AS AN IMPROMPTU JUDGE, focusing on:
1) Structure (organization, intro/body/conclusion, clarity of main points)
2) Content (interpretation of the quote, depth of analysis, examples, logical reasoning)
3) Delivery (vocal variety, pacing, filler words, eye contact, posture, gestures, confidence)

Scoring:
- Give each of STRUCTURE, CONTENT, DELIVERY a score from 1 to 10 (integers).
- 10 = outstanding for high school competition; 1 = very weak.

Feedback style:
- Be SPECIFIC and CONCRETE.
- Refer to particular patterns in the transcript when possible (e.g., "You repeat the phrase 'I think' many times in the first minute", not just "avoid repetition").
- Use short bullet points, not long paragraphs.

Output format:
Return ONLY valid JSON, no extra text, matching exactly this schema:

{
  "contentSummary": "A 2-3 sentence objective summary of what the speaker talked about and their main argument.",
  "scores": {
    "structure": 0,
    "content": 0,
    "delivery": 0
  },
  "strengths": [
    "Short, specific bullet about something they did well."
  ],
  "improvements": [
    "Short, specific bullet about what to fix, referencing behavior, not vague advice."
  ],
  "practiceDrill": "One concrete drill the student can practice before their next speech."
}

Guidelines for content:
- In "contentSummary": briefly summarize the speaker's main argument and key points (2-3 sentences, factual, not evaluative).
- In "strengths": highlight 2–5 things (e.g., clear hook, good personal example, logical progression, confident tone).
- In "improvements": highlight 3–6 issues (e.g., weak conclusion, unclear thesis, too many fillers, pacing too fast, not enough analysis of quote).
- In "practiceDrill": give ONE focused exercise (e.g., "Record a 2-minute speech where you must pause for 1 full second between sentences to reduce rushing.").

Remember:
- DO NOT include comments outside JSON.
- DO NOT include quotes around numbers in scores.
- Be kind but direct: the goal is real improvement, not just encouragement.`;
}

// ===========================================
// MAIN FEEDBACK FUNCTION
// ===========================================

/**
 * Generate comprehensive debate feedback using DeepSeek
 * 
 * @param input - Transcript, body language analysis, quote, and theme
 * @returns FeedbackResult with structured feedback or error
 */
export async function generateDebateFeedback(
  input: FeedbackInput
): Promise<FeedbackResult> {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const model = getModel();

  // Validate API key
  if (!apiKey) {
    console.error('❌ DEEPSEEK_API_KEY is not set');
    return {
      success: false,
      error: 'DeepSeek API key not configured. Add DEEPSEEK_API_KEY to .env file.',
    };
  }

  console.log('\n🤖 Generating debate feedback with DeepSeek...');
  console.log('   Model:', model);
  console.log('   Theme:', input.theme);
  console.log('   Quote:', input.quote.substring(0, 50) + '...');

  try {
    // Build the prompt
    const prompt = buildDebateJudgePrompt(input);

    // Build OpenAI-compatible request
    const requestBody = {
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert debate judge and public speaking coach. Always respond with valid JSON only, no markdown formatting.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    };

    const apiUrl = `${baseUrl}/chat/completions`;
    console.log('   API URL:', apiUrl);
    console.log('   Sending request...');

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
      console.error('❌ DeepSeek API error:', response.status);
      console.error('   Response:', responseText.substring(0, 200));
      return {
        success: false,
        error: `DeepSeek API error (${response.status}): ${responseText}`,
      };
    }

    // Parse response
    let data: DeepSeekResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('❌ Failed to parse DeepSeek response');
      return {
        success: false,
        error: 'Invalid JSON response from DeepSeek',
      };
    }

    // Check for API-level errors
    if (data.error) {
      console.error('❌ DeepSeek error:', data.error.message);
      return {
        success: false,
        error: `DeepSeek error: ${data.error.message}`,
      };
    }

    // Extract the content
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return {
        success: false,
        error: 'No content in DeepSeek response',
      };
    }

    console.log('   Raw response received, parsing feedback...');

    // Parse the JSON feedback from the response
    try {
      // Clean the response (remove any markdown code blocks if present)
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.slice(7);
      }
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith('```')) {
        cleanContent = cleanContent.slice(0, -3);
      }
      cleanContent = cleanContent.trim();

      const feedback = JSON.parse(cleanContent);

      console.log('✅ Feedback generated successfully!');
      console.log('   Scores - Structure:', feedback.scores?.structure, 
                  'Content:', feedback.scores?.content, 
                  'Delivery:', feedback.scores?.delivery);

      return {
        success: true,
        feedback: {
          scores: {
            structure: feedback.scores?.structure ?? 5,
            content: feedback.scores?.content ?? 5,
            delivery: feedback.scores?.delivery ?? 5,
          },
          strengths: feedback.strengths || [],
          improvements: feedback.improvements || [],
          practiceDrill: feedback.practiceDrill || 'Practice speaking for 2 minutes on a random topic without filler words.',
          contentSummary: feedback.contentSummary || '',
        },
        rawResponse: content,
      };
    } catch (parseError) {
      console.error('❌ Failed to parse feedback JSON:', parseError);
      // Return the raw response if JSON parsing fails
      return {
        success: true,
        feedback: {
          scores: { structure: 5, content: 5, delivery: 5 },
          strengths: ['Feedback received but could not be parsed.'],
          improvements: [content.substring(0, 500)],
          practiceDrill: 'Review the raw feedback and practice accordingly.',
          contentSummary: '',
        },
        rawResponse: content,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ DeepSeek request failed:', errorMessage);
    return {
      success: false,
      error: `DeepSeek request failed: ${errorMessage}`,
    };
  }
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

/**
 * Check if DeepSeek API is configured
 */
export function isDeepSeekConfigured(): boolean {
  return Boolean(getApiKey());
}

/**
 * Get configuration status
 */
export function getDeepSeekStatus(): {
  configured: boolean;
  model: string;
} {
  return {
    configured: isDeepSeekConfigured(),
    model: getModel(),
  };
}

// Export types for use in other modules
export type { FeedbackInput, FeedbackResult };


