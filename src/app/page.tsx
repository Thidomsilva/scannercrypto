"use client";

import { useState, useEffect, useCallback, useTransition, Suspense, ReactNode } from "react";
import type { GetLLMTradingDecisionOutput, GetLLMTradingDecisionInput } from "@/ai/flows/llm-powered-trading-decisions";
import { getAIDecisionStream, checkApiStatus, getAccountBalance } from "@/app/actions";
import { AIDecisionPanel, AIDecisionPanelContent, AIStatus } from "@/components/ai-decision-panel";
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
import { AnalysisGrid } from "@/components/analysis-grid";


type Position = {
  pair: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  size: number; // in USDT
}

const RISK_PER_TRADE = 0.3; // 30% - Adjusted for low test capital
const DAILY_LOSS_LIMIT = -0.02; // -2%
const AUTOMATION_INTERVAL = 10000; // 10 seconds
const API_STATUS_CHECK_INTERVAL = 30000; // 30 seconds
const TRADABLE_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT', 'MATIC/USDT'];

export default function Home() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [initialCapital, setInitialCapital] = useState<number | null>(null);
  const [capital, setCapital] = useState<number | null>(null);
  const [dailyPnl, setDailyPnl] = useState(0);
  const [isAutomationEnabled, setIsAutomationEnabled] = useState(false);
  const [openPosition, setOpenPosition] = useState<Position | null>(null);
  const [latestPriceMap, setLatestPriceMap] = useState<Record<string, number>>({
    'BTC/USDT': 65000,
    'ETH/USDT': 3500,
    'SOL/USDT': 150,
    'XRP/USDT': 0.47,
    'DOGE/USDT': 0.12,
    'MATIC/USDT': 0.57,
  });
  const [isPending, startTransition] = useTransition();
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [aiDecisionUI, setAiDecisionUI] = useState<ReactNode | null>(null);
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
        setCapital(18); // Fallback to mock capital if disconnected
        setInitialCapital(18);
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
          setCapital(18); // Fallback to mock capital
          if (initialCapital === null) {
             setInitialCapital(18);
          }
      }
  }, [toast, initialCapital]);

  useEffect(() => {
    handleApiStatusCheck(); // Initial check
    const intervalId = setInterval(handleApiStatusCheck, API_STATUS_CHECK_INTERVAL);
    return () => clearInterval(intervalId);
  }, [handleApiStatusCheck]);

  const handleNewDecision = useCallback((decision: GetLLMTradingDecisionOutput, executionResult: any, newLatestPrice: number) => {
    if (decision.pair !== 'NONE') {
        setLatestPriceMap(prev => ({...prev, [decision.pair]: newLatestPrice}));
    }

    if (decision.action === "HOLD" || executionResult?.success === false) {
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
    
    if (!executionResult?.orderId && decision.action !== 'HOLD') {
        const logMessage: Trade = {
            id: new Date().toISOString() + Math.random(),
            timestamp: new Date(),
            pair: decision.pair,
            action: 'HOLD',
            price: newLatestPrice,
            notional: 0,
            pnl: 0,
            rationale: executionResult.message || decision.rationale,
            status: "Logged",
        };
        setTrades(prev => [logMessage, ...prev].slice(0, 100));
        return;
    }
    
    toast({
        title: `Ordem Executada: ${decision.action} ${decision.pair}`,
        description: `Notional: $${decision.notional_usdt.toFixed(2)} @ $${newLatestPrice.toFixed(2)}`,
        action: <CheckCircle className="text-green-500" />,
    });


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
        setOpenPosition(null);
        return;
    }

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
      // Set the initial UI to the AnalysisGrid
      setAiDecisionUI(<AnalysisGrid pairs={TRADABLE_PAIRS} currentlyAnalyzing={null} statusText="Iniciando varredura..." />);

      const currentPrice = openPosition ? latestPriceMap[openPosition.pair] : 0;
      const pnlPercent = openPosition 
        ? ((currentPrice - openPosition.entryPrice) / openPosition.entryPrice) * (openPosition.side === 'LONG' ? 1 : -1) * 100
        : 0;

      const aiInput: Omit<GetLLMTradingDecisionInput, 'ohlcvData' | 'higherTimeframeTrend' | 'pair' | 'watcherRationale'> = {
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
      
      const { ui, result } = await getAIDecisionStream(aiInput, TRADABLE_PAIRS, execute);
      setAiDecisionUI(ui);

      const { data, error, executionResult, latestPrice: newLatestPrice, pair } = await result;
      
      if (error) {
        toast({
          variant: "destructive",
          title: "AI Error",
          description: error,
        });
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
    setOpenPosition(null);
    setIsAutomationEnabled(false);
    setAiDecisionUI(null);
    setLatestPriceMap({
      'BTC/USDT': 65000,
      'ETH/USDT': 3500,
      'SOL/USDT': 150,
      'XRP/USDT': 0.47,
      'DOGE/USDT': 0.12,
      'MATIC/USDT': 0.57,
    });
    handleApiStatusCheck();
  };
  
  const manualDecisionDisabled = isPending || isKillSwitchActive || isAutomationEnabled || apiStatus !== 'connected';
  const isAutomated = isAutomationEnabled && !isKillSwitchActive && apiStatus === 'connected';

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
                onCheckedChange={(checked) => {
                  setIsAutomationEnabled(checked);
                  if (!checked) setAiDecisionUI(null);
                }}
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
               O robô não pode operar. Adicione o IP do servidor à lista de permissões da sua chave de API na MEXC para resolver o problema de conexão.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 flex flex-col gap-6">
            <AIDecisionPanel 
              onGetDecision={() => getAIDecision(false)}
              isPending={isPending}
              disabled={manualDecisionDisabled}
              isAutomated={isAutomated}
            >
              <Suspense fallback={<AnalysisGrid pairs={TRADABLE_PAIRS} currentlyAnalyzing={null} />}>
                 {aiDecisionUI ?? <AIStatus status="Aguardando decisão da IA..." />}
              </Suspense>
            </AIDecisionPanel>
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
