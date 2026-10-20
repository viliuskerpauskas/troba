"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

type ChartBar = {
  name: string;
  // Bars are as long as their share: every bar is over the same total, so the proportions are
  // the amounts', and no amount goes through a float. Labels are the server-formatted amounts.
  shareBasisPoints: number;
  label: string;
};

const barHeight = 36;

// A client component because Recharts measures and draws in the browser. The table beside it
// carries the same figures, so the chart is one image to assistive technology.
export function SpendingChart({ bars, title }: { bars: ChartBar[]; title: string }) {
  return (
    <figure role="img" aria-label={title} style={{ margin: 0, width: "100%" }}>
      <ResponsiveContainer width="100%" height={bars.length * barHeight + 16}>
        <BarChart data={bars} layout="vertical" margin={{ top: 8, right: 96, bottom: 8, left: 8 }}>
          <XAxis type="number" dataKey="shareBasisPoints" hide />
          <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} />
          <Bar dataKey="shareBasisPoints" fill="currentColor" isAnimationActive={false}>
            <LabelList dataKey="label" position="right" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
