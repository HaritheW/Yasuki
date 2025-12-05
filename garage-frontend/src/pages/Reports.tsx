import { useEffect, useMemo, useState } from "react";
import { DateRange } from "react-day-picker";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Download, FileText, TrendingUp, Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { apiFetch, API_BASE_URL } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";

type ReportType = "revenue" | "expense" | "job" | "inventory";
type TimeframeOption = "daily" | "monthly" | "yearly" | "custom";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

type ExpenseReport = {
  range: { startDate: string; endDate: string; label?: string };
  totals: { totalAmount: number };
  categories: { category: string; count: number; total: number }[];
  statuses: { status: string; count: number; total: number }[];
  expenses: {
    id: number;
    description: string;
    category: string | null;
    amount: number;
    expense_date: string;
    payment_status: string | null;
    payment_method: string | null;
    remarks: string | null;
  }[];
};

type JobReport = {
  range: { startDate: string; endDate: string; label?: string };
  totals: { jobCount: number; completedRevenue: number };
  statuses: { status: string; count: number }[];
  jobs: {
    id: number;
    description: string;
    job_status: string;
    created_at: string;
    category: string | null;
    customer_name: string | null;
    plate: string | null;
    invoice_no: string | null;
    final_total: number | null;
  }[];
};

type InventoryReport = {
  range: { startDate: string; endDate: string; label?: string };
  totals: { itemCount: number; lowStockCount: number };
  lowStock: { id: number; name: string; quantity: number; reorder_level: number }[];
  mostUsed: { id: number; name: string; total_used: number; type: string }[];
  items: {
    id: number;
    name: string;
    type: string;
    quantity: number;
    reorder_level: number;
    total_used: number;
    low_stock: number;
  }[];
};

const revenueData = [
  { month: "Jan", revenue: 45000 },
  { month: "Feb", revenue: 52000 },
  { month: "Mar", revenue: 48000 },
  { month: "Apr", revenue: 61000 },
  { month: "May", revenue: 55000 },
  { month: "Jun", revenue: 67000 },
];

const categoryData = [
  { name: "Oil Changes", value: 35, color: "hsl(var(--chart-1))" },
  { name: "Brake Services", value: 25, color: "hsl(var(--chart-2))" },
  { name: "Engine Repair", value: 20, color: "hsl(var(--chart-3))" },
  { name: "Tire Services", value: 15, color: "hsl(var(--chart-4))" },
  { name: "Other", value: 5, color: "hsl(var(--chart-5))" },
];

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const startOfYear = (date: Date) => new Date(date.getFullYear(), 0, 1);
const endOfYear = (date: Date) => new Date(date.getFullYear(), 11, 31);

const generateMonthOptions = (anchor: Date, count = 24) => {
  const months: { label: string; start: Date; end: Date }[] = [];
  const base = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  for (let i = 0; i < count; i += 1) {
    const current = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const start = startOfMonth(current);
    const end = endOfMonth(current);
    const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(start);
    months.push({ label, start, end });
  }
  return months;
};

const formatMonthYear = (date: Date | null | undefined) =>
  date ? new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(date) : "—";
const formatDisplayDate = (date?: Date | null) =>
  date
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      }).format(date)
    : "—";

