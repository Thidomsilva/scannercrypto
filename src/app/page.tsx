"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import type { GetLLMTradingDecisionOutput, GetLLMTradingDecisionInput } from "@/ai/flows/llm-powered-trading-decisions";
import { getAIDecisionAction, checkApiStatus, getAccountBalance } from "@/app/actions";
import { AIDecisionPanel } from "@/components/ai-decision-panel";
import { DashboardLayout } from "@/components/dashboard-layout";
import { OrderLog, type Trade } from "@/components/order-log";
import { PNLSummary } from "@/components/pnl-summary";
import { OpenPositionPanel } from "@/components/open-position-panel";
import { Button } from "@/components/ui/button";
import { RefreshCw, Bot, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiStatusIndicator, type ApiStatus } from "@/components/api-status-indicator";

type Position = {
  pair: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  size: number; // in USDT
}

const RISK_PER_TRADE = 0.005; // 0.5%
const DAILY_LOSS_LIMIT = -0.02; // -2%
const AUTOMATION_INTERVAL = 10000; // 10 seconds
const API_STATUS_CHECK_INTERVAL = 30000; // 30 seconds
const TRADABLE_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [initialCapital, setInitialCapital] = useState<number | null>(null);
  const [capital, setCapital] = useState<number | null>(null);
  const [dailyPnl, setDailyPnl] = useState(0);
  const [isAutomationEnabled, setIsAutomationEnabled] = useState(false);
  const [lastDecision, setLastDecision] = useState<GetLLMTradingDecisionOutput | null>(null);
  const [openPosition, setOpenPosition] = useState<Position | null>(null);
  const [latestPriceMap, setLatestPriceMap] = useState<Record<string, number>>({
    'BTC/USDT': 65000,
    'ETH/USDT': 3500,
    'SOL/USDT': 150,
  });
  const [isPending, startTransition] = useTransition();
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const { toast } = useToast();

  const dailyLossPercent = capital && initialCapital ? dailyPnl / initialCapital : 0;
  const isKillSwitchActive = dailyLossPercent <= DAILY_LOSS_LIMIT;
  
  const latestPrice = openPosition ? latestPriceMap[openPosition.pair] : (latestPriceMap['BTC/USDT']);

  const handleApiStatusCheck = useCallback(async () => {
    const status = await checkApiStatus();
    setApiStatus(status);
    if (status === 'connected') {
        fetchBalance();
    } else {
        setCapital(5000); // Fallback to mock capital if disconnected
        setInitialCapital(5000);
    }
  }, []);
  
  const fetchBalance = useCallback(async () => {
      try {
          const balance = await getAccountBalance();
          setCapital(balance);
          if (initialCapital === null) { // Set initial capital only once
              setInitialCapital(balance);
          }
      } catch (e) {
          console.error("Failed to fetch balance:", e);
          toast({
              variant: "destructive",
              title: "Erro ao buscar saldo",
              description: "Não foi possível obter o saldo da conta. Usando valor simulado.",
          });
          setCapital(5000); // Fallback to mock capital
          setInitialCapital(5000);
      }
  }, [toast, initialCapital]);

  useEffect(() => {
    handleApiStatusCheck(); // Initial check
    const intervalId = setInterval(handleApiStatusCheck, API_STATUS_CHECK_INTERVAL);
    return () => clearInterval(intervalId);
  }, [handleApiStatusCheck]);

  const handleNewDecision = useCallback((decision: GetLLMTradingDecisionOutput, executionResult: any, newLatestPrice: number) => {
    setLastDecision(decision);
    setLatestPriceMap(prev => ({...prev, [decision.pair]: newLatestPrice}));

    // Case 1: HOLD or failed execution - just log it
    if (decision.action === "HOLD" || !executionResult?.success) {
      const newTrade: Trade = {
        id: new Date().toISOString() + Math.random(),
        timestamp: new Date(),
        pair: decision.pair,
        action: decision.action,
        price: newLatestPrice,
        notional: 0,
        pnl: 0,
        rationale: executionResult?.success === false ? `Execution Failed: ${executionResult.message}` : decision.rationale,
        status: executionResult?.success === false ? "Failed" : "Logged",
      };
      setTrades(prev => [newTrade, ...prev].slice(0, 100));

       if (executionResult?.success === false) {
        toast({
          variant: "destructive",
          title: "Falha na Execução",
          description: executionResult.message,
          action: <XCircle className="text-destructive-foreground" />,
        });
      }
      return;
    }
    
    // Notify on success
    toast({
        title: `Ordem Executada: ${decision.action} ${decision.pair}`,
        description: `Notional: $${decision.notional_usdt.toFixed(2)} @ $${newLatestPrice.toFixed(2)}`,
        action: <CheckCircle className="text-green-500" />,
    });


    // Case 2: Closing an existing position
    if (openPosition && openPosition.pair === decision.pair && ((openPosition.side === 'LONG' && decision.action === 'SELL') || (openPosition.side === 'SHORT' && decision.action === 'BUY'))) {
        const pnl = openPosition.side === 'LONG' 
            ? (newLatestPrice - openPosition.entryPrice) * (openPosition.size / openPosition.entryPrice) 
            : (openPosition.entryPrice - newLatestPrice) * (openPosition.size / openPosition.entryPrice);
        
        const newTrade: Trade = {
            id: executionResult?.orderId || new Date().toISOString(),
            timestamp: new Date(),
            pair: decision.pair,
            action: decision.action,
            price: newLatestPrice,
            notional: openPosition.size,
            pnl: parseFloat(pnl.toFixed(2)),
            rationale: `CLOSE: ${decision.rationale}`,
            status: "Closed",
        };

        setTrades(prev => [newTrade, ...prev].slice(0, 100));
        setCapital(prev => (prev || 0) + pnl);
        setDailyPnl(prev => prev + pnl);
        setOpenPosition(null); // Position is now closed
        return;
    }

    // Case 3: Opening a new position
    if (!openPosition && (decision.action === 'BUY' || decision.action === 'SELL')) {
        const newPosition: Position = {
            pair: decision.pair,
            side: decision.action === 'BUY' ? 'LONG' : 'SHORT',
            entryPrice: newLatestPrice,
            size: decision.notional_usdt,
        };
        
        const newTrade: Trade = {
            id: executionResult?.orderId || new Date().toISOString(),
            timestamp: new Date(),
            pair: decision.pair,
            action: decision.action,
            price: newLatestPrice,
            notional: decision.notional_usdt,
            pnl: 0,
            rationale: `OPEN: ${decision.rationale}`,
            status: "Open",
        };

        setTrades(prev => [newTrade, ...prev].slice(0, 100));
        setOpenPosition(newPosition);
    }
  }, [openPosition, toast]);
  
  const getAIDecision = useCallback((execute: boolean = false) => {
    if(isPending || isKillSwitchActive || capital === null) return;

    startTransition(async () => {
      const currentPrice = openPosition ? latestPriceMap[openPosition.pair] : 0;
      const pnlPercent = openPosition 
        ? ((currentPrice - openPosition.entryPrice) / openPosition.entryPrice) * (openPosition.side === 'LONG' ? 1 : -1) * 100
        : 0;

      const aiInput: Omit<GetLLMTradingDecisionInput, 'ohlcvData' | 'higherTimeframeTrend' | 'currentPosition' | 'pair'> & { currentPosition: { status: 'NONE' | 'LONG' | 'SHORT'; entryPrice?: number; pnlPercent?: number; size?: number; pair?: string; }} = {
        availableCapital: capital,
        riskPerTrade: RISK_PER_TRADE,
        currentPosition: {
          status: openPosition ? openPosition.side : 'NONE',
          entryPrice: openPosition?.entryPrice,
          pnlPercent: pnlPercent,
          size: openPosition?.size,
          pair: openPosition?.pair,
        },
      };
      
      const { data, error, executionResult, latestPrice: newLatestPrice, pair } = await getAIDecisionAction(aiInput, TRADABLE_PAIRS, execute);
      
      if (error) {
        toast({
          variant: "destructive",
          title: "AI Error",
          description: error,
        });
        setLastDecision(null);
      } else if (data && newLatestPrice && pair) {
        const decisionWithPair = { ...data, pair };
        handleNewDecision(decisionWithPair, executionResult, newLatestPrice);
      }
    });
  }, [isPending, capital, isKillSwitchActive, handleNewDecision, toast, openPosition, latestPriceMap]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (isAutomationEnabled && !isKillSwitchActive && apiStatus === 'connected') {
      getAIDecision(true); 
      intervalId = setInterval(() => getAIDecision(true), AUTOMATION_INTERVAL);
    }
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isAutomationEnabled, isKillSwitchActive, getAIDecision, apiStatus]);

  const resetSimulation = () => {
    setTrades([]);
    setCapital(initialCapital);
    setDailyPnl(0);
    setLastDecision(null);
    setOpenPosition(null);
    setIsAutomationEnabled(false);
    setLatestPriceMap({
        'BTC/USDT': 65000,
        'ETH/USDT': 3500,
        'SOL/USDT': 150,
    });
    handleApiStatusCheck();
    fetchBalance();
  };
  
  const manualDecisionDisabled = isPending || isKillSwitchActive || isAutomationEnabled || apiStatus !== 'connected';

  return (
    <DashboardLayout>
      <div className="flex-1 space-y-6 p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            CryptoSage Dashboard
          </h1>
          <div className="flex w-full md:w-auto items-center justify-between md:justify-end gap-4">
            <ApiStatusIndicator status={apiStatus} />
             <div className="flex items-center space-x-2">
              <Switch 
                id="automation-mode" 
                checked={isAutomationEnabled} 
                onCheckedChange={setIsAutomationEnabled}
                disabled={isKillSwitchActive || apiStatus !== 'connected'}
              />
              <Label htmlFor="automation-mode" className="flex items-center gap-2 text-sm md:text-base">
                <Bot className="h-5 w-5" />
                <span className="hidden sm:inline">Autonomous Mode</span>
                 <span className="sm:hidden">Auto</span>
              </Label>
            </div>
            <Button onClick={resetSimulation} variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Reset
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
        {apiStatus === 'disconnected' && !isKillSwitchActive && (
           <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>API Desconectada</AlertTitle>
            <AlertDescription>
              Não é possível executar trades. Verifique a conexão com a API da corretora e as chaves no arquivo .env. O modo autônomo está desativado.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 flex flex-col gap-6">
            <AIDecisionPanel 
              decision={lastDecision}
              onGetDecision={() => getAIDecision(false)}
              isPending={isPending}
              disabled={manualDecisionDisabled}
              isAutomated={isAutomationEnabled}
            />
          </div>
          <div className="lg:col-span-2 flex flex-col gap-6">
             <div className="grid md:grid-cols-2 gap-6">
                <PNLSummary 
                capital={capital}
                initialCapital={initialCapital}
                dailyPnl={dailyPnl}
                dailyLossLimit={DAILY_LOSS_LIMIT}
                />
                <OpenPositionPanel 
                position={openPosition}
                latestPrice={latestPrice}
                />
            </div>
          </div>
          <div className="lg:col-span-3">
            <OrderLog trades={trades} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

    