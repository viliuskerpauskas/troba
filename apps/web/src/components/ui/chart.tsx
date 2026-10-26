"use client";

// shadcn/ui's chart, trimmed to its container: the theme's look for Recharts (muted axis text,
// border-colored grid lines) around a ResponsiveContainer. Its config, context, injected
// <style>, tooltip and legend are left out until a chart needs them; a series takes its color
// as a theme variable, such as fill="var(--color-primary)", which follows prefers-color-scheme.
// Recharts 3.10 names axis tick text recharts-cartesian-axis-tick-value, so the tick selector
// targets that.

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/lib/utils";

const INITIAL_DIMENSION = { width: 320, height: 200 } as const;

function ChartContainer({
  className,
  children,
  initialDimension = INITIAL_DIMENSION,
  height,
  ...props
}: React.ComponentProps<"div"> & {
  // A height in pixels, for a chart whose height follows its data; otherwise the container's
  // aspect ratio sets it.
  height?: number;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  initialDimension?: {
    width: number;
    height: number;
  };
}) {
  return (
    <div
      data-slot="chart"
      className={cn(
        "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick-value]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
        className,
      )}
      {...props}
    >
      <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension} height={height}>
        {children}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  );
}

export { ChartContainer };
