
"use client";

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { eachDayOfInterval, endOfMonth, format, getDay, startOfMonth, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { Trade } from './order-log';
import { BarChart3 } from 'lucide-react';

interface DailyPnlCalendarProps {
  trades: Trade[];
  initialCapital: number | null;
}

const WEEK_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function DailyPnlCalendar({ trades, initialCapital }: DailyPnlCalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  const [today, setToday] = React.useState(new Date());

  React.useEffect(() => {
    // This effect runs only on the client, after hydration.
    // This ensures that the server and client render the same initial HTML
    // and that `today` is based on the client's clock.
    const clientToday = new Date();
    setToday(clientToday);
    setCurrentMonth(clientToday);
  }, []);

  const firstDayOfMonth = startOfMonth(currentMonth);
  const lastDayOfMonth = endOfMonth(currentMonth);

  const daysInMonth = eachDayOfInterval({
    start: firstDayOfMonth,
    end: lastDayOfMonth,
  });

  const startingDayIndex = getDay(firstDayOfMonth);

  const pnlByDay = React.useMemo(() => {
    const map = new Map<string, { pnl: number, count: number }>();
    if (trades) {
        trades.forEach(trade => {
            if (trade.status === 'Fechada' && trade.timestamp) {
                const dayKey = format(trade.timestamp, 'yyyy-MM-dd');
                const existing = map.get(dayKey) || { pnl: 0, count: 0 };
                existing.pnl += trade.pnl;
                existing.count += 1;
                map.set(dayKey, existing);
            }
        });
    }
    return map;
  }, [trades]);

  const totalProfit = trades
    .filter(t => t.status === 'Fechada')
    .reduce((sum, t) => sum + t.pnl, 0);

  const totalNotional = trades
    .filter(t => t.notional > 0)
    .reduce((sum, t) => sum + t.notional, 0);
  
  const tradeCount = trades.filter(t => t.notional > 0).length;
  const averageNotional = tradeCount > 0 ? totalNotional / tradeCount : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Rentabilidade Diária
        </CardTitle>
        <CardDescription>Visualize o rendimento diário das suas operações no mês atual.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 text-center text-sm text-muted-foreground">
          {WEEK_DAYS.map(day => (
            <div key={day} className="font-semibold">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 mt-2">
          {Array.from({ length: startingDayIndex }).map((_, i) => (
            <div key={`empty-${i}`} className="border-t border-r" />
          ))}
          {daysInMonth.map(day => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const dayData = pnlByDay.get(dayKey);
            const pnlPercent = initialCapital && dayData ? (dayData.pnl / initialCapital) * 100 : 0;
            
            return (
              <div 
                key={day.toString()} 
                className={cn(
                  "h-20 border-t border-r p-1.5 flex flex-col text-sm",
                   getDay(day) === 6 && "border-r-0",
                )}
              >
                <span className={cn(
                    "font-medium",
                    isSameDay(day, today) && "text-primary font-bold"
                )}>{format(day, 'd')}</span>
                {dayData && (
                    <div className={cn(
                        "mt-1 flex-grow flex flex-col items-center justify-center rounded-md text-xs",
                         pnlPercent > 0 ? "bg-green-600/20 text-green-400" : "bg-red-600/20 text-red-400"
                    )}>
                       <span className="font-bold">{pnlPercent.toFixed(1)}%</span>
                       <span className="text-white/70">${dayData.pnl.toFixed(2)}</span>
                    </div>
                )}
              </div>
            );
          })}
           {Array.from({ length: 42 - daysInMonth.length - startingDayIndex }).map((_, i) => (
            <div key={`empty-end-${i}`} className="border-t border-r" />
          ))}
        </div>
         <div className="mt-4 grid grid-cols-2 gap-4 pt-4 border-t">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Lucro Total do Mês</p>
            <p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Notional Médio por Operação</p>
            <p className="text-xl font-bold text-foreground">${averageNotional.toFixed(2)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
