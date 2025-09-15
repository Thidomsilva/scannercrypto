"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface PNLSummaryProps {
  capital: number;
  initialCapital: number;
  dailyPnl: number;
  dailyLossLimit: number;
}

export function PNLSummary({ capital, initialCapital, dailyPnl, dailyLossLimit }: PNLSummaryProps) {
  const dailyPnlPercent = initialCapital > 0 ? (dailyPnl / initialCapital) * 100 : 0;
  const isKillSwitchActive = dailyPnlPercent / 100 <= dailyLossLimit;
  const dailyLossLimitPercent = dailyLossLimit * 100;
  
  // For progress bar: value from 0 to 100.
  // We want to show how close we are to the loss limit.
  // 0% loss = 100 on progress, -2% loss = 0 on progress.
  const progressValue = Math.max(0, 100 * (1 + dailyPnlPercent / Math.abs(dailyLossLimitPercent)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance & Risk</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-baseline">
            <span className="text-sm font-medium text-muted-foreground">Total Capital</span>
            <span className="text-2xl font-bold">${capital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-sm font-medium text-muted-foreground">Daily PnL</span>
            <span className={`text-lg font-semibold ${dailyPnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
              {dailyPnl >= 0 ? '+' : ''}${dailyPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({dailyPnlPercent.toFixed(2)}%)
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-muted-foreground">Daily Loss Limit Status</span>
            <span className={isKillSwitchActive ? 'text-destructive font-bold' : 'text-muted-foreground'}>
                {dailyPnlPercent.toFixed(2)}% / {dailyLossLimitPercent}%
            </span>
          </div>
          <Progress value={progressValue} className={isKillSwitchActive ? '[&>div]:bg-destructive' : '[&>div]:bg-primary'} />
           {isKillSwitchActive && <p className="text-xs text-center text-destructive font-semibold">KILL-SWITCH ACTIVE</p>}
        </div>
      </CardContent>
    </Card>
  );
}
