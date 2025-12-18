/**
 * Speech Recognition Client Module
 * 
 * Supports multiple Alibaba Cloud DashScope models:
 * 1. Paraformer - Dedicated ASR model (best for pure transcription)
 * 2. Qwen-Audio - Multimodal audio model (fallback)
 * 
 * SETUP:
 * 1. Get API key from: https://dashscope.console.aliyun.com/
 * 2. Enable Paraformer model in Model Plaza
 * 3. Add to .env: QWEN_AUDIO_API_KEY=your_key
 */

import fs from 'fs';
import path from 'path';

// ===========================================
// CONFIGURATION
// ===========================================

function getApiKey(): string {
  return process.env.QWEN_AUDIO_API_KEY || '';
}

// ===========================================
// TYPES
// ===========================================

interface TranscriptionResult {
  success: boolean;
  transcript?: string;
  error?: string;
}

interface ParaformerTaskResponse {
  request_id?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    results?: Array<{
      transcription_url?: string;
      subtask_status?: string;
    }>;
  };
  code?: string;
  message?: string;
}

interface TranscriptionContent {
  transcripts?: Array<{
    text?: string;
    sentences?: Array<{
      text?: string;
    }>;
  }>;
}

// ===========================================
// HELPER FUNCTIONS
// ===========================================

function audioFileToBase64(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return fileBuffer.toString('base64');
}

function getAudioFormat(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const formats: Record<string, string> = {
    '.mp3': 'mp3', '.wav': 'wav', '.flac': 'flac',
    '.m4a': 'm4a', '.ogg': 'ogg', '.webm': 'webm',
  };
  return formats[ext] || 'wav';
}

// Sleep helper for polling
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===========================================
// PARAFORMER API (Real-time Recognition)
// ===========================================

/**
 * Use Paraformer real-time API with local audio data
 * This uses the synchronous recognition endpoint
 */
async function tryParaformerRealtime(
  audioFilePath: string,
  apiKey: string
): Promise<TranscriptionResult> {
  console.log('📡 Trying Paraformer Real-time API...');
  
  // Paraformer real-time uses WebSocket, which is complex
  // Instead, let's try the HTTP streaming endpoint
  const apiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/recognition';
  
  // Read audio file
  const audioBuffer = fs.readFileSync(audioFilePath);
  const audioBase64 = audioBuffer.toString('base64');
  
  const requestBody = {
    model: 'paraformer-realtime-v2',
    input: {
      audio: audioBase64,
      format: getAudioFormat(audioFilePath),
      sample_rate: 16000,
    },
    parameters: {
      language_hints: ['zh', 'en'], // Support Chinese and English
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    console.log('   Paraformer response status:', response.status);
    
    if (!response.ok) {
      console.log('   Paraformer error:', responseText.substring(0, 200));
      return { success: false, error: `Paraformer API error: ${responseText}` };
    }

    const data = JSON.parse(responseText);
    
    // Extract transcript from response
    const transcript = data.output?.text || data.output?.sentence?.text;
    
    if (transcript) {
      console.log('✅ Paraformer transcription successful!');
      return { success: true, transcript };
    }
    
    return { success: false, error: 'No transcript in Paraformer response' };
  } catch (error) {
    console.log('   Paraformer error:', error instanceof Error ? error.message : error);
    return { success: false, error: `Paraformer failed: ${error}` };
  }
}

// ===========================================
// QWEN-AUDIO MULTIMODAL API
// ===========================================

/**
 * Try Qwen-Audio multimodal API
 */
async function tryQwenAudioMultimodal(
  audioBase64: string,
  audioFormat: string,
  apiKey: string
): Promise<TranscriptionResult> {
  console.log('📡 Trying Qwen-Audio Multimodal API...');
  
  const apiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  
  // Model names to try
  const models = ['qwen-audio-turbo', 'qwen-audio-chat', 'qwen2-audio-instruct'];
  
  for (const model of models) {
    console.log(`   Trying model: ${model}`);
    
    const requestBody = {
      model,
      input: {
        messages: [{
          role: 'user',
          content: [
            { audio: `data:audio/${audioFormat};base64,${audioBase64}` },
            { text: `You are a professional speech transcription engine.

Task:
- Transcribe the attached audio of an IMPROMPTU SPEECH into clear, well-punctuated English text.
- Preserve the speaker's wording as closely as possible.

Rules:
- Do NOT summarize, correct, or rewrite the content.
- Keep filler words like "um", "uh", "like", "you know" whenever they are clearly spoken.
- Use normal sentence punctuation and paragraphing so it's easy to read.
- Do NOT add timestamps, labels, or analysis.
- Output ONLY the raw transcript text, nothing else.` },
          ],
        }],
      },
      parameters: { result_format: 'message' },
    };

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        if (responseText.includes('model_not_found') || responseText.includes('does not exist')) {
          continue; // Try next model
        }
        continue;
      }

      const data = JSON.parse(responseText);
      
      // Check for errors
      if (data.code && data.code !== 'Success' && data.code !== '200') {
        if (data.code === 'ModelNotFound') continue;
        continue;
      }

      // Extract transcript
      let transcript: string | undefined;
      if (data.output?.text) {
        transcript = data.output.text;
      } else if (data.output?.choices?.[0]?.message?.content) {
        const content = data.output.choices[0].message.content;
        transcript = typeof content === 'string' ? content : content?.[0]?.text;
      }

      if (transcript) {
        console.log(`✅ Success with model: ${model}`);
        return { success: true, transcript: transcript.trim() };
      }
    } catch (error) {
      continue;
    }
  }

  return { success: false, error: 'All Qwen-Audio models failed' };
}

