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
 * - Pre-recording acknowledgement modal for body language framing
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { UploadResponse, FramingData } from '../types';
import { API_ENDPOINTS } from '../lib/constants';

// Storage key for acknowledgement persistence (cleared on sign out)
const ACK_STORAGE_KEY = 'ballot_framing_acknowledged_session';

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

// Check if user has acknowledged (persists until sign out)
function hasAcknowledged(): boolean {
  try {
    return sessionStorage.getItem(ACK_STORAGE_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

// Save acknowledgement (will be cleared when browser session ends or user signs out)
function saveAcknowledgement(permanent: boolean): void {
  try {
    if (permanent) {
      // Use sessionStorage - persists until tab/browser closes or sign out clears it
      sessionStorage.setItem(ACK_STORAGE_KEY, 'true');
    } else {
      // Just for this page load
      sessionStorage.setItem(ACK_STORAGE_KEY, 'true');
    }
  } catch (e) {
    // Ignore storage errors
  }
}

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

  // Acknowledgement modal state - show immediately on mount if not already acknowledged
  const [showModal, setShowModal] = useState<boolean>(!hasAcknowledged());
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(false);

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

  // Reference to modal for focus management
  const modalRef = useRef<HTMLDivElement>(null);

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
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopTimers();
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
    };
  }, [stopTimers]);

  // Handle keyboard events for modal
  useEffect(() => {
    if (!showModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAcceptAcknowledgement();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Don't allow escape to close - user must acknowledge
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    modalRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showModal, dontShowAgain]);

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
    const initializeMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: VIDEO_CONSTRAINTS,
          audio: true,
        });

        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();
        
        console.log(`Media stream initialized: ${videoTracks.length} video, ${audioTracks.length} audio`);
        
        if (audioTracks.length === 0) {
          setError(
            'No microphone detected. Your recording will have no audio and cannot be scored. Please check your microphone permissions and refresh the page.'
          );
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Failed to access camera/microphone:', err);
        setError(
          'Unable to access camera/microphone. Please allow permissions and try again.'
        );
      }
    };

    initializeMedia();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ==========================================
  // ACKNOWLEDGEMENT HANDLERS
  // ==========================================

  const handleAcceptAcknowledgement = useCallback(() => {
    saveAcknowledgement(dontShowAgain);
    setShowModal(false);
  }, [dontShowAgain]);

  // ==========================================
  // RECORDING FUNCTIONS
  // ==========================================

  const startRecording = () => {
    if (!streamRef.current) {
      setError('No media stream available');
      return;
    }

    const audioTracks = streamRef.current.getAudioTracks();
    if (audioTracks.length === 0) {
      setError(
        'Cannot start recording: No microphone detected. Please check your microphone permissions and refresh the page.'
      );
      return;
    }

    chunksRef.current = [];

    let mimeType = 'video/webm';
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
      mimeType = 'video/webm;codecs=vp9,opus';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
      mimeType = 'video/webm;codecs=vp8,opus';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=opus')) {
      mimeType = 'video/webm;codecs=opus';
    }
    
    console.log(`Recording with MIME type: ${mimeType}`);

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType,
      ...RECORDER_BITS,
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      
      try {
        const arrayBuffer = await blob.arrayBuffer();
        
        if (arrayBuffer.byteLength < 50000) {
          console.error('Recorded file is too small:', (arrayBuffer.byteLength / 1024).toFixed(1), 'KB');
          setError('Recording failed: Audio was not captured. Please try Chrome/Edge, check microphone permissions, and refresh.');
          setRecordingState('idle');
          return;
        }
        
        console.log(`Recording validated: ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB`);
      } catch (validationError) {
        console.error('Could not validate recording:', validationError);
      }
      
      setRecordedBlob(blob);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setRecordingState('stopped');
      stopTimers();
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(1000);
    setRecordingState('recording');
    startCountdown();
    startDurationTimer();
  };

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

  const uploadRecording = async () => {
    if (!recordedBlob) {
      setError('No recording to upload');
      return;
    }

    setRecordingState('uploading');
    setError(null);

    try {
      uploadAbortRef.current?.abort();
      const controller = new AbortController();
      uploadAbortRef.current = controller;

      const formData = new FormData();
      formData.append('file', recordedBlob, 'recording.webm');
      formData.append('durationSeconds', String(recordingDuration));
      formData.append('theme', theme);
      formData.append('quote', selectedQuote);
      
      // Since user acknowledged, send framing as all true for body language assessment
      const framing: FramingData = {
        headVisible: true,
        torsoVisible: true,
        handsVisible: true,
      };
      formData.append('framing', JSON.stringify(framing));

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
          // ignore
        }

        const suffix = details ? `: ${details}` : '';
        throw new Error(`Upload failed (${response.status})${suffix}`);
      }

      const data: UploadResponse = await response.json();
      console.log('Upload succeeded:', data);
      
      if (isMountedRef.current) {
        setRecordingState('stopped');
        try {
          onUploadComplete(data);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error('onUploadComplete error:', message);
          setError(`Failed to advance after upload: ${message}`);
          setRecordingState('stopped');
        }
      }
    } catch (err) {
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
      {/* Acknowledgement Modal - shown immediately on page load */}
      {showModal && (
        <div style={styles.modalOverlay}>
          <div 
            ref={modalRef}
            style={styles.modalContent}
            tabIndex={-1}
          >
            <h2 style={styles.modalTitle}>Camera Position</h2>
            <p style={styles.modalText}>
              For accurate body language analysis, please ensure your <strong>face and torso</strong> are 
              visible, and your <strong>hands are visible</strong> at least periodically during your speech.
            </p>
            
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                style={styles.checkbox}
              />
              <span>Do not show again</span>
            </label>

            <button 
              onClick={handleAcceptAcknowledgement}
              style={styles.continueButton}
            >
              Continue
            </button>
            
            <p style={styles.modalHint}>
              Press Enter to continue
            </p>
          </div>
        </div>
      )}

      {/* Main video area */}
      <div style={styles.videoWrapper}>
        <div style={styles.videoContainer}>
          {/* Camera preview */}
          {!previewUrl && (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={styles.video}
            />
          )}
          
          {/* Recording preview */}
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
              <div style={styles.customControls}>
                <button onClick={handlePlayPause} style={styles.playPauseBtn}>
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <div style={styles.progressContainer} onClick={handleSeek}>
                  <div style={styles.progressTrack}>
                    <div style={{ ...styles.progressFill, width: `${progressPercent}%` }} />
                    <div style={{ ...styles.progressThumb, left: `${progressPercent}%` }} />
                  </div>
                </div>
                <span style={styles.timeDisplay}>
                  {formatTime(Math.floor(currentTime))} / {formatTime(Math.floor(videoDuration))}
                </span>
              </div>
            </>
          )}

          {/* Quote - absolutely centered */}
          <div style={styles.quoteCentered}>
            <p style={styles.quoteText}>"{selectedQuote}"</p>
          </div>

          {/* Top bar with recording indicator and timer */}
          <div style={styles.topBar}>
            {/* Recording indicator - left side */}
            {recordingState === 'recording' && (
              <div style={styles.recordingIndicator}>
                <span style={styles.recordingDot}>●</span>
                <span style={styles.recLabel}>REC</span>
                <span style={styles.recordingDuration}>{formatTime(recordingDuration)}</span>
              </div>
            )}
            
            {/* Spacer to push timer to the right */}
            <div style={{ flex: 1 }} />

            {/* Timer - right side */}
            <div style={styles.timerBox}>
              <span style={styles.timerLabel}>
                {timeRemaining < 0 
                  ? 'GRACE' 
                  : recordingState === 'recording' 
                    ? 'TIME LEFT' 
                    : 'AVAILABLE'}
              </span>
              <span style={{
                ...styles.timerValue,
                color: timeRemaining < 0 
                  ? '#ef4444'
                  : timeRemaining < 60 && recordingState === 'recording' 
                    ? '#ef4444' 
                    : '#ffffff',
              }}>
                {formatTime(timeRemaining)}
              </span>
            </div>
          </div>

          {/* Start Recording Button */}
          {recordingState === 'idle' && !showModal && (
            <button onClick={startRecording} style={styles.startButtonInFrame}>
              <span style={styles.startIcon}>●</span>
              Start Recording
            </button>
          )}

          {/* Stop Recording Button */}
          {recordingState === 'recording' && (
            <button onClick={stopRecording} style={styles.stopButtonInFrame}>
              <span style={styles.stopIcon}>■</span>
              Stop Recording
            </button>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div style={styles.error}>{error}</div>
        )}

        {/* Post-recording controls */}
        {recordingState === 'stopped' && (
          <div style={styles.postRecordControls}>
            <button onClick={uploadRecording} style={styles.uploadButton}>
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

// Styles
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    background: '#0a0a0a',
    padding: '16px',
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
    border: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  previewVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    background: '#000',
    cursor: 'pointer',
  },
  // Top bar containing recording indicator and timer
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '16px 20px',
    gap: '16px',
    zIndex: 2,
  },
  recordingIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(220, 38, 38, 0.9)',
    padding: '8px 16px',
    borderRadius: '8px',
    flexShrink: 0,
  },
  recordingDot: {
    color: '#ffffff',
    fontSize: '1rem',
    animation: 'blink 1s infinite',
  },
  recLabel: {
    color: '#ffffff',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  recordingDuration: {
    color: '#ffffff',
    fontFamily: 'monospace',
    fontSize: '0.9rem',
    fontWeight: 600,
  },
  quoteCentered: {
    position: 'absolute',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1,
    pointerEvents: 'none',
    display: 'flex',
    justifyContent: 'center',
  },
  quoteText: {
    color: 'rgba(255, 255, 255, 0.95)',
    fontSize: '0.95rem',
    margin: 0,
    fontStyle: 'italic',
    lineHeight: 1.5,
    textAlign: 'center',
    padding: '12px 20px',
    background: 'rgba(0, 0, 0, 0.75)',
    borderRadius: '12px',
    maxWidth: '70vw',
  },
  timerBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: 'rgba(0, 0, 0, 0.6)',
    padding: '8px 16px',
    borderRadius: '8px',
    flexShrink: 0,
  },
  timerLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '0.65rem',
    fontWeight: 600,
    letterSpacing: '0.5px',
  },
  timerValue: {
    color: '#ffffff',
    fontSize: '1.4rem',
    fontWeight: 700,
    fontFamily: 'monospace',
  },
  // Custom video controls
  customControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
    background: '#ffffff',
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
  // Start button
  startButtonInFrame: {
    position: 'absolute',
    bottom: '40px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#ffffff',
    color: '#111111',
    border: 'none',
    padding: '16px 36px',
    fontSize: '1rem',
    fontWeight: 600,
    borderRadius: '50px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
    transition: 'all 0.2s ease',
  },
  startIcon: {
    color: '#dc2626',
    fontSize: '1.2rem',
  },
  // Stop button
  stopButtonInFrame: {
    position: 'absolute',
    bottom: '40px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(255, 255, 255, 0.15)',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    padding: '16px 36px',
    fontSize: '1rem',
    fontWeight: 600,
    borderRadius: '50px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backdropFilter: 'blur(10px)',
    transition: 'all 0.2s ease',
  },
  stopIcon: {
    fontSize: '0.9rem',
  },
  error: {
    padding: '14px 18px',
    background: 'rgba(220, 38, 38, 0.1)',
    border: '1px solid rgba(220, 38, 38, 0.3)',
    borderRadius: '8px',
    color: '#ef4444',
    marginTop: '16px',
    fontSize: '0.9rem',
  },
  postRecordControls: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
    marginTop: '20px',
    paddingBottom: '20px',
  },
  uploadButton: {
    background: '#ffffff',
    color: '#111111',
    border: 'none',
    padding: '14px 36px',
    fontSize: '1rem',
    fontWeight: 600,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  uploadingButton: {
    background: 'rgba(255, 255, 255, 0.1)',
    color: 'rgba(255, 255, 255, 0.5)',
    border: 'none',
    padding: '14px 36px',
    fontSize: '1rem',
    fontWeight: 600,
    borderRadius: '8px',
    cursor: 'not-allowed',
  },
  // Modal styles - clean white/black/gray theme
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px',
  },
  modalContent: {
    background: '#ffffff',
    borderRadius: '12px',
    padding: '32px 40px',
    maxWidth: '440px',
    width: '100%',
    textAlign: 'center',
    outline: 'none',
  },
  modalTitle: {
    color: '#111111',
    fontSize: '1.25rem',
    fontWeight: 600,
    margin: '0 0 16px 0',
  },
  modalText: {
    color: '#4b5563',
    fontSize: '0.95rem',
    lineHeight: 1.6,
    margin: '0 0 24px 0',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    color: '#6b7280',
    fontSize: '0.9rem',
    cursor: 'pointer',
    marginBottom: '24px',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
    accentColor: '#111111',
  },
  continueButton: {
    background: '#111111',
    color: '#ffffff',
    border: 'none',
    padding: '12px 32px',
    fontSize: '0.95rem',
    fontWeight: 500,
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    width: '100%',
    marginBottom: '16px',
  },
  modalHint: {
    color: '#9ca3af',
    fontSize: '0.8rem',
    margin: 0,
  },
};

export default RecordScreen;
