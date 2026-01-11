/**
 * Test file for Body Language Framing Assessment
 * 
 * Tests two scenarios:
 * A) All framing flags true → bodyLanguageAssessable=true, numeric body scores
 * B) Any framing flag false → bodyLanguageAssessable=false, null body scores, overall renormalized
 */

// =====================================================
// Inline implementation for testing (mimics geminiClient.ts logic)
// =====================================================

interface FramingData {
  headVisible: boolean;
  torsoVisible: boolean;
  handsVisible: boolean;
}

interface CategoryScore {
  score: number | null;
  weight: number;
  weighted: number | null;
}

interface CategoryScores {
  content: CategoryScore;
  delivery: CategoryScore;
  language: CategoryScore;
  bodyLanguage: CategoryScore;
}

interface MockAnalysis {
  bodyLanguageAssessable: boolean;
  overallScore: number;
  categoryScores: CategoryScores;
  bodyLanguageAnalysis: {
    eyeContact: { score: number | null; percentage: number | null; feedback: string };
    gestures: { score: number | null; feedback: string };
    posture: { score: number | null; feedback: string };
    stagePresence: { score: number | null; feedback: string };
  };
}

const NOT_ASSESSABLE_FEEDBACK = 'Not assessable due to camera framing. Please record with head + hands + torso visible.';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function isBodyLanguageAssessable(framing?: FramingData): boolean {
  if (!framing) return false;
  return framing.headVisible === true && framing.torsoVisible === true && framing.handsVisible === true;
}

function applyBodyLanguageNotAssessableInPlace(analysis: MockAnalysis): void {
  analysis.bodyLanguageAssessable = false;

  // Set all body language analysis scores to null
  analysis.bodyLanguageAnalysis.eyeContact = {
    score: null,
    percentage: null,
    feedback: NOT_ASSESSABLE_FEEDBACK,
  };
  analysis.bodyLanguageAnalysis.gestures = {
    score: null,
    feedback: NOT_ASSESSABLE_FEEDBACK,
  };
  analysis.bodyLanguageAnalysis.posture = {
    score: null,
    feedback: NOT_ASSESSABLE_FEEDBACK,
  };
  analysis.bodyLanguageAnalysis.stagePresence = {
    score: null,
    feedback: NOT_ASSESSABLE_FEEDBACK,
  };

  // Set category score to null
  analysis.categoryScores.bodyLanguage.score = null;
  analysis.categoryScores.bodyLanguage.weighted = null;

  // Renormalize weights
  const cs = analysis.categoryScores;
  const contentScore = cs.content?.score ?? 0;
  const deliveryScore = cs.delivery?.score ?? 0;
  const languageScore = cs.language?.score ?? 0;

  // Scale factor: 1 / 0.85 (original non-body weights sum to 0.85)
  const scaleFactor = 1 / 0.85;
  const newContentWeight = round1(0.40 * scaleFactor * 100) / 100;
  const newDeliveryWeight = round1(0.30 * scaleFactor * 100) / 100;
  const newLanguageWeight = round1(0.15 * scaleFactor * 100) / 100;

  cs.content.weight = newContentWeight;
  cs.content.weighted = round1(contentScore * newContentWeight);
  
  cs.delivery.weight = newDeliveryWeight;
  cs.delivery.weighted = round1(deliveryScore * newDeliveryWeight);
  
  cs.language.weight = newLanguageWeight;
  cs.language.weighted = round1(languageScore * newLanguageWeight);
  
  cs.bodyLanguage.weight = 0;
  cs.bodyLanguage.weighted = null;

  // Recompute overall score
  const newOverall = (cs.content.weighted ?? 0) + (cs.delivery.weighted ?? 0) + (cs.language.weighted ?? 0);
  analysis.overallScore = clamp(round1(newOverall), 0, 10);
}

// =====================================================
// Test Data Factory
// =====================================================

