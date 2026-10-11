/**
 * Inputs and outputs of the rules engine. Inputs are a snapshot of validated
 * facts; the engine never reads the clock, the network or the database.
 */
import type { AegLevel, PersonaId, TrackId, VerificationStatus } from "../policy/schema";

export type { AegLevel, PersonaId, TrackId, VerificationStatus };

/** One piece of evidence (§4.1 Artifact). */
export interface EvidenceItem {
  id: string;
  /** Rubric component this evidence counts toward, e.g. "domain_practical_evidence". */
  component: string;
  /** Department standard item key (Corporate Placement §5.4), when applicable. */
  standardItem?: string;
  label: string;
  /** Required weight of the item within its component. Defaults to 1. */
  weight?: number;
  status: VerificationStatus;
  /** Source kind, used for confidence and integrity checks. */
  source?: string;
}

export type EvidenceFact = EvidenceItem;

export interface MockAttempt {
  id: string;
  testType: string;
  /** ISO date (yyyy-mm-dd). */
  date: string;
  items: number;
  percentile: number;
  avgSecondsPerItem: number;
  targetSecondsPerItem?: number;
  itemKind?: "mcq" | "numerical";
  status: VerificationStatus;
}

export interface FacultyRating {
  id: string;
  kind: "mock_interview" | "answer_writing" | "psychometric" | "customer_validation" | "sop_review";
  date: string;
  /** Five-point scale. */
  rating: number;
  status: VerificationStatus;
}

export interface WeeklySignal {
  /** Week index, oldest first; only relative spacing matters. */
  week: number;
  value: number;
}

export interface Aspiration {
  track: TrackId | null;
  targetOutcome: string;
  /** e.g. "abroad", "public_service", "sector", "program", "exam" */
  targetType?: string;
  targetDate?: string;
  readiness?: number;
}

/** A validated snapshot of everything the rubric needs for one student. */
export interface StudentFacts {
  studentId: string;
  department: string;
  year: number;
  cgpa: number | null;
  attendancePct: number | null;
  aspiration: Aspiration;
  evidence: EvidenceItem[];
  mocks: MockAttempt[];
  ratings: FacultyRating[];
  /** Verified internship hours (placement cell confirmed). null = no record. */
  verifiedInternshipHours: number | null;
  /** Campus aptitude percentile; null when not taken. */
  campusAptitudePercentile: number | null;
  /** Fallback internal mock aptitude percentile (§5.3.1). */
  internalAptitudePercentile?: number | null;
  attendanceWeekly?: WeeklySignal[];
  mockPercentileWeekly?: WeeklySignal[];
  /** Days (in the streak window) with a valid credit. */
  streakValidDays?: number | null;
  /** Gap days in the last 14 days of streak activity. */
  streakGapDays14?: number | null;
  /** Count of platform activity events in the last 60 days. */
  activityLast60d?: number;
  mocksLast60d?: number;
  activeBacklogs?: number;
  /** Months until the application deadline / exam date, when known. */
  monthsToDeadline?: number | null;
  /** Verified artifact score (0–100) and the cohort's 75th percentile. */
  artifactScore?: number | null;
  cohortArtifactP75?: number | null;
  verifiedProjects?: number;
  /** Track-specific raw measures not covered above (component key → 0–100 score). */
  precomputed?: Record<string, number | null>;
  /** Sources that failed within the confidence window (§5.6). */
  recentSourceFailures?: number;
  /** Higher Studies (§5.3.2) */
  sopReviewsCount?: number | null;
  applicationMilestonesCompletedPct?: number | null;
  /** Entrepreneurship (§5.3.3) */
  customerInterviewsCount?: number | null;
  ventureMilestonesOnTimePct?: number | null;
  /** Public Service (§5.3.4) */
  currentAffairsDaysLogged?: number | null;
  currentAffairsWeeklyAccuracy?: number | null;
  /** Sports, Defense & NCC (§5.3.6) - BMI shown only as a band, never numeric */
  physicalFitnessBmiBand?: "NORMAL" | "WATCH" | "EVALUATE" | null;
  physicalFitnessCooperBandScore?: number | null;
  campDaysAttended?: number | null;
  campDaysRequired?: number | null;
  competitionPoints?: number | null;
  creditsHeld?: number | null;
  minimumCreditsRequired?: number | null;
}

export interface ComponentResult {
  key: string;
  label: string;
  weight: number;
  /** 0–100, full precision. */
  score: number;
  /** score × weight / 100, full precision. */
  contribution: number;
  evidenceRefs: string[];
  dataGaps: string[];
  calculation: string;
}

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface TrackScore {
  track: TrackId;
  rubricVersion: string;
  components: ComponentResult[];
  /** Full precision. Display with `round1`. */
  score: number;
  gateFailed: string | null;
  dataGaps: string[];
  reducedWeightEvidence: string[];
  confidence: Confidence;
}

export type TrendLabel = "IMPROVING" | "STABLE" | "WORSENING" | "INSUFFICIENT_DATA";

export interface PersonaMatch {
  persona: PersonaId;
  floor: AegLevel;
  reasons: string[];
}

export interface RouteProposal {
  routeKey: string;
  label: string;
  recipientRole: string;
  approverRole: string;
  copyRoles: string[];
  slaWorkingDays: number;
  closure: string;
  /** Lower-priority routes queued behind the primary (§7.4). */
  queued: boolean;
}

export interface Evaluation {
  studentId: string;
  policyVersion: string;
  engineVersion: string;
  trackScore: TrackScore;
  readiness: number;
  gapRatio: number;
  gapIndex: AegLevel;
  personas: PersonaMatch[];
  primaryPersona: PersonaId | null;
  aegIndex: AegLevel;
  /** Which input drove the final index (§7.2: shown separately). */
  aegDrivenBy: "gap" | "persona";
  attendanceCriticalFlag: boolean;
  watchBand: boolean;
  trend: {
    overall: TrendLabel;
    signals: Record<string, { slope: number | null; label: TrendLabel }>;
    streakNote: string | null;
  };
  pivot: {
    recommended: boolean;
    recommendedTrack: TrackId | null;
    reasons: string[];
  };
  routes: RouteProposal[];
}
