"use client";
/** Track distribution donut with a text summary and a table toggle (§12.4). */
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

// Track series come from tokens in globals.css (--series-1…7). Saffron is reserved for actions.
// Literal names so Tailwind's scanner keeps the variables in the stylesheet.
const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
];

export function TrackDonut({ data }: { data: { name: string; value: number }[] }) {
  const [table, setTable] = useState(false);
  const total = data.reduce((s, d) => s + d.value, 0);
  const top = data[0];
  return (
    <div>
      <p className="text-[0.95rem]">
        {top ? (
          <>
            <strong>{Math.round((top.value / total) * 100)}%</strong> of students are on {top.name}.
          </>
        ) : null}
      </p>
      {table ? (
        <table className="tabular mt-4 w-full text-left text-[0.95rem]">
          <thead className="text-sm text-ink-2">
            <tr>
              <th className="pb-2 font-bold">Track</th>
              <th className="pb-2 text-right font-bold">Students</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((d) => (
              <tr key={d.name}>
                <td className="py-2">{d.name}</td>
                <td className="py-2 text-right font-bold">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mt-2 grid items-center gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div className="h-[200px]" aria-hidden>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {data.map((d, i) => (
                    <Cell key={d.name} fill={SERIES[i % SERIES.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: 14,
                    border: "none",
                    boxShadow: "var(--shadow-card)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="tabular grid min-w-0 gap-2 text-[0.95rem]">
            {data.map((d, i) => (
              <li key={d.name} className="flex min-w-0 items-center justify-between gap-3">
                <span className="flex min-w-0 items-start gap-2">
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: SERIES[i % SERIES.length] }}
                  />
                  <span className="leading-snug">{d.name}</span>
                </span>
                <span className="font-bold">{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="press mt-3 inline-flex h-9 items-center rounded-full px-4 text-sm font-bold text-act hover:bg-act-soft"
        onClick={() => setTable((t) => !t)}
      >
        {table ? "Show chart" : "Show as table"}
      </button>
    </div>
  );
}