function createMockAnalysis(scores: {
  content: number;
  delivery: number;
  language: number;
  bodyLanguage: number;
}): MockAnalysis {
  return {
    bodyLanguageAssessable: true,
    overallScore: round1(
      scores.content * 0.40 + 
      scores.delivery * 0.30 + 
      scores.language * 0.15 + 
      scores.bodyLanguage * 0.15
    ),
    categoryScores: {
      content: { score: scores.content, weight: 0.40, weighted: round1(scores.content * 0.40) },
      delivery: { score: scores.delivery, weight: 0.30, weighted: round1(scores.delivery * 0.30) },
      language: { score: scores.language, weight: 0.15, weighted: round1(scores.language * 0.15) },
      bodyLanguage: { score: scores.bodyLanguage, weight: 0.15, weighted: round1(scores.bodyLanguage * 0.15) },
    },
    bodyLanguageAnalysis: {
      eyeContact: { score: scores.bodyLanguage, percentage: 70, feedback: 'Good eye contact.' },
      gestures: { score: scores.bodyLanguage, feedback: 'Natural gestures.' },
      posture: { score: scores.bodyLanguage, feedback: 'Good posture.' },
      stagePresence: { score: scores.bodyLanguage, feedback: 'Strong presence.' },
    },
  };
}

// =====================================================
// Tests
// =====================================================

