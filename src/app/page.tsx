"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import type { GetLLMTradingDecisionOutput } from "@/ai/flows/llm-powered-trading-decisions";
import { getAIDecisionAction } from "@/app/actions";
import { AIDecisionPanel } from "@/components/ai-decision-panel";
import { DashboardLayout } from "@/components/dashboard-layout";
import { MarketOverview } from "@/components/market-overview";
import { OrderLog, type Trade } from "@/components/order-log";
import { PNLSummary } from "@/components/pnl-summary";
import { Button } from "@/components/ui/button";
import { RefreshCw, Bot, CircleUserRound, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Position = {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  size: number; // in USDT
}

const INITIAL_CAPITAL = 5000;
const RISK_PER_TRADE = 0.005; // 0.5%
const DAILY_LOSS_LIMIT = -0.02; // -2%
const AUTOMATION_INTERVAL = 10000; // 10 seconds

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [capital, setCapital] = useState(INITIAL_CAPITAL);
  const [dailyPnl, setDailyPnl] = useState(0);
  const [isAutomationEnabled, setIsAutomationEnabled] = useState(false);
  const [lastDecision, setLastDecision] = useState<GetLLMTradingDecisionOutput | null>(null);
  const [openPosition, setOpenPosition] = useState<Position | null>(null);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const dailyLossPercent = capital > 0 ? dailyPnl / INITIAL_CAPITAL : 0;
  const isKillSwitchActive = dailyLossPercent <= DAILY_LOSS_LIMIT;

  const handleNewDecision = useCallback((decision: GetLLMTradingDecisionOutput, executionResult: any, latestPrice: number) => {
    setLastDecision(decision);

    // Case 1: HOLD or failed execution - just log it
    if (decision.action === "HOLD" || !executionResult?.success) {
      const newTrade: Trade = {
        id: new Date().toISOString() + Math.random(),
        timestamp: new Date(),
        pair: decision.pair,
        action: decision.action,
        price: latestPrice,
        notional: 0,
        pnl: 0,
        rationale: executionResult?.success === false ? `Execution Failed: ${executionResult.message}` : decision.rationale,
        status: executionResult?.success === false ? "Failed" : "Logged",
      };
      setTrades(prev => [newTrade, ...prev].slice(0, 100));
      return;
    }

    // Case 2: Closing an existing position
    if (openPosition && ((openPosition.side === 'LONG' && decision.action === 'SELL') || (openPosition.side === 'SHORT' && decision.action === 'BUY'))) {
        const pnl = openPosition.side === 'LONG' 
            ? (latestPrice - openPosition.entryPrice) * (openPosition.size / openPosition.entryPrice) 
            : (openPosition.entryPrice - latestPrice) * (openPosition.size / openPosition.entryPrice);
        
        const newTrade: Trade = {
            id: executionResult?.orderId || new Date().toISOString(),
            timestamp: new Date(),
            pair: decision.pair,
            action: decision.action,
            price: latestPrice,
            notional: openPosition.size,
            pnl: parseFloat(pnl.toFixed(2)),
            rationale: `CLOSE: ${decision.rationale}`,
            status: "Closed",
        };

        setTrades(prev => [newTrade, ...prev].slice(0, 100));
        setCapital(prev => prev + pnl);
        setDailyPnl(prev => prev + pnl);
        setOpenPosition(null); // Position is now closed
        return;
    }

    // Case 3: Opening a new position
    if (!openPosition && (decision.action === 'BUY' || decision.action === 'SELL')) {
        const newPosition: Position = {
            side: decision.action === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: latestPrice,
            size: decision.notional_usdt,
        };
        
        const newTrade: Trade = {
            id: executionResult?.orderId || new Date().toISOString(),
            timestamp: new Date(),
            pair: decision.pair,
            action: decision.action,
            price: latestPrice,
            notional: decision.notional_usdt,
            pnl: 0,
            rationale: `OPEN: ${decision.rationale}`,
            status: "Open",
        };

        setTrades(prev => [newTrade, ...prev].slice(0, 100));
        setOpenPosition(newPosition);
    }
  }, [openPosition]);
  
  const getAIDecision = useCallback((execute: boolean = false) => {
    if(isPending || isKillSwitchActive) return;

    startTransition(async () => {
      const currentPrice = 65000 + (Math.random() - 0.5) * 2000; // Mock price
      const pnlPercent = openPosition 
        ? ((currentPrice - openPosition.entryPrice) / openPosition.entryPrice) * (openPosition.side === 'LONG' ? 1 : -1) * 100
        : 0;

      const aiInput = {
        availableCapital: capital,
        riskPerTrade: RISK_PER_TRADE,
        currentPosition: {
          status: openPosition ? openPosition.side : ('NONE' as 'NONE' | 'LONG' | 'SHORT'),
          entryPrice: openPosition?.entryPrice,
          pnlPercent: pnlPercent,
        }
      };
      
      const { data, error, executionResult, latestPrice } = await getAIDecisionAction(aiInput, execute);
      
      if (error) {
        toast({
          variant: "destructive",
          title: "AI Error",
          description: error,
        });
        setLastDecision(null);
      } else if (data && latestPrice) {
        handleNewDecision(data, executionResult, latestPrice);
      }
    });
  }, [isPending, capital, isKillSwitchActive, handleNewDecision, toast, openPosition]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (isAutomationEnabled && !isKillSwitchActive) {
      getAIDecision(true); 
      intervalId = setInterval(() => getAIDecision(true), AUTOMATION_INTERVAL);
    }
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isAutomationEnabled, isKillSwitchActive, getAIDecision]);

  const resetSimulation = () => {
    setTrades([]);
    setCapital(INITIAL_CAPITAL);
    setDailyPnl(0);
    setLastDecision(null);
    setOpenPosition(null);
    setIsAutomationEnabled(false);
  };
  
  const manualDecisionDisabled = isPending || isKillSwitchActive || isAutomationEnabled;

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-6 p-4 md:p-8">
        <div className="flex items-center justify-between space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            CryptoSage Dashboard
          </h1>
          <div className="flex items-center gap-4">
             <div className="flex items-center space-x-2">
              <Switch 
                id="automation-mode" 
                checked={isAutomationEnabled} 
                onCheckedChange={setIsAutomationEnabled}
                disabled={isKillSwitchActive}
              />
              <Label htmlFor="automation-mode" className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Autonomous Mode
              </Label>
            </div>
            <Button onClick={resetSimulation} variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Reset Simulation
            </Button>
          </div>
        </div>
         {isKillSwitchActive && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Kill-Switch Ativo</AlertTitle>
            <AlertDescription>
              As operações foram desativadas por atingir o limite de perda diária. Resete a simulação para continuar.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
          <div className="lg:col-span-4 space-y-6">
             <MarketOverview />
          </div>
          <div className="lg:col-span-3 space-y-6">
            <AIDecisionPanel 
              decision={lastDecision}
              onGetDecision={() => getAIDecision(false)}
              isPending={isPending}
              disabled={manualDecisionDisabled}
              isAutomated={isAutomationEnabled}
            />
            <PNLSummary 
              capital={capital}
              initialCapital={INITIAL_CAPITAL}
              dailyPnl={dailyPnl}
              dailyLossLimit={DAILY_LOSS_LIMIT}
            />
          </div>
          <div className="lg:col-span-7">
            <OrderLog trades={trades} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