const toISODateLocal = (date: Date | null | undefined) => {
  if (!date) return null;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const Reports = () => {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [reportType, setReportType] = useState<ReportType>("revenue");
  const [timeframe, setTimeframe] = useState<TimeframeOption>("monthly");
  const [singleDate, setSingleDate] = useState<Date>(today);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => ({
    from: startOfMonth(today),
    to: endOfMonth(today),
  }));
  const monthOptions = useMemo(() => generateMonthOptions(today, 36), [today]);

  useEffect(() => {
    const now = startOfDay(new Date());
    switch (timeframe) {
      case "daily": {
        setSingleDate(now);
        setDateRange(undefined);
        break;
      }
      case "monthly": {
        setDateRange({ from: startOfMonth(now), to: endOfMonth(now) });
        break;
      }
      case "yearly": {
        setSingleDate(now);
        setDateRange(undefined);
        break;
      }
      case "custom": {
        if (!dateRange?.from || !dateRange?.to) {
          const defaultFrom = addDays(now, -29);
          setDateRange({ from: defaultFrom, to: now });
        }
        break;
      }
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  const activeRange = useMemo(() => {
    switch (timeframe) {
      case "daily":
        return { from: singleDate, to: singleDate };
      case "monthly":
      case "custom":
        return dateRange;
      case "yearly":
        return { from: new Date(singleDate.getFullYear(), 0, 1), to: new Date(singleDate.getFullYear(), 11, 31) };
      default:
        return undefined;
    }
  }, [timeframe, singleDate, dateRange]);

  const timeframeLabels: Record<TimeframeOption, string> = {
    daily: "Daily",
    monthly: "Monthly",
    yearly: "Yearly",
    custom: "Custom",
  };

  const appliedRangeLabel = useMemo(() => {
    if (!activeRange) return "No dates selected";
    const fromLabel = activeRange.from ? formatDisplayDate(activeRange.from) : "—";
    const toLabel = activeRange.to ? formatDisplayDate(activeRange.to) : fromLabel;
    if (timeframe === "daily") {
      return fromLabel;
    }
    if (timeframe === "monthly") {
      const fromMonth = activeRange.from ? startOfMonth(activeRange.from) : null;
      const toMonth = activeRange.to ? startOfMonth(activeRange.to) : fromMonth;
      return `${formatMonthYear(fromMonth)} - ${formatMonthYear(toMonth)}`;
    }
    if (timeframe === "yearly") {
      return `Year ${singleDate.getFullYear()}`;
    }
    return `${fromLabel} - ${toLabel}`;
  }, [activeRange, timeframe]);

  const monthlyStart = useMemo(() => {
    if (timeframe !== "monthly") return null;
    return dateRange?.from ? startOfMonth(dateRange.from) : startOfMonth(today);
  }, [timeframe, dateRange, today]);

  const monthlyEnd = useMemo(() => {
    if (timeframe !== "monthly") return null;
    return dateRange?.to ? startOfMonth(dateRange.to) : startOfMonth(today);
  }, [timeframe, dateRange, today]);

  const activeStartDate = toISODateLocal(activeRange?.from);
  const activeEndDate = toISODateLocal(activeRange?.to);

  const buildParams = () => {
    const params = new URLSearchParams();
    params.set("timeframe", timeframe);
    if (timeframe === "daily" && activeStartDate) {
      params.set("date", activeStartDate);
    } else if (timeframe === "monthly" && activeStartDate) {
      const start = new Date(activeStartDate);
      params.set("month", String(start.getMonth() + 1));
      params.set("year", String(start.getFullYear()));
    } else if (timeframe === "yearly" && activeStartDate) {
      const year = new Date(activeStartDate).getFullYear();
      params.set("year", String(year));
    } else if (activeStartDate && activeEndDate) {
      params.set("startDate", activeStartDate);
      params.set("endDate", activeEndDate);
    }
    if (activeStartDate && activeEndDate) {
      // Always send explicit boundaries so the backend can honor the chosen window.
      params.set("startDate", activeStartDate);
      params.set("endDate", activeEndDate);
    }
    return params;
  };

  const hasRange = Boolean(activeStartDate && activeEndDate);
  const expenseQueryEnabled = reportType === "expense" && hasRange;
  const jobQueryEnabled = reportType === "job" && hasRange;
  const inventoryQueryEnabled = reportType === "inventory" && hasRange;

  const { data: expenseReport, isFetching: isLoadingExpense } = useQuery({
    queryKey: ["expense-report", timeframe, activeStartDate, activeEndDate],
    enabled: expenseQueryEnabled,
    queryFn: () => apiFetch<ExpenseReport>(`/reports/expenses?${buildParams().toString()}`),
  });

  const { data: jobReport, isFetching: isLoadingJobs } = useQuery({
    queryKey: ["job-report", timeframe, activeStartDate, activeEndDate],
    enabled: jobQueryEnabled,
    queryFn: () => apiFetch<JobReport>(`/reports/jobs?${buildParams().toString()}`),
  });

  const {
    data: inventoryReport,
    isFetching: isLoadingInventory,
    error: inventoryError,
  } = useQuery({
    queryKey: ["inventory-report", timeframe, activeStartDate, activeEndDate],
    enabled: inventoryQueryEnabled,
    queryFn: () => apiFetch<InventoryReport>(`/reports/inventory?${buildParams().toString()}`),
  });

  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async (type: ReportType) => {
    const params = buildParams();
    if (!hasRange && timeframe !== "daily" && timeframe !== "yearly" && timeframe !== "monthly") {
      toast({
        title: "Pick a date range",
        description: "Select a period to generate the report PDF.",
      });
      return;
    }
    if (type === "expense" && !expenseQueryEnabled) {
      toast({
        title: "Pick a date range",
        description: "Select a period to generate the expense report PDF.",
      });
      return;
    }
    try {
      setIsDownloading(true);
      const endpoint =
        type === "expense"
          ? "expenses"
          : type === "job"
            ? "jobs"
            : type === "inventory"
              ? "inventory"
              : null;
      if (!endpoint) {
        toast({ title: "Not available yet", description: "PDF export is not ready for this report." });
        setIsDownloading(false);
        return;
      }
      const response = await fetch(`${API_BASE_URL}/reports/${endpoint}/pdf?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${endpoint}-report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: "Report PDF is being saved." });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not download",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleGenerateClick = () => {
    void handleDownload(reportType);
  };


  const handleMonthSelection = (value: string, kind: "start" | "end") => {
    const option = monthOptions.find((opt) => opt.start.toISOString() === value);
    if (!option) return;

    if (kind === "start") {
      const currentEnd = monthlyEnd ?? option.start;
      const adjustedEnd =
        currentEnd < option.start ? endOfMonth(option.start) : endOfMonth(currentEnd);
      setDateRange({ from: option.start, to: adjustedEnd });
    } else {
      const currentStart = monthlyStart ?? option.start;
      const adjustedStart =
        currentStart > option.start ? option.start : currentStart;
      setDateRange({ from: adjustedStart, to: option.end });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Reports</h1>
          <p className="text-muted-foreground">Generate and view business reports</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90">
          <Download className="mr-2 h-4 w-4" />
          Export Report
        </Button>
      </div>

      <div className="rounded-md border bg-muted/20 px-4 py-3 text-sm text-muted-foreground flex flex-wrap items-center gap-2">
        <CalendarIcon className="h-4 w-4" />
        <span>
          Viewing <span className="font-medium text-foreground">{timeframeLabels[timeframe]}</span> report
          for <span className="font-medium text-foreground">{appliedRangeLabel}</span>
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Report Type</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={reportType} onValueChange={(value) => setReportType(value as ReportType)}>
              <SelectTrigger>
                <SelectValue placeholder="Select report" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="revenue">Revenue Report</SelectItem>
                <SelectItem value="expense">Expense Report</SelectItem>
                <SelectItem value="job">Job Summary</SelectItem>
                <SelectItem value="inventory">Inventory Report</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Time Period</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={timeframe} onValueChange={(value) => setTimeframe(value as TimeframeOption)}>
              <SelectTrigger>
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>

            {timeframe === "daily" ? (
              <div className="space-y-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !singleDate && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {singleDate ? formatDisplayDate(singleDate) : "Choose report date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={singleDate}
                      onSelect={(date) => date && setSingleDate(startOfDay(date))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">
                  Pick a single day to generate the daily report.
                </p>
              </div>
            ) : timeframe === "monthly" ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <Select
                    value={monthlyStart ? monthlyStart.toISOString() : undefined}
                    onValueChange={(value) => handleMonthSelection(value, "start")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select start month" />
                    </SelectTrigger>
                    <SelectContent>
                      {monthOptions.map((option) => (
                        <SelectItem key={option.start.toISOString()} value={option.start.toISOString()}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={monthlyEnd ? monthlyEnd.toISOString() : undefined}
                    onValueChange={(value) => handleMonthSelection(value, "end")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select end month" />
                    </SelectTrigger>
                    <SelectContent>
                      {monthOptions.map((option) => (
                        <SelectItem key={option.start.toISOString()} value={option.start.toISOString()}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Pick the first and last month to include. Each report spans full calendar months.
                </p>
              </div>
            ) : timeframe === "yearly" ? (
              <div className="space-y-2">
                <Select
                  value={String(singleDate.getFullYear())}
                  onValueChange={(value) => {
                    const year = Number(value);
                    if (!Number.isNaN(year)) {
                      setSingleDate(new Date(year, 0, 1));
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select year" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 6 }).map((_, index) => {
                      const year = today.getFullYear() - index;
                      return (
                        <SelectItem key={year} value={String(year)}>
                          {year}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose which year to include in the report.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !activeRange?.from && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {activeRange?.from ? (
                        <span>
                          {formatDisplayDate(activeRange.from)}
                          {activeRange.to ? ` - ${formatDisplayDate(activeRange.to)}` : ""}
                        </span>
                      ) : (
                        "Choose date range"
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0" align="start">
                    <div className="p-4">
                      <Calendar
                        mode="range"
                        numberOfMonths={1}
                        selected={dateRange}
                        onSelect={(range) =>
                          setDateRange(
                            range
                              ? {
                                  from: range.from ? startOfDay(range.from) : undefined,
                                  to: range.to ? startOfDay(range.to) : undefined,
                                }
                              : undefined,
                          )
                        }
                        initialFocus
                      />
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const start = addDays(today, -6);
                            setTimeframe("custom");
                            setDateRange({ from: start, to: today });
                          }}
                        >
                          Last 7 days
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const start = addDays(today, -29);
                            setTimeframe("custom");
                            setDateRange({ from: start, to: today });
                          }}
                        >
                          Last 30 days
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const from = startOfMonth(today);
                            const to = endOfMonth(today);
                            setTimeframe("custom");
                            setDateRange({ from, to });
                          }}
                        >
                          This month
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const from = startOfYear(today);
                            const to = endOfYear(today);
                            setTimeframe("custom");
                            setDateRange({ from, to });
                          }}
                        >
                          This year
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">
                  Select the start and end dates to define the report window.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={handleGenerateClick}
              disabled={reportType === "expense" ? isDownloading : false}
            >
              <FileText className="mr-2 h-4 w-4" />
              {reportType === "expense" ? (isDownloading ? "Downloading..." : "Generate PDF") : "Generate PDF"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {reportType === "expense" ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Expense Summary</CardTitle>
                <CardDescription>
                  {isLoadingExpense ? "Loading..." : `Total for selected period`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-3xl font-bold">
                  {expenseReport ? `LKR ${expenseReport.totals.totalAmount.toLocaleString()}` : "—"}
                </p>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Payment status</p>
                  <div className="flex flex-wrap gap-2">
                    {expenseReport?.statuses.map((row) => (
                      <Badge key={row.status ?? "pending"} variant="outline" className="text-sm">
                        {(row.status || "pending").toUpperCase()} • {row.count} • LKR{" "}
                        {row.total.toLocaleString()}
                      </Badge>
                    )) || <span className="text-sm text-muted-foreground">No data</span>}
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top Categories</CardTitle>
                <CardDescription>Ordered by spend</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoadingExpense && <p className="text-sm text-muted-foreground">Loading...</p>}
                {!isLoadingExpense && !expenseReport?.categories.length && (
                  <p className="text-sm text-muted-foreground">No expenses for this period.</p>
                )}
                {expenseReport?.categories.slice(0, 5).map((cat) => (
                  <div key={cat.category} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{cat.category}</p>
                      <p className="text-xs text-muted-foreground">{cat.count} entr{cat.count === 1 ? "y" : "ies"}</p>
                    </div>
                    <p className="font-semibold">LKR {cat.total.toLocaleString()}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Expenses</CardTitle>
              <CardDescription>Detailed list for the selected range</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingExpense ? (
                <p className="text-sm text-muted-foreground">Loading expenses…</p>
              ) : expenseReport?.expenses.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Description</th>
                        <th className="py-2 pr-3">Category</th>
                        <th className="py-2 pr-3 text-right">Amount (LKR)</th>
                        <th className="py-2 pr-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenseReport.expenses.slice(0, 50).map((expense) => (
                        <tr key={expense.id} className="border-t border-border/60">
                          <td className="py-2 pr-3">
                            {formatDisplayDate(new Date(expense.expense_date))}
                          </td>
                          <td className="py-2 pr-3">{expense.description}</td>
                          <td className="py-2 pr-3">
                            {expense.category || <span className="text-muted-foreground">Uncategorized</span>}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            {expense.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 pr-3">
                            <Badge variant="outline">
                              {(expense.payment_status || "pending").toUpperCase()}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {expenseReport.expenses.length > 50 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Showing first 50 entries. Download PDF for the full list.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No expenses found for this period.</p>
              )}
            </CardContent>
          </Card>
        </>
      ) : reportType === "job" ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Job Summary</CardTitle>
                <CardDescription>
                  {isLoadingJobs ? "Loading..." : "Jobs created in the selected period"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-3xl font-bold">
                  {jobReport ? jobReport.totals.jobCount : "—"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Revenue (invoiced):{" "}
                  {jobReport ? `LKR ${jobReport.totals.completedRevenue.toLocaleString()}` : "—"}
                </p>
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Status Breakdown</CardTitle>
                <CardDescription>Counts by job status</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoadingJobs && <p className="text-sm text-muted-foreground">Loading...</p>}
                {!isLoadingJobs && !jobReport?.statuses.length && (
                  <p className="text-sm text-muted-foreground">No jobs for this period.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {jobReport?.statuses.map((row) => (
                    <Badge key={row.status} variant="outline" className="text-sm">
                      {row.status}: {row.count}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Jobs</CardTitle>
              <CardDescription>Most recent jobs in the selected period</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingJobs ? (
                <p className="text-sm text-muted-foreground">Loading jobs…</p>
              ) : jobReport?.jobs.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Description</th>
                        <th className="py-2 pr-3">Customer</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Invoice</th>
                        <th className="py-2 pr-3 text-right">Amount (LKR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobReport.jobs.slice(0, 50).map((job) => (
                        <tr key={job.id} className="border-top border-border/60">
                          <td className="py-2 pr-3">{formatDisplayDate(new Date(job.created_at))}</td>
                          <td className="py-2 pr-3">{job.description || "—"}</td>
                          <td className="py-2 pr-3">{job.customer_name || "Walk-in"}</td>
                          <td className="py-2 pr-3">
                            <Badge variant="outline">{job.job_status}</Badge>
                          </td>
                          <td className="py-2 pr-3">{job.invoice_no || "—"}</td>
                          <td className="py-2 pr-3 text-right">
                            {job.final_total
                              ? job.final_total.toLocaleString(undefined, { minimumFractionDigits: 2 })
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {jobReport.jobs.length > 50 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Showing first 50 entries. Download PDF for the full list.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No jobs found for this period.</p>
              )}
            </CardContent>
          </Card>
        </>
      ) : reportType === "inventory" ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Inventory Summary</CardTitle>
                <CardDescription>
                  {inventoryError
                    ? "Failed to load inventory report"
                    : isLoadingInventory
                      ? "Loading..."
                      : "Snapshot for the selected period"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-3xl font-bold">
                  {inventoryError
                    ? "—"
                    : inventoryReport?.totals
                      ? inventoryReport.totals.itemCount
                      : isLoadingInventory
                        ? "…"
                        : "0"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {inventoryError
                    ? "Could not load inventory data."
                    : `Low stock: ${
                        inventoryReport?.totals
                          ? inventoryReport.totals.lowStockCount
                          : isLoadingInventory
                            ? "…"
                            : "0"
                      }`}
                </p>
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Top Usage</CardTitle>
                <CardDescription>Most used items in the period</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {inventoryError && (
                  <p className="text-sm text-destructive">Failed to load usage data.</p>
                )}
                {isLoadingInventory && !inventoryError && (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                )}
                {!isLoadingInventory &&
                  !inventoryError &&
                  !(inventoryReport?.mostUsed?.length ?? 0) && (
                  <p className="text-sm text-muted-foreground">No usage recorded.</p>
                )}
                {(inventoryReport?.mostUsed ?? []).slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">Used {item.total_used}</p>
                    </div>
                    <Badge variant="outline">{item.type}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Inventory Details</CardTitle>
              <CardDescription>Quantities and reorder status</CardDescription>
            </CardHeader>
            <CardContent>
                {inventoryError && (
                  <p className="text-sm text-destructive">Failed to load inventory records.</p>
                )}
                {isLoadingInventory && !inventoryError ? (
                  <p className="text-sm text-muted-foreground">Loading inventory…</p>
                ) : (inventoryReport?.items?.length ?? 0) ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="py-2 pr-3">Item</th>
                          <th className="py-2 pr-3">Type</th>
                          <th className="py-2 pr-3 text-right">Qty</th>
                          <th className="py-2 pr-3 text-right">Reorder</th>
                          <th className="py-2 pr-3 text-right">Used</th>
                          <th className="py-2 pr-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(inventoryReport?.items ?? []).slice(0, 80).map((item) => (
                          <tr key={item.id} className="border-top border-border/60">
                            <td className="py-2 pr-3">{item.name}</td>
                            <td className="py-2 pr-3">{item.type}</td>
                            <td className="py-2 pr-3 text-right">{item.quantity}</td>
                            <td className="py-2 pr-3 text-right">{item.reorder_level}</td>
                            <td className="py-2 pr-3 text-right">{item.total_used}</td>
                            <td className="py-2 pr-3">
                              {item.low_stock ? (
                                <Badge variant="destructive">Low</Badge>
                              ) : (
                                <Badge variant="outline">OK</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(inventoryReport?.items?.length ?? 0) > 80 && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Showing first 80 entries. Download PDF for the full list.
                      </p>
                    )}
                  </div>
                ) : (
                  !inventoryError && (
                    <p className="text-sm text-muted-foreground">No inventory records found.</p>
                  )
                )}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Revenue Trend</CardTitle>
                <CardDescription>Monthly revenue over the past 6 months</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="revenue" stroke="hsl(var(--chart-1))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Job Categories</CardTitle>
                <CardDescription>Distribution of job types</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry) => `${entry.name}: ${entry.value}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {categoryData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Key Metrics Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Total Revenue
                  </p>
                  <p className="text-2xl font-bold">LKR 328,000</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Jobs Completed
                  </p>
                  <p className="text-2xl font-bold">847</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Avg. Job Value
                  </p>
                  <p className="text-2xl font-bold">LKR 387</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Customer Retention
                  </p>
                  <p className="text-2xl font-bold">89%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default Reports;
