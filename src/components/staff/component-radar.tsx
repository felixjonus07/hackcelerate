"use client";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";

export function ComponentRadar({ data }: { data: { label: string; score: number }[] }) {
  return (
    <figure>
      <div className="h-[260px]" aria-hidden>
        <ResponsiveContainer>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="var(--line)" />
            <PolarAngleAxis dataKey="label" tick={{ fill: "var(--ink-2)", fontSize: 12 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              dataKey="score"
              stroke="var(--ink)"
              fill="var(--ink)"
              fillOpacity={0.14}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="tabular mt-2 grid gap-1 text-sm">
        {data.map((d) => (
          <span key={d.label} className="flex justify-between gap-3">
            <span className="text-ink-2">{d.label}</span>
            <span className="font-bold">{d.score}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
