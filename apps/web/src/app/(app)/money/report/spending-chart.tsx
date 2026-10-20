"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

export type ChartBar = {
  name: string;
  // The amount as a decimal string ("12.50"). Recharts needs a number for the bar's length;
  // labels use the server-formatted amount, so no displayed figure goes through a float.
  amount: string;
  label: string;
};

const barHeight = 36;

// A client component because Recharts measures and draws in the browser. The table beside it
// carries the same figures, so the chart is one image to assistive technology.
export function SpendingChart({ bars, title }: { bars: ChartBar[]; title: string }) {
  const data = bars.map((bar) => ({ ...bar, length: Number(bar.amount) }));
  return (
    <figure role="img" aria-label={title} style={{ margin: 0, width: "100%" }}>
      <ResponsiveContainer width="100%" height={data.length * barHeight + 16}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 96, bottom: 8, left: 8 }}>
          <XAxis type="number" dataKey="length" hide />
          <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} />
          <Bar dataKey="length" fill="currentColor" isAnimationActive={false}>
            <LabelList dataKey="label" position="right" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
