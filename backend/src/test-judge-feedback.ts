/**
 * Test script for verifying judge feedback quality
 * 
 * Run with: npx ts-node src/test-judge-feedback.ts
 * 
 * This tests the feedback validator with a mock analysis object
 * to ensure the validation logic works correctly.
 */

// Mock the validator functions directly (since they're not exported)
// In production, these would be imported from geminiClient

interface FeedbackFieldCheck {
  fieldName: string;
  feedback: string;
}

function extractQuotesFromFeedback(feedback: string): string[] {
  const quotes: string[] = [];
  // Match text between single quotes (5-80 chars, on same line, no newlines in the quote)
  const quotePattern = /'([^'\n]{5,80})'/g;
  let match;
  while ((match = quotePattern.exec(feedback)) !== null) {
    const quote = match[1].trim();
    // Skip if it looks like a time reference or placeholder
    if (!/^\[\d+:\d{2}/.test(quote) && !/^no (?:direct )?quote/i.test(quote)) {
      quotes.push(quote);
    }
  }
  return quotes;
}

function countEvidenceBullets(feedback: string): number {
  const lines = feedback.split('\n');
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
      if (/'[^']+'/i.test(trimmed) || /\[\d+:\d{2}/i.test(trimmed) || /\[no timecode/i.test(trimmed)) {
        count++;
      }
    }
  }
  return count;
}

function quoteExistsInTranscript(quote: string, transcript: string): boolean {
  if (!quote || !transcript) return false;
  
  const normalizedQuote = quote.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
  const normalizedTranscript = transcript.toLowerCase().replace(/[^\w\s]/g, ' ');
  
  if (normalizedTranscript.includes(normalizedQuote)) {
    return true;
  }
  
  const quoteWords = normalizedQuote.split(/\s+/).filter(Boolean);
  if (quoteWords.length < 3) return true;
  
  const transcriptWords = normalizedTranscript.split(/\s+/).filter(Boolean);
  const windowSize = quoteWords.length;
  const matchThreshold = Math.floor(quoteWords.length * 0.7);
  
  for (let i = 0; i <= transcriptWords.length - windowSize; i++) {
    let matchCount = 0;
    for (let j = 0; j < windowSize; j++) {
      if (transcriptWords[i + j] === quoteWords[j]) {
        matchCount++;
      }
    }
    if (matchCount >= matchThreshold) {
      return true;
    }
  }
  
  return false;
}

function checkFeedbackSections(feedback: string): { hasAll: boolean; missing: string[] } {
  const requiredSections = [
    { name: 'Score Justification', patterns: [/\*\*Score Justification/i, /Score Justification:/i] },
    { name: 'Evidence from Speech', patterns: [/\*\*Evidence/i, /Evidence from Speech:/i, /Evidence:/i] },
    { name: 'What This Means', patterns: [/\*\*What This Means/i, /What This Means:/i, /Competitive Implication/i] },
    { name: 'How to Improve', patterns: [/\*\*How to Improve/i, /How to Improve:/i, /Improvement/i] },
  ];
  
  const missing: string[] = [];
  for (const section of requiredSections) {
    const found = section.patterns.some(p => p.test(feedback));
    if (!found) {
      missing.push(section.name);
    }
  }
  
  return { hasAll: missing.length === 0, missing };
}

// Sample transcript for testing
const sampleTranscript = `
[0:00-0:15] Good afternoon. Today I want to talk about the quote that tells us success is not final and failure is not fatal.
[0:15-0:45] This quote speaks to the core of human resilience. When we succeed, we cannot become complacent because success is merely a stepping stone. Similarly, when we fail, we must remember that failure is not the end but a learning opportunity.
[0:45-1:15] Let me give you my first point. In my own experience, I once failed a major exam in high school. I thought my academic career was over. But that failure taught me how to study effectively and I went on to succeed in college.
[1:15-1:45] My second point relates to famous failures in history. Thomas Edison failed thousands of times before inventing the light bulb. He famously said he found thousands of ways that didn't work. His persistence proves that failure is not fatal.
[1:45-2:15] Finally, we must consider the implications for our daily lives. If we treat every success as permanent, we become arrogant. If we treat every failure as final, we become hopeless. The truth lies in understanding that both are temporary states.
[2:15-2:30] In conclusion, success is not final because there is always more to achieve. Failure is not fatal because there is always another chance. Thank you.
`;

