"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MoreHorizontal,
  HelpCircle,
  Check,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@/lib/formatters";
import {
  updateTransactionCategory,
  setTransactionKind,
  approveTransactionCategory,
  getCategories,
} from "@/lib/api";
import { translateCategoryName } from "@/lib/i18n-data";
import type { TransactionWithCategory, Category } from "@/lib/types";
import type { Locale } from "@/i18n/routing";

type Kind = "expense" | "income" | "transfer";

interface TransactionsTableProps {
  transactions: TransactionWithCategory[];
  total: number;
  categories: Category[];
  loading: boolean;
  search: string;
  onSearchChange: (search: string) => void;
  categoryFilter: number | undefined;
  onCategoryFilterChange: (category: number | undefined) => void;
  page: number;
  onPageChange: (page: number) => void;
}

const PAGE_SIZE = 50;

export function TransactionsTable({
  transactions,
  total,
  categories,
  loading,
  search,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  page,
  onPageChange,
}: TransactionsTableProps) {
  const t = useTranslations("transactions");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const otherKinds: Record<Kind, Array<{ value: Kind; label: string }>> = {
    expense: [
      { value: "income", label: t("markAsIncome") },
      { value: "transfer", label: t("markAsTransfer") },
    ],
    income: [
      { value: "expense", label: t("markAsExpense") },
      { value: "transfer", label: t("markAsTransfer") },
    ],
    transfer: [
      { value: "expense", label: t("markAsExpense") },
      { value: "income", label: t("markAsIncome") },
    ],
  };

  const handleCategoryChange = async (txnId: number, categoryId: number) => {
    setUpdatingId(txnId);
    try {
      await updateTransactionCategory(txnId, categoryId);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleKindChange = async (txnId: number, next: Kind) => {
    setUpdatingId(txnId);
    try {
      await setTransactionKind(txnId, next);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleApprove = async (txnId: number) => {
    setUpdatingId(txnId);
    try {
      await approveTransactionCategory(txnId);
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
    } finally {
      setUpdatingId(null);
    }
  };

  const incomeCategoriesQuery = useQuery({
    queryKey: ["categories", "income"],
    queryFn: () => getCategories("income"),
  });
  const expenseCategoriesQuery = useQuery({
    queryKey: ["categories", "expense"],
    queryFn: () => getCategories("expense"),
  });

  const categoriesForKind = (rowKind: Kind): Category[] => {
    if (rowKind === "income") return incomeCategoriesQuery.data ?? [];
    if (rowKind === "expense") return expenseCategoriesQuery.data ?? [];
    return [];
  };

  return (
    <Card className="rounded-2xl border border-border bg-card shadow-none">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="font-serif text-2xl font-normal">
            {t("pageTitle")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder={t("search")}
              value={search}
              onChange={(e) => {
                onSearchChange(e.target.value);
                onPageChange(0);
              }}
              className="h-8 w-[200px]"
            />
            <Select
              value={categoryFilter ? String(categoryFilter) : "all"}
              onValueChange={(v) => {
                if (!v) return;
                onCategoryFilterChange(v === "all" ? undefined : Number(v));
                onPageChange(0);
              }}
            >
              <SelectTrigger className="h-8 w-[160px]">
                <SelectValue placeholder={t("allCategories")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allCategories")}</SelectItem>
                {(() => {
                  const parentIds = new Set(
                    categories
                      .map((c) => c.parentId)
                      .filter((p): p is number => p != null)
                  );
                  const childrenByParent = new Map<number, typeof categories>();
                  for (const c of categories) {
                    if (c.parentId != null) {
                      const list = childrenByParent.get(c.parentId) ?? [];
                      list.push(c);
                      childrenByParent.set(c.parentId, list);
                    }
                  }
                  const tops = categories
                    .filter((c) => c.parentId == null)
                    .sort((a, b) => a.name.localeCompare(b.name));
                  const nodes: React.ReactNode[] = [];
                  for (const top of tops) {
                    const kids = childrenByParent.get(top.id) ?? [];
                    const topName = translateCategoryName(top.name, tCat);
                    if (parentIds.has(top.id)) {
                      nodes.push(
                        <SelectItem key={top.id} value={String(top.id)}>
                          <div className="flex items-center gap-2 font-semibold">
                            <div
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: top.color }}
                            />
                            {topName}
                          </div>
                        </SelectItem>
                      );
                      for (const child of kids) {
                        nodes.push(
                          <SelectItem
                            key={child.id}
                            value={String(child.id)}
                          >
                            <div className="flex items-center gap-2 ps-3">
                              <div
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: child.color }}
                              />
                              {translateCategoryName(child.name, tCat)}
                            </div>
                          </SelectItem>
                        );
                      }
                    } else {
                      nodes.push(
                        <SelectItem key={top.id} value={String(top.id)}>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: top.color }}
                            />
                            {topName}
                          </div>
                        </SelectItem>
                      );
                    }
                  }
                  return nodes;
                })()}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {search || categoryFilter
              ? t("emptyWithFilters")
              : t("emptyNoData")}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[32px]" />
                  <TableHead className="w-[100px]">{t("headerDate")}</TableHead>
                  <TableHead>{t("headerDescription")}</TableHead>
                  <TableHead className="w-[150px]">{t("headerCategory")}</TableHead>
                  <TableHead className="w-[120px] text-end">
                    {t("headerAmount")}
                  </TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((txn) => {
                  const isIncome = txn.chargedAmount > 0;
                  const directionColor = isIncome
                    ? "var(--status-on-track)"
                    : "var(--status-over)";
                  const categoryKind: Kind = isIncome ? "income" : "expense";
                  const categoryName = txn.categoryName
                    ? translateCategoryName(txn.categoryName, tCat)
                    : t("rowUncategorized");
                  return (
                    <TableRow
                      key={txn.id}
                      className="transition-colors duration-200 hover:bg-muted/50"
                    >
                      <TableCell>
                        <div style={{ color: directionColor }}>
                          {isIncome ? (
                            <ArrowUpRight className="h-4 w-4" />
                          ) : (
                            <ArrowDownRight className="h-4 w-4" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {formatDate(txn.date)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{txn.description}</div>
                          {txn.needsReview && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor:
                                  "color-mix(in oklch, var(--status-heads-up) 18%, transparent)",
                                color: "var(--status-heads-up)",
                              }}
                              title={
                                txn.aiConfidence != null
                                  ? t("rowReviewTooltipConfidence", { score: txn.aiConfidence })
                                  : t("rowReviewTooltipUnsure")
                              }
                            >
                              <HelpCircle className="h-3 w-3" />
                              {t("rowReview")}
                              {txn.aiConfidence != null && (
                                <span className="ms-0.5 tabular-nums">
                                  {txn.aiConfidence}/7
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        {txn.memo && (
                          <div className="text-xs text-muted-foreground">
                            {txn.memo}
                          </div>
                        )}
                        {txn.type === "installments" &&
                          txn.installmentNumber &&
                          txn.installmentTotal && (
                            <div className="text-xs text-muted-foreground">
                              {t("rowInstallment", {
                                n: txn.installmentNumber,
                                total: txn.installmentTotal,
                              })}
                            </div>
                          )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="inline-flex"
                              disabled={updatingId === txn.id}
                            >
                              <Badge
                                variant="outline"
                                className="cursor-pointer transition-colors hover:bg-accent"
                                style={
                                  txn.categoryColor
                                    ? {
                                        borderColor: txn.categoryColor + "40",
                                        backgroundColor: txn.categoryColor + "15",
                                        color: txn.categoryColor,
                                      }
                                    : undefined
                                }
                              >
                                {categoryName}
                              </Badge>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {categoriesForKind(categoryKind).map((cat) => (
                                <DropdownMenuItem
                                  key={cat.id}
                                  onClick={() =>
                                    handleCategoryChange(txn.id, cat.id)
                                  }
                                >
                                  <div
                                    className="me-2 h-2 w-2 rounded-full"
                                    style={{ backgroundColor: cat.color }}
                                  />
                                  {translateCategoryName(cat.name, tCat)}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {txn.needsReview && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleApprove(txn.id)}
                              disabled={updatingId === txn.id}
                              className="h-6 gap-1 px-2 text-[11px] font-medium"
                              style={{
                                borderColor:
                                  "color-mix(in oklch, var(--status-on-track) 35%, transparent)",
                                color: "var(--status-on-track)",
                              }}
                              title={t("rowApproveTooltip")}
                            >
                              <Check className="h-3 w-3" />
                              {t("rowApprove")}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-end font-medium tabular-nums"
                        style={{ color: directionColor }}
                      >
                        {formatCurrency(txn.chargedAmount, "ILS", locale)}
                      </TableCell>
                      <TableCell className="text-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            disabled={updatingId === txn.id}
                            aria-label={t("rowActions")}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {otherKinds[txn.kind].map((opt) => (
                              <DropdownMenuItem
                                key={opt.value}
                                onClick={() => handleKindChange(txn.id, opt.value)}
                              >
                                {opt.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <span className="text-xs text-muted-foreground">
                  {t("paginationRange", {
                    from: page * PAGE_SIZE + 1,
                    to: Math.min((page + 1) * PAGE_SIZE, total),
                    total,
                  })}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page - 1)}
                    disabled={page === 0}
                  >
                    {t("previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages - 1}
                  >
                    {t("next")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
