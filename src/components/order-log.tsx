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

export interface Trade {
  id: string;
  timestamp: Date;
  pair: string;
  action: "BUY" | "SELL" | "HOLD";
  price: number;
  notional: number;
  pnl: number;
  status: "Closed" | "Logged";
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

export function OrderLog({ trades }: OrderLogProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Log</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="w-full overflow-auto h-[400px]">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Pair</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Notional</TableHead>
                <TableHead>PnL</TableHead>
                <TableHead className="min-w-[300px]">AI Rationale</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    No trades executed yet.
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
                    <TableCell>${trade.status === 'Closed' ? trade.price.toLocaleString() : 'N/A'}</TableCell>
                    <TableCell>${trade.notional.toLocaleString()}</TableCell>
                    <TableCell className={trade.pnl > 0 ? 'text-green-400' : trade.pnl < 0 ? 'text-red-400' : ''}>
                      {trade.status === 'Closed' ? `$${trade.pnl.toFixed(2)}` : 'N/A'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs italic max-w-sm truncate">{trade.rationale}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
