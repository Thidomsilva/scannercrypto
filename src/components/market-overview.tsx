"use client";

import { useEffect, useState, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { generateChartData, type OHLCVData } from '@/lib/mock-data';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

const indicators = [
  { name: 'RSI(14)', value: '58.2' },
  { name: 'EMA(20)', value: '$65,102' },
  { name: 'EMA(50)', value: '$64,879' },
  { name: 'ADX(14)', value: '23.7' },
  { name: 'ATR(14)', value: '$189.43' },
  { name: 'Volume Delta', value: '+34.5 BTC' },
];

export function MarketOverview() {
  const [data, setData] = useState<OHLCVData[]>([]);

  useEffect(() => {
    setData(generateChartData());
    const interval = setInterval(() => {
      setData(prevData => {
        const newData = prevData.slice(1);
        const lastCandle = newData[newData.length - 1];
        const newClose = lastCandle.close + (Math.random() - 0.5) * 50;
        const newCandle: OHLCVData = {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          open: lastCandle.close,
          high: Math.max(lastCandle.close, newClose) + Math.random() * 20,
          low: Math.min(lastCandle.close, newClose) - Math.random() * 20,
          close: newClose,
          volume: Math.floor(Math.random() * 500) + 50,
        };
        return [...newData, newCandle];
      });
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const { price, change, changePercent, isPositive } = useMemo(() => {
    if (data.length < 2) return { price: 0, change: 0, changePercent: 0, isPositive: true };
    const latest = data[data.length - 1];
    const previous = data[data.length - 2];
    const price = latest.close;
    const change = price - previous.close;
    const changePercent = (change / previous.close) * 100;
    return { price, change: change.toFixed(2), changePercent: changePercent.toFixed(2), isPositive: change >= 0 };
  }, [data]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>BTC/USDT</CardTitle>
              <p className="text-2xl font-bold">${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <div className={`flex items-center text-sm ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                {isPositive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                <span>${change} ({changePercent}%)</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="h-[300px] w-full p-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fill: 'hsl(var(--muted-foreground))' }} fontSize={12} tickLine={false} axisLine={false} />
              <YAxis domain={['dataMin - 200', 'dataMax + 200']} orientation="right" tick={{ fill: 'hsl(var(--muted-foreground))' }} fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  borderColor: 'hsl(var(--border))',
                }}
              />
              <Area type="monotone" dataKey="close" stroke="hsl(var(--chart-1))" fillOpacity={1} fill="url(#colorClose)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {indicators.map(indicator => (
          <Card key={indicator.name}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{indicator.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold">{indicator.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
