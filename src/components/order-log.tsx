
"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";

export interface Trade {
  id: string;
  timestamp: Date;
  pair: string;
  action: "BUY" | "SELL" | "HOLD";
  price: number;
  notional: number;
  pnl: number;
  status: "Aberta" | "Fechada" | "Registrada" | "Falhou";
  rationale: string;
}

interface OrderLogProps {
  trades: Trade[];
}

const getActionBadgeVariant = (action: string) => {
    switch (action) {
      case "BUY":
        return "bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/30";
      case "SELL":
        return "bg-red-600/20 text-red-400 border-red-600/30 hover:bg-red-600/30";
      default:
        return "secondary";
    }
};

const getStatusBadgeVariant = (status: Trade['status']) => {
    switch (status) {
      case "Falhou":
        return "bg-yellow-600/20 text-yellow-400 border-yellow-600/30 hover:bg-yellow-600/30";
      case "Aberta":
        return "bg-blue-600/20 text-blue-400 border-blue-600/30 hover:bg-blue-600/30";
      default:
        return undefined; 
    }
}

export function OrderLog({ trades }: OrderLogProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Log de Execuções</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="w-full h-[400px]">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10">
              <TableRow>
                <TableHead className="min-w-[100px]">Hora</TableHead>
                <TableHead className="min-w-[100px]">Par</TableHead>
                <TableHead className="min-w-[100px]">Ação</TableHead>
                <TableHead className="min-w-[100px]">Status</TableHead>
                <TableHead className="min-w-[120px]">Preço</TableHead>
                <TableHead className="min-w-[120px]">Notional</TableHead>
                <TableHead className="min-w-[120px]">PnL</TableHead>
                <TableHead className="min-w-[350px]">Racional da IA / Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    Nenhuma operação executada ainda.
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="font-medium">{trade.timestamp.toLocaleTimeString()}</TableCell>
                    <TableCell>{trade.pair}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getActionBadgeVariant(trade.action)}>
                        {trade.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                       <Badge variant="outline" className={getStatusBadgeVariant(trade.status)}>
                        {trade.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                        {trade.pair === 'NONE' ? 'N/A' : `$${trade.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 5})}`}
                    </TableCell>
                    <TableCell>${trade.notional.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</TableCell>
                    <TableCell className={trade.pnl > 0 ? 'text-green-400' : trade.pnl < 0 ? 'text-red-400' : ''}>
                      {trade.status === 'Fechada' ? `$${trade.pnl.toFixed(2)}` : 'N/A'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs italic whitespace-normal w-[400px]">
                      {trade.rationale}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
