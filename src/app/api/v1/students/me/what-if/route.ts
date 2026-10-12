import { z } from "zod";
import { handle, json } from "@/server/api/handler";
import { meStudent } from "@/server/api/me";
import { getActivePolicy } from "@/server/policy/load";
import { whatIf } from "@/server/rules";
import type { StudentFacts } from "@/server/rules/types";
import { loadStudentFacts } from "@/server/services/facts";

const body = z.object({
  campusAptitudePercentile: z.number().min(0).max(100).optional(),
  verifiedInternshipHours: z.number().min(0).max(2000).optional(),
  mockInterviewRating: z.number().min(1).max(5).optional(),
  verifyStandardItems: z.array(z.string().max(60)).max(20).optional(),
});

/** POST /api/v1/students/me/what-if — recompute with hypothetical inputs. Writes nothing. */
export const POST = handle(async (req: Request) => {
  const { student } = await meStudent();
  const h = body.parse(await req.json());
  const facts = await loadStudentFacts(student.id);
  const result = whatIf(
    facts,
    (f): StudentFacts => ({
      ...f,
      campusAptitudePercentile: h.campusAptitudePercentile ?? f.campusAptitudePercentile,
      verifiedInternshipHours: h.verifiedInternshipHours ?? f.verifiedInternshipHours,
      ratings: h.mockInterviewRating
        ? [
            ...f.ratings.filter((r) => r.kind !== "mock_interview"),
            {
              id: "what-if",
              kind: "mock_interview",
              date: "9999-12-31",
              rating: h.mockInterviewRating,
              status: "ATTESTED",
            },
          ]
        : f.ratings,
      evidence: [
        ...f.evidence,
        ...(h.verifyStandardItems ?? []).map((item) => ({
          id: `what-if-${item}`,
          component: "domain_practical_evidence",
          standardItem: item,
          label: item,
          status: "VERIFIED" as const,
        })),
      ],
    }),
    await getActivePolicy(),
  );
  return json({
    trackScore: result.trackScore.score,
    gapRatio: result.gapRatio,
    gapIndex: result.gapIndex,
    components: result.trackScore.components,
  });
});