// Sample well-formatted feedback
const wellFormattedFeedback = `**Score Justification:** This earns a 7.8 because the speaker demonstrates clear thesis engagement with the quote about success and failure. The structure follows a logical progression because each body point builds on the central theme. This did not reach 8.5 because the examples remained somewhat predictable (Edison is overused) and lacked original insight into the quote's deeper meaning.

**Evidence from Speech:**
- 'success is merely a stepping stone' [0:20-0:35] — Shows understanding of the temporary nature of achievement
- 'failure is not fatal because there is always another chance' [2:20-2:30] — Direct quote linkage demonstrates thesis return

**What This Means:** Judges would note solid foundational structure but may rank below speakers who offer more original analysis. The predictable Edison example could cost points in competitive rounds.

**How to Improve:** Quote Depth Drill: Before speaking, write 3 non-obvious interpretations of the quote. Goal: Include at least one unique angle that distinguishes your analysis from the obvious interpretation within 3 practice sessions.`;

// Sample poorly formatted feedback (missing sections)
const poorlyFormattedFeedback = `The speaker did okay with the topic. They talked about success and failure. The examples were fine. Could be better with more detail.`;

// Run tests
console.log('='.repeat(60));
console.log('FEEDBACK VALIDATOR TEST');
console.log('='.repeat(60));

console.log('\n📋 TEST 1: Well-formatted feedback\n');

const wellFormatted = checkFeedbackSections(wellFormattedFeedback);
console.log(`Has all sections: ${wellFormatted.hasAll ? '✅ YES' : '❌ NO'}`);
console.log(`Missing sections: ${wellFormatted.missing.length > 0 ? wellFormatted.missing.join(', ') : 'None'}`);

const bulletCount1 = countEvidenceBullets(wellFormattedFeedback);
console.log(`Evidence bullets: ${bulletCount1} (expected: 2) ${bulletCount1 >= 2 ? '✅' : '❌'}`);

const quotes1 = extractQuotesFromFeedback(wellFormattedFeedback);
console.log(`Quotes found: ${quotes1.length}`);
for (const quote of quotes1) {
  const exists = quoteExistsInTranscript(quote, sampleTranscript);
  console.log(`  - "${quote.substring(0, 40)}..." ${exists ? '✅ found in transcript' : '❌ NOT found'}`);
}

console.log('\n📋 TEST 2: Poorly formatted feedback\n');

const poorlyFormatted = checkFeedbackSections(poorlyFormattedFeedback);
console.log(`Has all sections: ${poorlyFormatted.hasAll ? '✅ YES' : '❌ NO'}`);
console.log(`Missing sections: ${poorlyFormatted.missing.join(', ')}`);

const bulletCount2 = countEvidenceBullets(poorlyFormattedFeedback);
console.log(`Evidence bullets: ${bulletCount2} (expected: 2) ${bulletCount2 >= 2 ? '✅' : '❌'}`);

console.log('\n📋 TEST 3: Quote verification\n');

const testQuotes = [
  'success is not final',  // Should match
  'failure is not fatal',  // Should match
  'Thomas Edison failed thousands of times',  // Should match
  'this quote does not exist at all',  // Should NOT match
];

for (const quote of testQuotes) {
  const exists = quoteExistsInTranscript(quote, sampleTranscript);
  console.log(`"${quote}" - ${exists ? '✅ found' : '❌ not found'}`);
}

console.log('\n' + '='.repeat(60));
console.log('TEST COMPLETE');
console.log('='.repeat(60));

// Expected output format example
console.log('\n📝 EXPECTED FEEDBACK FORMAT EXAMPLE:\n');
console.log(`
**Score Justification:** (3-5 sentences with "because" chain)
This earns a X.X because [observation]. This matters because [impact]. 
The speaker demonstrates [skill] because [evidence].
This did not reach Y.Y because [specific gap preventing higher band].

**Evidence from Speech:**
- '[exact quote 5-15 words]' [m:ss-m:ss] — [why it matters]
- '[exact quote 5-15 words]' [m:ss-m:ss] — [why it matters]

**What This Means:** (2 sentences max)
[Competitive tournament implication for judges]

**How to Improve:**
[Drill name]: [Exact steps]. Goal: [Quantifiable metric by next session].
`);