function runTests(): void {
  console.log('='.repeat(70));
  console.log('TEST: Body Language Framing Assessment');
  console.log('='.repeat(70));
  console.log('');

  // -------------------------
  // TEST A: All framing flags true
  // -------------------------
  console.log('TEST A: All framing flags TRUE → Body language assessable');
  console.log('-'.repeat(50));

  const framingA: FramingData = {
    headVisible: true,
    torsoVisible: true,
    handsVisible: true,
  };

  const analysisA = createMockAnalysis({
    content: 7.5,
    delivery: 7.0,
    language: 7.2,
    bodyLanguage: 6.8,
  });

  const assessableA = isBodyLanguageAssessable(framingA);
  console.log(`  Framing: ${JSON.stringify(framingA)}`);
  console.log(`  isBodyLanguageAssessable: ${assessableA}`);

  if (assessableA) {
    analysisA.bodyLanguageAssessable = true;
    // No changes needed - scores remain numeric
  } else {
    applyBodyLanguageNotAssessableInPlace(analysisA);
  }

  console.log(`  bodyLanguageAssessable: ${analysisA.bodyLanguageAssessable}`);
  console.log(`  categoryScores.bodyLanguage.score: ${analysisA.categoryScores.bodyLanguage.score}`);
  console.log(`  categoryScores.bodyLanguage.weight: ${analysisA.categoryScores.bodyLanguage.weight}`);
  console.log(`  categoryScores.bodyLanguage.weighted: ${analysisA.categoryScores.bodyLanguage.weighted}`);
  console.log(`  overallScore: ${analysisA.overallScore}`);
  console.log(`  eyeContact.score: ${analysisA.bodyLanguageAnalysis.eyeContact.score}`);

  // Assertions
  const passA = 
    assessableA === true &&
    analysisA.bodyLanguageAssessable === true &&
    analysisA.categoryScores.bodyLanguage.score === 6.8 &&
    analysisA.categoryScores.bodyLanguage.weight === 0.15 &&
    analysisA.categoryScores.bodyLanguage.weighted !== null &&
    analysisA.bodyLanguageAnalysis.eyeContact.score !== null;

  console.log(`  ✅ TEST A PASSED: ${passA}`);
  console.log('');

  // -------------------------
  // TEST B: handsVisible = false
  // -------------------------
  console.log('TEST B: handsVisible=FALSE → Body language NOT assessable');
  console.log('-'.repeat(50));

  const framingB: FramingData = {
    headVisible: true,
    torsoVisible: true,
    handsVisible: false,  // <-- not visible
  };

  const analysisB = createMockAnalysis({
    content: 7.5,
    delivery: 7.0,
    language: 7.2,
    bodyLanguage: 6.8,
  });

  const originalOverallB = analysisB.overallScore;
  console.log(`  Original overallScore (with body language): ${originalOverallB}`);
  console.log(`  Framing: ${JSON.stringify(framingB)}`);

  const assessableB = isBodyLanguageAssessable(framingB);
  console.log(`  isBodyLanguageAssessable: ${assessableB}`);

  if (!assessableB) {
    applyBodyLanguageNotAssessableInPlace(analysisB);
  }

  console.log(`  bodyLanguageAssessable: ${analysisB.bodyLanguageAssessable}`);
  console.log(`  categoryScores.bodyLanguage.score: ${analysisB.categoryScores.bodyLanguage.score}`);
  console.log(`  categoryScores.bodyLanguage.weight: ${analysisB.categoryScores.bodyLanguage.weight}`);
  console.log(`  categoryScores.bodyLanguage.weighted: ${analysisB.categoryScores.bodyLanguage.weighted}`);
  console.log(`  categoryScores.content.weight: ${analysisB.categoryScores.content.weight}`);
  console.log(`  categoryScores.delivery.weight: ${analysisB.categoryScores.delivery.weight}`);
  console.log(`  categoryScores.language.weight: ${analysisB.categoryScores.language.weight}`);
  console.log(`  overallScore (renormalized): ${analysisB.overallScore}`);
  console.log(`  eyeContact.score: ${analysisB.bodyLanguageAnalysis.eyeContact.score}`);
  console.log(`  eyeContact.feedback: ${analysisB.bodyLanguageAnalysis.eyeContact.feedback.slice(0, 50)}...`);

  // Calculate expected renormalized score
  // New weights: Content 0.47, Delivery 0.35, Language 0.18
  const expectedRenormalized = round1(7.5 * 0.47 + 7.0 * 0.35 + 7.2 * 0.18);
  console.log(`  Expected renormalized score: ${expectedRenormalized}`);

  // Assertions
  const passB = 
    assessableB === false &&
    analysisB.bodyLanguageAssessable === false &&
    analysisB.categoryScores.bodyLanguage.score === null &&
    analysisB.categoryScores.bodyLanguage.weight === 0 &&
    analysisB.categoryScores.bodyLanguage.weighted === null &&
    analysisB.bodyLanguageAnalysis.eyeContact.score === null &&
    analysisB.bodyLanguageAnalysis.eyeContact.percentage === null &&
    analysisB.bodyLanguageAnalysis.gestures.score === null &&
    analysisB.categoryScores.content.weight > 0.40 && // renormalized higher
    analysisB.categoryScores.delivery.weight > 0.30 && // renormalized higher
    analysisB.categoryScores.language.weight > 0.15;  // renormalized higher

  console.log(`  ✅ TEST B PASSED: ${passB}`);
  console.log('');

  // -------------------------
  // TEST C: No framing data provided (undefined)
  // -------------------------
  console.log('TEST C: No framing data → Body language NOT assessable');
  console.log('-'.repeat(50));

  const framingC: FramingData | undefined = undefined;

  const assessableC = isBodyLanguageAssessable(framingC);
  console.log(`  Framing: ${JSON.stringify(framingC)}`);
  console.log(`  isBodyLanguageAssessable: ${assessableC}`);

  const passC = assessableC === false;
  console.log(`  ✅ TEST C PASSED: ${passC}`);
  console.log('');

  // -------------------------
  // Summary
  // -------------------------
  console.log('='.repeat(70));
  const allPassed = passA && passB && passC;
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED');
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log(`   Test A: ${passA ? 'PASS' : 'FAIL'}`);
    console.log(`   Test B: ${passB ? 'PASS' : 'FAIL'}`);
    console.log(`   Test C: ${passC ? 'PASS' : 'FAIL'}`);
  }
  console.log('='.repeat(70));
}

// Run tests
runTests();
