# Body Language Assessability Feature

## Overview

When camera framing does NOT show head + hands + torso, the app does NOT score body language. Instead, body language is marked as "not assessable" with a clear note in the UI and PDF.

## Implementation Summary

### Backend Changes

#### 1. `backend/src/index.ts`
- Added `FramingData` interface with `headVisible`, `torsoVisible`, `handsVisible` booleans
- `SessionData` now includes optional `framing?: FramingData`
- Upload endpoint (`POST /api/upload`) now accepts `framing` JSON in the request body
- Framing data is passed to the Gemini analysis client

#### 2. `backend/src/geminiClient.ts`
- Added `FramingData` interface export
- `GeminiAnalysisInput` now includes optional `framing?: FramingData`
- Added `isBodyLanguageAssessable(framing)` helper function:
  - Returns `true` ONLY if all three: `headVisible`, `torsoVisible`, `handsVisible` are `true`
  - Returns `false` if framing is undefined or any flag is false
- Added `applyBodyLanguageNotAssessableInPlace(analysis)` function:
  - Sets `analysis.bodyLanguageAssessable = false`
  - Sets all body language scores to `null`
  - Replaces feedback with standard message: "Not assessable due to camera framing..."
  - Renormalizes weights: Content ~47%, Delivery ~35%, Language ~18%
  - Recomputes `overallScore` using renormalized weights
- `GeminiAnalysisResult.analysis` type updated:
  - Added `bodyLanguageAssessable: boolean`
  - `categoryScores.bodyLanguage.score` is now `number | null`
  - `bodyLanguageAnalysis.*.score` fields are now `number | null`

### Frontend Changes

#### 1. `frontend/src/types.ts`
- Added `FramingData` interface
- `DebateAnalysis` now includes `bodyLanguageAssessable: boolean`
- Body language score types updated to allow `null`

#### 2. `frontend/src/components/FeedbackReport.tsx`
- `AnalysisItem` component updated:
  - Added `notAssessable?: boolean` prop
  - Shows "N/A" badge instead of score when not assessable
  - Hides progress bar and "Deep Dive" button when not assessable
  - Applies opacity styling to greyed-out items
- `renderScoreRing` function updated:
  - Shows "N/A" text instead of score when not assessable
  - Applies grey color and reduced opacity
  - Shows "Not assessable" instead of weight percentage
- Body Language section:
  - Shows yellow warning banner when not assessable
  - Shows renormalized weights (47%/35%/18%) for other categories
  - Section header shows "0%" weight when not assessable
- Score rings section shows renormalized weights dynamically
- PDF export (`generatePDFContent`) updated:
  - Shows N/A for body language scores when not assessable
  - Includes warning banner in PDF
  - Shows renormalized weight percentages

## How Framing Booleans Reach the Backend

1. **Client-side**: When uploading a video, the client can include framing data in the FormData:

```typescript
const formData = new FormData();
formData.append('file', videoBlob);
formData.append('theme', theme);
formData.append('quote', quote);
formData.append('durationSeconds', durationSeconds.toString());
formData.append('framing', JSON.stringify({
  headVisible: true,  // or false
  torsoVisible: true,
  handsVisible: true
}));

await fetch('/api/upload', {
  method: 'POST',
  body: formData
});
```

2. **Backend processing**: The upload endpoint parses the framing JSON from the request body and stores it in the session data.

3. **Analysis phase**: The framing data is passed to `analyzeSpeechWithGemini()` which determines body language assessability.

## Manual Test Steps

### Test Case 1: Body Language NOT Assessable (Default)

1. Start the backend server: `cd backend && npm run dev`
2. Start the frontend: `cd frontend && npm run dev`
3. Record a speech WITHOUT providing framing data
4. **Expected**: 
   - Body Language section shows "Not Assessable" warning banner
   - Body Language score ring shows "N/A" with grey color
   - Other category weights show renormalized percentages (47%/35%/18%)
   - Overall score is calculated without body language
   - PDF export shows the same "Not Assessable" state

### Test Case 2: Body Language IS Assessable

1. Modify the upload request to include complete framing data:
   ```json
   {
     "headVisible": true,
     "torsoVisible": true,
     "handsVisible": true
   }
   ```
2. Record a speech WITH the above framing data
3. **Expected**:
   - Body Language section shows normal scores
   - Body Language score ring shows numeric score with gold color
   - Original weight percentages (40%/30%/15%/15%)
   - Overall score includes body language contribution

### Test Case 3: Partial Framing (NOT Assessable)

1. Modify the upload request to include partial framing:
   ```json
   {
     "headVisible": true,
     "torsoVisible": true,
     "handsVisible": false
   }
   ```
2. Record a speech
3. **Expected**: Same as Test Case 1 (Not Assessable)

### Test Case 4: PDF Export Verification

1. Complete Test Case 1 (Not Assessable)
2. Click "Export to PDF"
3. **Expected**:
   - PDF shows "N/A" for Body Language score
   - PDF shows warning banner in Body Language section
   - PDF shows renormalized weights

## Weight Renormalization Formula

When body language is not assessable:
- Original weights: Content 40%, Delivery 30%, Language 15%, Body 15%
- Sum of remaining: 40% + 30% + 15% = 85%
- Scale factor: 1 / 0.85 ≈ 1.176

New weights:
- Content: 40% × 1.176 ≈ **47%**
- Delivery: 30% × 1.176 ≈ **35%**
- Language: 15% × 1.176 ≈ **18%**
- Body Language: **0%** (not included)

The overall score is then: `(Content × 0.47) + (Delivery × 0.35) + (Language × 0.18)`
