/**
 * RecordScreen Component
 * 
 * This is the main recording screen that:
 * 1. Shows a camera preview using MediaDevices.getUserMedia
 * 2. Displays countdown timer (5 min + remaining prep time)
 * 3. Records audio + video using MediaRecorder API
 * 4. Uploads the recorded blob to the backend
 * 
 * Features:
 * - Large video preview that takes most of the screen
 * - Start recording button positioned inside the video frame
 * - Button fades when recording starts
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { UploadResponse } from '../types';
import { API_ENDPOINTS } from '../lib/constants';

// Constants
const DEFAULT_RECORDING_DURATION = 300; // 5 minutes in seconds (fallback)
const GRACE_PERIOD = 15; // 15 seconds grace period after time expires
// Reduce upload size by lowering resolution + bitrate (good enough for body-language cues)
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640, max: 640 },
  height: { ideal: 480, max: 480 },
  frameRate: { ideal: 24, max: 24 },
  facingMode: 'user',
};

// Target bitrates (browsers may ignore these, but most Chromium-based ones respect them)
const RECORDER_BITS = {
  videoBitsPerSecond: 900_000, // ~0.9 Mbps video
  audioBitsPerSecond: 96_000,  // ~96 kbps audio
} as const;

// Props that this component receives from its parent
interface RecordScreenProps {
  theme: string;                                // Theme of the round (sent to backend for scoring context)
  selectedQuote: string;                        // The quote to display during recording
  remainingPrepTime?: number;                   // Remaining prep time in seconds (added to base duration)
  baseDuration?: number;                        // Base recording duration (format-specific)
  onUploadComplete: (response: UploadResponse) => void;  // Called after successful upload
}

function RecordScreen({ 
  theme,
  selectedQuote, 
  remainingPrepTime = 0,
  baseDuration = DEFAULT_RECORDING_DURATION,
  onUploadComplete 
}: RecordScreenProps) {
  // ==========================================
  // STATE MANAGEMENT
  // ==========================================
  
  // Recording state: 'idle' | 'recording' | 'stopped' | 'uploading'
  const [recordingState, setRecordingState] = useState<string>('idle');
  
  // Error message if something goes wrong
  const [error, setError] = useState<string | null>(null);
  
  // The recorded video blob (binary data)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  
  // URL to preview the recorded video
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  // Custom video player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  // Total available time (base duration + remaining prep time)
  const totalTime = baseDuration + remainingPrepTime;

  // Countdown timer (time remaining to record) - can go negative up to -GRACE_PERIOD
  const [timeRemaining, setTimeRemaining] = useState<number>(totalTime);

  // Recording duration (how long we've been recording)
  const [recordingDuration, setRecordingDuration] = useState<number>(0);

  // ==========================================
  // REFS (persistent references across renders)
  // ==========================================
  
  // Reference to the video element showing camera preview
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Reference to the video element showing recorded preview
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  
  // Reference to the MediaRecorder instance
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  
  // Reference to the media stream (camera + microphone)
  const streamRef = useRef<MediaStream | null>(null);
  
  // Array to store recorded video chunks
  const chunksRef = useRef<Blob[]>([]);

  // Abort controller for an in-flight upload request (prevents late completion changing app state)
  const uploadAbortRef = useRef<AbortController | null>(null);

  // Track mount state to avoid setting state after unmount
  const isMountedRef = useRef(true);

  // Reference to the countdown timer interval
  const countdownRef = useRef<number | null>(null);

  // Reference to the recording duration timer
  const durationRef = useRef<number | null>(null);

  // Format seconds into MM:SS display (handles negative numbers for grace period)
  const formatTime = useCallback((seconds: number): string => {
    const isNegative = seconds < 0;
    const absSeconds = Math.abs(seconds);
    const mins = Math.floor(absSeconds / 60);
    const secs = absSeconds % 60;
    const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return isNegative ? `-${timeStr}` : timeStr;
  }, []);

  // Start the countdown timer (allows going negative for grace period)
  const startCountdown = useCallback(() => {
    setTimeRemaining(totalTime);
    countdownRef.current = window.setInterval(() => {
      setTimeRemaining((prev) => {
        // Grace period: allow timer to go to -GRACE_PERIOD before stopping
        if (prev <= -GRACE_PERIOD) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
          }
          return -GRACE_PERIOD;
        }
        return prev - 1;
      });
    }, 1000);
  }, [totalTime]);

  // Start recording duration timer
  const startDurationTimer = useCallback(() => {
    setRecordingDuration(0);
    durationRef.current = window.setInterval(() => {
      setRecordingDuration((prev) => prev + 1);
    }, 1000);
  }, []);

  // Stop all timers
  const stopTimers = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    // React 18 StrictMode runs effects (setup/cleanup) twice in dev.
    // Ensure we always mark ourselves mounted when the effect runs.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopTimers();

      // Cancel any in-flight upload so it can't complete later and jump the app to processing/report
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
    };
  }, [stopTimers]);

  // Auto-stop recording when countdown reaches -GRACE_PERIOD (end of grace period)
  useEffect(() => {
    if (timeRemaining <= -GRACE_PERIOD && recordingState === 'recording') {
      stopRecording();
    }
  }, [timeRemaining, recordingState]);

  // ==========================================
  // SETUP: Request camera access on mount
  // ==========================================
  useEffect(() => {
    // Function to initialize camera and microphone
    const initializeMedia = async () => {
      try {
        // Request access to camera and microphone
        // This will prompt the user for permission
        const stream = await navigator.mediaDevices.getUserMedia({
          video: VIDEO_CONSTRAINTS,
          audio: true,
        });

        // CRITICAL: Verify that we actually got an audio track
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        
        console.log(`🎤 Media stream initialized: ${videoTracks.length} video track(s), ${audioTracks.length} audio track(s)`);
        
        if (audioTracks.length === 0) {
          // Audio permission denied or no microphone available
          setError(
            '⚠️ No microphone detected. Your recording will have no audio and cannot be scored. Please check your microphone permissions and device settings, then refresh the page.'
          );
        } else {
          console.log(`✅ Audio track active: ${audioTracks[0].label || 'default'}`);
        }

        // Store the stream reference
        streamRef.current = stream;

        // Connect the stream to the video element for preview
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        // Handle errors (user denied permission, no camera, etc.)
        console.error('Failed to access camera/microphone:', err);
        setError(
          'Unable to access camera/microphone. Please allow permissions and try again.'
        );
      }
    };

    initializeMedia();

    // Cleanup: stop all tracks when component unmounts
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ==========================================
  // RECORDING FUNCTIONS
  // ==========================================

  /**
   * Start recording video and audio
   */
  const startRecording = () => {
    // Make sure we have a stream
    if (!streamRef.current) {
      setError('No media stream available');
      return;
    }

    // CRITICAL: Verify audio tracks exist before recording
    const audioTracks = streamRef.current.getAudioTracks();
    if (audioTracks.length === 0) {
      setError(
        '❌ Cannot start recording: No microphone detected. Please check your microphone permissions and device settings, then refresh the page.'
      );
      return;
    }

    // Reset chunks array for new recording
    chunksRef.current = [];

    // Create MediaRecorder with the stream
    // Try to use webm format with explicit audio codec (opus)
    let mimeType = 'video/webm';
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
      mimeType = 'video/webm;codecs=vp9,opus'; // VP9 video + Opus audio
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
      mimeType = 'video/webm;codecs=vp8,opus'; // VP8 video + Opus audio (wider support)
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=opus')) {
      mimeType = 'video/webm;codecs=opus'; // Fallback: just ensure opus audio
    }
    
    console.log(`🎥 Recording with MIME type: ${mimeType}`);

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType,
      ...RECORDER_BITS,
    });

    // Event handler: called when data is available
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    // Event handler: called when recording stops
    mediaRecorder.onstop = async () => {
      // Combine all chunks into a single blob
      const blob = new Blob(chunksRef.current, { type: mimeType });
      
      // CRITICAL: Verify the recorded blob actually has audio before proceeding
      try {
        const arrayBuffer = await blob.arrayBuffer();
        
        // Check file size - audio+video should be at least ~50KB even for very short recordings
        if (arrayBuffer.byteLength < 50000) {
          // File is suspiciously small (likely video-only or corrupted)
          console.error('❌ Recorded file is too small:', (arrayBuffer.byteLength / 1024).toFixed(1), 'KB');
          setError('⚠️ Recording failed: Audio was not captured. This can happen with certain browsers/devices. Please try: 1) Use Chrome/Edge instead of Safari, 2) Check System Settings → Privacy → Microphone, 3) Refresh page and try again.');
          setRecordingState('idle');
          return;
        }
        
        console.log(`✅ Recording validated: ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB`);
      } catch (validationError) {
        console.error('⚠️ Could not validate recording:', validationError);
        // Continue anyway - validation is best-effort
      }
      
      setRecordedBlob(blob);
      
      // Create a URL for preview
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      
      setRecordingState('stopped');
      stopTimers();
    };

    // Store reference and start recording
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(1000); // Collect data every 1 second
    setRecordingState('recording');
    startCountdown();
    startDurationTimer();
  };

  /**
   * Stop the current recording
   */
  const stopRecording = () => {
    if (mediaRecorderRef.current && recordingState === 'recording') {
      mediaRecorderRef.current.stop();
      stopTimers();
    }
  };

  // Custom video player controls
  const handlePlayPause = () => {
    const video = previewVideoRef.current;
    if (!video) return;
    
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    const video = previewVideoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
  };

  const handleLoadedMetadata = () => {
    const video = previewVideoRef.current;
    if (!video) return;
    // Use recorded duration as fallback if video metadata duration is unreliable
    const metaDuration = video.duration;
    const actualDuration = Number.isFinite(metaDuration) && metaDuration > 0 
      ? metaDuration 
      : recordingDuration;
    setVideoDuration(actualDuration);
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = previewVideoRef.current;
    if (!video || videoDuration <= 0) return;
    
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = clickX / rect.width;
    const newTime = percent * videoDuration;
    
    video.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const progressPercent = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0;

  /**
   * Upload the recorded video to the backend
   */
  const uploadRecording = async () => {
    if (!recordedBlob) {
      setError('No recording to upload');
      return;
    }

    setRecordingState('uploading');
    setError(null);

    try {
      // Cancel any previous in-flight upload attempt
      uploadAbortRef.current?.abort();
      const controller = new AbortController();
      uploadAbortRef.current = controller;

      // Create FormData to send the file
      const formData = new FormData();
      formData.append('file', recordedBlob, 'recording.webm');
      // Provide duration hint to backend for robustness (some WebM containers lack duration metadata).
      formData.append('durationSeconds', String(recordingDuration));
      // Provide round context so the backend doesn't fall back to a default theme.
      formData.append('theme', theme);
      formData.append('quote', selectedQuote);

      // Send to our backend
      const response = await fetch(API_ENDPOINTS.upload, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        let details = '';
        try {
          if (contentType.includes('application/json')) {
            const json = await response.json();
            details = json?.error ? String(json.error) : JSON.stringify(json);
          } else {
            details = await response.text();
          }
        } catch {
          // ignore parsing failures; fallback to generic below
        }

        const suffix = details ? `: ${details}` : '';
        throw new Error(`Upload failed (${response.status})${suffix}`);
      }

      const data: UploadResponse = await response.json();
      console.log('✅ Upload succeeded:', data);
      
      // Notify parent component of success
      if (isMountedRef.current) {
        // Defensive: if the parent transition fails for any reason,
        // don't leave this screen stuck in the "uploading" state.
        setRecordingState('stopped');
        console.log('➡️ Transitioning to processing screen...');
        try {
          onUploadComplete(data);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error('❌ onUploadComplete threw:', message);
          setError(`Failed to advance after upload: ${message}`);
          setRecordingState('stopped');
        }
      }
    } catch (err) {
      // If the request was aborted (e.g., user navigated away), do nothing noisy
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Upload failed');
        setRecordingState('stopped');
      }
    }
  };

  // ==========================================
  // RENDER UI
  // ==========================================

  return (
    <div style={styles.container}>
      {/* Quote display - compact at top */}
      <div style={styles.quoteBar}>
        <p style={styles.quoteText}>"{selectedQuote}"</p>
      </div>

      {/* Main video area - takes most of the screen */}
      <div style={styles.videoWrapper}>
        <div style={styles.videoContainer}>
          {/* Camera preview (shown when not reviewing a recording) */}
          {!previewUrl && (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={styles.video}
              className="video-preview"
            />
          )}
          
          {/* Recording preview (shown after recording stops) */}
          {previewUrl && (
            <>
              <video
                ref={previewVideoRef}
                src={previewUrl}
                playsInline
                preload="auto"
                style={styles.previewVideo}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={handleVideoEnded}
                onClick={handlePlayPause}
              />
              {/* Custom video controls overlay */}
              <div style={styles.customControls}>
                <button onClick={handlePlayPause} style={styles.playPauseBtn}>
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <div style={styles.progressContainer} onClick={handleSeek}>
                  <div style={styles.progressTrack}>
                    <div 
                      style={{
                        ...styles.progressFill,
                        width: `${progressPercent}%`,
                      }} 
                    />
                    <div 
                      style={{
                        ...styles.progressThumb,
                        left: `${progressPercent}%`,
                      }} 
                    />
                  </div>
                </div>
                <span style={styles.timeDisplay}>
                  {formatTime(Math.floor(currentTime))} / {formatTime(Math.floor(videoDuration))}
                </span>
              </div>
            </>
          )}

          {/* Timer overlay - top right */}
          <div style={styles.timerOverlay}>
            <div style={{
              ...styles.timerBox,
              background: timeRemaining < 0 ? 'rgba(220, 38, 38, 0.9)' : 'rgba(0, 0, 0, 0.7)',
            }}>
              <span style={styles.timerLabel}>
                {timeRemaining < 0 
                  ? 'GRACE PERIOD' 
                  : recordingState === 'recording' 
                    ? 'TIME LEFT' 
                    : 'AVAILABLE'}
              </span>
              <span style={{
                ...styles.timerValue,
                color: timeRemaining < 0 
                  ? '#ffffff'
                  : timeRemaining < 60 && recordingState === 'recording' 
                    ? '#ef4444' 
                    : '#ffffff',
              }}>
                {formatTime(timeRemaining)}
              </span>
              {timeRemaining < 0 && (
                <span style={styles.graceHint}>Recording will stop automatically</span>
              )}
            </div>
          </div>

          {/* Recording indicator - top left */}
          {recordingState === 'recording' && (
            <div style={styles.recordingIndicator}>
              <span style={styles.recordingDot}>●</span>
              <span>REC</span>
              <span style={styles.recordingDuration}>{formatTime(recordingDuration)}</span>
            </div>
          )}

          {/* Start Recording Button - inside video frame, center bottom */}
          {recordingState === 'idle' && (
            <button
              onClick={startRecording}
              style={styles.startButtonInFrame}
            >
              <span style={styles.startIcon}>●</span>
              Start Recording
            </button>
          )}

          {/* Stop Recording Button - inside video frame, faded appearance */}
          {recordingState === 'recording' && (
            <button
              onClick={stopRecording}
              style={styles.stopButtonInFrame}
            >
              <span style={styles.stopIcon}>■</span>
              Stop Recording
            </button>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div style={styles.error}>
            {error}
          </div>
        )}

        {/* Post-recording controls - below video */}
        {recordingState === 'stopped' && (
          <div style={styles.postRecordControls}>
            <button
              onClick={uploadRecording}
              style={styles.uploadButton}
            >
              Upload Recording
            </button>
          </div>
        )}

        {/* Uploading indicator */}
        {recordingState === 'uploading' && (
          <div style={styles.postRecordControls}>
            <button disabled style={styles.uploadingButton}>
              Uploading...
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Styles for this component
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0a0a0a',
    padding: '16px',
  },
  quoteBar: {
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '8px',
    padding: '12px 20px',
    marginBottom: '16px',
  },
  quoteText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '0.95rem',
    margin: 0,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  videoWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  videoContainer: {
    position: 'relative',
    flex: 1,
    borderRadius: '12px',
    overflow: 'hidden',
    background: '#000',
    border: '2px solid rgba(255, 255, 255, 0.1)',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  // Preview video after recording - use 'contain' so controls work properly
  previewVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    background: '#000',
    cursor: 'pointer',
  },
  // Custom video controls
  customControls: {
    position: 'absolute',
    bottom: '0',
    left: '0',
    right: '0',
    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
    padding: '20px 16px 16px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  playPauseBtn: {
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    color: '#ffffff',
    fontSize: '1.2rem',
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  progressContainer: {
    flex: 1,
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
  },
  progressTrack: {
    width: '100%',
    height: '6px',
    background: 'rgba(255,255,255,0.3)',
    borderRadius: '3px',
    position: 'relative',
  },
  progressFill: {
    height: '100%',
    background: '#10b981',
    borderRadius: '3px',
    transition: 'width 0.1s linear',
  },
  progressThumb: {
    position: 'absolute',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: '14px',
    height: '14px',
    background: '#ffffff',
    borderRadius: '50%',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
  },
  timeDisplay: {
    color: '#ffffff',
    fontSize: '0.85rem',
    fontFamily: 'monospace',
    minWidth: '90px',
    textAlign: 'right',
    flexShrink: 0,
  },
  timerOverlay: {
    position: 'absolute',
    top: '20px',
    right: '20px',
  },
  timerBox: {
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(10px)',
    borderRadius: '12px',
    padding: '12px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  timerLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '1px',
    marginBottom: '4px',
  },
  timerValue: {
    color: '#ffffff',
    fontSize: '1.8rem',
    fontWeight: 700,
    fontFamily: 'monospace',
  },
  graceHint: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '0.65rem',
    fontWeight: 500,
    marginTop: '4px',
    textAlign: 'center',
  },
  recordingIndicator: {
    position: 'absolute',
    top: '20px',
    left: '20px',
    background: 'rgba(220, 38, 38, 0.9)',
    backdropFilter: 'blur(10px)',
    color: '#ffffff',
    padding: '10px 20px',
    borderRadius: '12px',
    fontSize: '0.9rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  recordingDot: {
    animation: 'blink 1s infinite',
    fontSize: '1.2rem',
  },
  recordingDuration: {
    fontFamily: 'monospace',
    fontSize: '0.9rem',
  },
  // Start button - solid white, positioned inside video frame at bottom center
  startButtonInFrame: {
    position: 'absolute',
    bottom: '40px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(255, 255, 255, 0.95)',
    color: '#111111',
    border: 'none',
    padding: '18px 40px',
    fontSize: '1.1rem',
    fontWeight: 600,
    borderRadius: '50px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
    transition: 'all 0.2s ease',
  },
  startIcon: {
    color: '#dc2626',
    fontSize: '1.4rem',
  },
  // Stop button - faded appearance when recording
  stopButtonInFrame: {
    position: 'absolute',
    bottom: '40px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(255, 255, 255, 0.3)',
    color: '#ffffff',
    border: '2px solid rgba(255, 255, 255, 0.4)',
    padding: '18px 40px',
    fontSize: '1.1rem',
    fontWeight: 600,
    borderRadius: '50px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backdropFilter: 'blur(10px)',
    transition: 'all 0.2s ease',
  },
  stopIcon: {
    fontSize: '1rem',
  },
  error: {
    padding: '16px 20px',
    background: 'rgba(220, 38, 38, 0.1)',
    border: '1px solid #dc2626',
    borderRadius: '8px',
    color: '#ef4444',
    marginTop: '16px',
  },
  postRecordControls: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
    marginTop: '20px',
    paddingBottom: '20px',
  },
  uploadButton: {
    background: '#10b981',
    color: '#ffffff',
    border: 'none',
    padding: '16px 40px',
    fontSize: '1.1rem',
    fontWeight: 600,
    borderRadius: '50px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  uploadingButton: {
    background: 'rgba(255, 255, 255, 0.1)',
    color: 'rgba(255, 255, 255, 0.5)',
    border: 'none',
    padding: '16px 40px',
    fontSize: '1.1rem',
    fontWeight: 600,
    borderRadius: '50px',
    cursor: 'not-allowed',
  },
};

export default RecordScreen;
