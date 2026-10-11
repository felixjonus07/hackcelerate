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
  /**
   * What the artifact is: repository | project | lab_record | paper | interview_log | sop_review |
   * fitness_record | camp_record | medal | … Rubrics that need structured values read `details`.
   */
  kind?: string;
  /** Structured values recorded with the artifact (camp days, Cooper distance, deployment uptime…). */
  details?: Record<string, unknown>;
}

/** A self-set milestone with its due and completion dates (§5.3.2, §5.3.3). */
export interface Milestone {
  id: string;
  scope: "application" | "venture";
  title: string;
  /** ISO date. */
  dueOn: string;
  completedOn: string | null;
}

export interface MockAttempt {
  id: string;
  testType: string;
  /** ISO date (yyyy-mm-dd). */
  date: string;
  items: number;
  percentile: number;
  /** Raw score and the test's maximum, for tests reported as accuracy (weekly tests). */
  score?: number;
  maxScore?: number;
  avgSecondsPerItem: number;
  targetSecondsPerItem?: number;
  itemKind?: "mcq" | "numerical";
  /** Difficulty band of a timed set, for the speed score. */
  difficulty?: string;
  /** Where the result came from (campus platform, a named external test body…); labelled in the passport. */
  source?: string;
  status: VerificationStatus;
}

export interface FacultyRating {
  id: string;
  kind: "mock_interview" | "answer_writing" | "psychometric" | "customer_validation";
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

/** What the §4.3 data-quality checks found while the facts were assembled. */
export interface DataQualityNotes {
  /** Why the CGPA was excluded from scoring (it is also null in `cgpa`). */
  cgpa?: string;
  /** Weeks in the look-back window with no valid attendance record. */
  attendanceWeeksMissing?: number;
  /** The confidence cap those missing weeks imply (§4.3). */
  attendanceCap?: "NONE" | "MEDIUM" | "LOW";
  /** Attempt ids stored but excluded from percentile scoring. */
  excludedMocks?: string[];
}

/** A validated snapshot of everything the rubric needs for one student. */
export interface StudentFacts {
  studentId: string;
  /** The ISO date the snapshot describes. Rubrics that depend on dates read this, never the clock. */
  asOf?: string;
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
  /** Credits held, from the ERP; the Sports, Defense and NCC gate reads it (§5.3.6). */
  creditsHeld?: number | null;
  milestones?: Milestone[];
  /** Dates (ISO) with a logged current-affairs session, for the last 60 days (§5.3.4). */
  currentAffairsDates?: string[];
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
  /** Sources that failed within the confidence window (§5.6). */
  recentSourceFailures?: number;
  dataQuality?: DataQualityNotes;
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
  /** Extra measures shown beside the score (for example the speed score of entrance practice). */
  subMeasures?: { label: string; value: string }[];
  /** Department standard items (or required items) with no counted evidence: what a quest can fill. */
  missingItems?: string[];
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
  /**
   * False when the track's gate is not met: the passport then reads "Not enough evidence yet"
   * and shows no score (§5.3). The index is still computed so routing keeps working.
   */
  scoreShown: boolean;
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