// ===========================================
// SENSEVOICE API (Alternative ASR)
// ===========================================

/**
 * Try SenseVoice model - another DashScope ASR option
 */
async function trySenseVoice(
  audioBase64: string,
  audioFormat: string,
  apiKey: string
): Promise<TranscriptionResult> {
  console.log('📡 Trying SenseVoice API...');
  
  const apiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
  
  const requestBody = {
    model: 'sensevoice-v1',
    input: {
      audio: audioBase64,
      format: audioFormat,
      sample_rate: 16000,
    },
    parameters: {
      language_hints: ['zh', 'en'],
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    console.log('   SenseVoice response status:', response.status);
    
    if (!response.ok) {
      return { success: false, error: `SenseVoice error: ${responseText}` };
    }

    const data = JSON.parse(responseText);
    const transcript = data.output?.text || data.output?.transcription;
    
    if (transcript) {
      console.log('✅ SenseVoice transcription successful!');
      return { success: true, transcript };
    }
    
    return { success: false, error: 'No transcript in SenseVoice response' };
  } catch (error) {
    return { success: false, error: `SenseVoice failed: ${error}` };
  }
}

// ===========================================
// MAIN TRANSCRIPTION FUNCTION
// ===========================================

/**
 * Transcribe audio using available DashScope models
 * Tries multiple APIs in order of preference
 */
export async function transcribeAudio(audioFilePath: string): Promise<TranscriptionResult> {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.error('❌ QWEN_AUDIO_API_KEY is not set');
    return {
      success: false,
      error: 'API key not configured. Add QWEN_AUDIO_API_KEY to .env file.',
    };
  }

  if (!fs.existsSync(audioFilePath)) {
    return { success: false, error: `Audio file not found: ${audioFilePath}` };
  }

  console.log('\n🎤 Starting speech transcription...');
  console.log('   Audio file:', audioFilePath);
  // Never log API keys (even partially) in server logs

  const audioBase64 = audioFileToBase64(audioFilePath);
  const audioFormat = getAudioFormat(audioFilePath);
  
  console.log('   Format:', audioFormat);
  console.log('   Size:', (audioBase64.length * 0.75 / 1024 / 1024).toFixed(2), 'MB');

  // Try methods in order of preference
  const methods = [
    () => tryQwenAudioMultimodal(audioBase64, audioFormat, apiKey),
    // These endpoints frequently fail for accounts that don't have HTTP access enabled.
    // Keep them as fallbacks (after multimodal) to avoid slow 400s dominating the happy path.
    () => trySenseVoice(audioBase64, audioFormat, apiKey),
    () => tryParaformerRealtime(audioFilePath, apiKey),
  ];

  for (const method of methods) {
    const result = await method();
    if (result.success) {
      return result;
    }
    console.log('   Failed:', result.error?.substring(0, 100));
  }

  // All methods failed
  return {
    success: false,
    error: `All transcription methods failed. Please check:\n` +
           `1. Go to dashscope.console.aliyun.com\n` +
           `2. Enable Paraformer or Qwen-Audio in Model Plaza\n` +
           `3. Make sure your API key has access to these models`,
  };
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

export function isQwenAudioConfigured(): boolean {
  const apiKey = getApiKey();
  return Boolean(apiKey);
}

export function getQwenAudioStatus(): { configured: boolean; apiKeyPreview: string } {
  const apiKey = getApiKey();
  return {
    configured: Boolean(apiKey),
    apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : 'NOT SET',
  };
}
