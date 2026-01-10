export interface SpeechObject {
  id: string;
  duration: number;
  createdAt: number;
  feedback: {
    overallScore: number;
    content: number;
    delivery: number;
    language: number;
    bodyLanguage: number | null;  // null when body language was not assessable
    pace: number;
    fillerCount: number;
    priorityImprovements: string[];
  };
}

export function calculateConsistency(speeches: SpeechObject[]) {
  if (speeches.length < 2) return { percentage: 100, label: 'High' };
  const scores = speeches.map(s => s.feedback.overallScore);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const percentage = Math.max(0, Math.min(100, 100 - (stdDev * 10)));
  let label = 'Low';
  if (percentage >= 85) label = 'High';
  else if (percentage >= 70) label = 'Med-High';
  else if (percentage >= 55) label = 'Medium';
  return { percentage, label };
}

export function calculateAvgDuration(speeches: SpeechObject[]) {
  if (speeches.length === 0) return { minutes: 0, seconds: 0, warning: false };
  const avgSeconds = speeches.reduce((sum, s) => sum + s.duration, 0) / speeches.length;
  return {
    minutes: Math.floor(avgSeconds / 60),
    seconds: Math.floor(avgSeconds % 60),
    warning: avgSeconds < 180
  };
}

export function calculateTrainingFrequency(speeches: SpeechObject[]) {
  if (speeches.length < 2) return { sessionsPerWeek: 0, label: 'Low' };
  const sorted = [...speeches].sort((a, b) => a.createdAt - b.createdAt);
  const weeks = Math.max(1, (sorted[sorted.length - 1].createdAt - sorted[0].createdAt) / (1000 * 60 * 60 * 24 * 7));
  const sessionsPerWeek = speeches.length / weeks;
  let label = 'Low';
  if (sessionsPerWeek >= 4) label = 'Excellent';
  else if (sessionsPerWeek >= 2.5) label = 'Good';
  else if (sessionsPerWeek >= 1) label = 'Fair';
  return { sessionsPerWeek, label };
}

export function calculateAvgPace(speeches: SpeechObject[]) {
  if (speeches.length === 0) return { wpm: 0, warning: false };
  const avgWpm = speeches.reduce((sum, s) => sum + s.feedback.pace, 0) / speeches.length;
  return { wpm: Math.round(avgWpm), warning: avgWpm < 120 || avgWpm > 180 };
}

export function calculateAvgFillers(speeches: SpeechObject[]) {
  if (speeches.length === 0) return { fillersPerMin: 0, good: true };
  const avgFillers = speeches.reduce((sum, s) => sum + s.feedback.fillerCount, 0) / speeches.length;
  return { fillersPerMin: Number(avgFillers.toFixed(1)), good: avgFillers < 5 };
}

export function calculateAvgStructure(speeches: SpeechObject[]) {
  if (speeches.length === 0) return { score: 0, warning: false };
  const avgScore = speeches.reduce((sum, s) => sum + s.feedback.content, 0) / speeches.length;
  return { score: Number(avgScore.toFixed(1)), warning: avgScore < 6.0 };
}

export function aggregatePriorityImprovements(speeches: SpeechObject[]) {
  const counts: Record<string, number> = {};
  speeches.forEach(s => s.feedback.priorityImprovements.forEach(i => counts[i] = (counts[i] || 0) + 1));
  const top = Object.entries(counts).map(([issue, count]) => ({ issue, count })).sort((a, b) => b.count - a.count).slice(0, 3);
  const getDrill = (i: string) => {
    const l = i.toLowerCase();
    if (l.includes('eye contact')) return 'The 3-second scan: Look at one spot for 3 seconds, then move.';
    if (l.includes('filler')) return 'The Pause Reset: Stop talking for 2 seconds when you feel a filler coming.';
    if (l.includes('structure')) return 'Roadmap practice: List your 3 main points in under 15 seconds.';
    if (l.includes('pace')) return 'Metronome Speaking: Speak along to a 140 BPM beat.';
    return 'Targeted review: Re-record this specific section.';
  };
  return top.map(t => ({ issue: t.issue, count: t.count, drill: getDrill(t.issue) }));
}

export function calculateTournamentReadiness(avgScore: number, date: Date) {
  let tier = 'Local Round';
  if (avgScore >= 8.0) tier = 'Finals';
  else if (avgScore >= 6.0) tier = 'Semifinals';
  else if (avgScore >= 4.0) tier = 'Quarterfinals';
  const days = Math.max(0, Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  return { tier, daysRemaining: days, recommendedSessions: Math.round(days / 3) };
}
