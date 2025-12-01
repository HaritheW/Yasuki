import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, TrendingUp, Edit, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";

type PaymentStatus = "pending" | "paid" | "unpaid";

type Expense = {
  id: number;
  description: string;
  category: string | null;
  amount: number;
  expense_date: string;
  payment_status: PaymentStatus;
  payment_method: string | null;
  remarks: string | null;
};

type ExpenseFormPayload = {
  description: string;
  category?: string;
  amount: number;
  expense_date?: string;
  payment_status?: PaymentStatus;
  payment_method?: string | null;
  remarks?: string;
};

const EXPENSES_QUERY_KEY = ["expenses"];
const NO_CATEGORY_VALUE = "__none__";
const PAYMENT_METHOD_OPTIONS = ["Cash", "Card", "Bank Transfer", "Online"] as const;
const STATUS_STYLES: Record<PaymentStatus, string> = {
  paid: "bg-success text-success-foreground",
  pending: "bg-warning text-warning-foreground",
  unpaid: "bg-muted text-muted-foreground",
};
const OTHER_METHOD_VALUE = "__other__";

const Expenses = () => {
  const [addOpen, setAddOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [createCategory, setCreateCategory] = useState<string>(NO_CATEGORY_VALUE);
  const [createStatus, setCreateStatus] = useState<PaymentStatus>("pending");
  const [createMethod, setCreateMethod] = useState<string>("");
  const [createMethodCustom, setCreateMethodCustom] = useState<string>("");
  const [editStatus, setEditStatus] = useState<PaymentStatus>("pending");
  const [editMethod, setEditMethod] = useState<string>("");
  const [editMethodCustom, setEditMethodCustom] = useState<string>("");
  const [editCategory, setEditCategory] = useState<string>(NO_CATEGORY_VALUE);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: expensesData,
    isLoading: expensesLoading,
    isError: expensesError,
    error: expensesErrorObject,
  } = useQuery<Expense[], Error>({
    queryKey: EXPENSES_QUERY_KEY,
    queryFn: () => apiFetch<Expense[]>("/expenses"),
  });

  const expenses = expensesData ?? [];

  const totals = useMemo(() => {
    if (!expenses.length) {
      return { dailyTotal: 0, monthlyTotal: 0 };
    }

    const today = new Date().toISOString().slice(0, 10);
    const currentMonth = new Date().toISOString().slice(0, 7);

    let dailyTotal = 0;
    let monthlyTotal = 0;

    for (const expense of expenses) {
      const date = expense.expense_date?.slice(0, 10) ?? "";
      const month = date.slice(0, 7);

      if (date === today) {
        dailyTotal += expense.amount;
      }

      if (month === currentMonth) {
        monthlyTotal += expense.amount;
      }
    }

    return { dailyTotal, monthlyTotal };
  }, [expenses]);

  useEffect(() => {
    if (selectedExpense) {
      setEditCategory(selectedExpense.category ?? NO_CATEGORY_VALUE);
      setEditStatus(selectedExpense.payment_status);
      const method = selectedExpense.payment_method || "";
      if (method) {
        if ((PAYMENT_METHOD_OPTIONS as readonly string[]).includes(method)) {
          setEditMethod(method);
          setEditMethodCustom("");
        } else {
          setEditMethod(OTHER_METHOD_VALUE);
          setEditMethodCustom(method);
        }
      } else {
        setEditMethod("");
        setEditMethodCustom("");
      }
    } else {
      setEditCategory(NO_CATEGORY_VALUE);
      setEditStatus("pending");
      setEditMethod("");
      setEditMethodCustom("");
    }
  }, [selectedExpense]);

  useEffect(() => {
    if (createStatus === "paid") {
      if (!createMethod) {
        setCreateMethod(PAYMENT_METHOD_OPTIONS[0]);
        setCreateMethodCustom("");
      }
    } else {
      setCreateMethod("");
      setCreateMethodCustom("");
    }
  }, [createStatus, createMethod]);

  useEffect(() => {
    if (editStatus === "paid") {
      if (!editMethod && !editMethodCustom) {
        setEditMethod(PAYMENT_METHOD_OPTIONS[0]);
        setEditMethodCustom("");
      }
    } else {
      setEditMethod("");
      setEditMethodCustom("");
    }
  }, [editStatus, editMethod, editMethodCustom]);

  const createExpenseMutation = useMutation<Expense, Error, ExpenseFormPayload>({
    mutationFn: (payload) =>
      apiFetch<Expense>("/expenses", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (expense) => {
      queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      toast({
        title: "Expense added",
        description: `${expense.description} recorded successfully.`,
      });
      setCreateStatus("pending");
      setCreateMethod("");
      setCreateMethodCustom("");
      setCreateCategory(NO_CATEGORY_VALUE);
      setAddOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Unable to add expense",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateExpenseMutation = useMutation<
    Expense,
    Error,
    { id: number; payload: ExpenseFormPayload }
  >({
    mutationFn: ({ id, payload }) =>
      apiFetch<Expense>(`/expenses/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (expense) => {
      queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      toast({
        title: "Expense updated",
        description: `${expense.description} updated successfully.`,
      });
      setSelectedExpense(expense);
      setEditCategory(expense.category ?? NO_CATEGORY_VALUE);
      setEditStatus(expense.payment_status);
      const method = expense.payment_method || "";
      if (method) {
        if ((PAYMENT_METHOD_OPTIONS as readonly string[]).includes(method)) {
          setEditMethod(method);
          setEditMethodCustom("");
        } else {
          setEditMethod(OTHER_METHOD_VALUE);
          setEditMethodCustom(method);
        }
      } else {
        setEditMethod("");
        setEditMethodCustom("");
      }
      setEditOpen(false);
      setDetailOpen(true);
    },
    onError: (error) => {
      toast({
        title: "Unable to update expense",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteExpenseMutation = useMutation<void, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/expenses/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      toast({
        title: "Expense deleted",
        description: `Expense #${id} has been removed.`,
      });
      setDeleteOpen(false);
      setDetailOpen(false);
      setSelectedExpense(null);
    },
    onError: (error) => {
      toast({
        title: "Unable to delete expense",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateExpense = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const description = String(formData.get("description") || "").trim();
    const amount = Number(formData.get("amount") || 0);
    const expense_date = String(formData.get("expense_date") || "").trim();
    const remarks = String(formData.get("remarks") || "").trim();
    const categoryValue =
      createCategory === NO_CATEGORY_VALUE ? "" : createCategory.trim();

    if (!description) {
      toast({
        title: "Description required",
        description: "Please enter a description for the expense.",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      toast({
        title: "Invalid amount",
        description: "Enter a valid amount greater than zero.",
        variant: "destructive",
      });
      return;
    }

    const methodValue =
      createStatus === "paid"
        ? (createMethod === OTHER_METHOD_VALUE
            ? createMethodCustom.trim()
            : createMethod.trim())
        : "";

    if (createStatus === "paid" && !methodValue) {
      toast({
        title: "Payment method required",
        description: "Choose how the expense was paid.",
        variant: "destructive",
      });
      return;
    }

    const payload: ExpenseFormPayload = {
      description,
      amount,
      category: categoryValue || undefined,
      expense_date: expense_date || undefined,
      payment_status: createStatus,
      payment_method: createStatus === "paid" ? methodValue : null,
      remarks: remarks || undefined,
    };

    createExpenseMutation.mutate(payload, {
      onSuccess: () => {
        form.reset();
        setCreateStatus("pending");
        setCreateMethod("");
        setCreateMethodCustom("");
        setCreateCategory(NO_CATEGORY_VALUE);
      },
    });
  };

  const handleUpdateExpense = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedExpense) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    const description = String(formData.get("description") || "").trim();
    const amount = Number(formData.get("amount") || 0);
    const expense_date = String(formData.get("expense_date") || "").trim();
    const remarks = String(formData.get("remarks") || "").trim();
    const categoryValue =
      editCategory === NO_CATEGORY_VALUE ? "" : editCategory.trim();

    if (!description) {
      toast({
        title: "Description required",
        description: "Please enter a description for the expense.",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      toast({
        title: "Invalid amount",
        description: "Enter a valid amount greater than zero.",
        variant: "destructive",
      });
      return;
    }

    const methodValue =
      editStatus === "paid"
        ? (editMethod === OTHER_METHOD_VALUE
            ? editMethodCustom.trim()
            : editMethod.trim())
        : "";

    if (editStatus === "paid" && !methodValue) {
      toast({
        title: "Payment method required",
        description: "Choose how the expense was paid.",
        variant: "destructive",
      });
      return;
    }

    const payload: ExpenseFormPayload = {
      description,
      amount,
      category: categoryValue || undefined,
      expense_date: expense_date || undefined,
      payment_status: editStatus,
      payment_method: editStatus === "paid" ? methodValue : null,
      remarks: remarks || undefined,
    };

    updateExpenseMutation.mutate(
      { id: selectedExpense.id, payload },
      {
        onSuccess: () => {
          form.reset();
        },
      }
    );
  };

  const currency = (value: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);

  const formatDate = (value: string) => {
    if (!value) return "—";
    return new Date(value).toLocaleDateString();
  };

  const statusLabel = (status: PaymentStatus) =>
    status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Expenses</h1>
          <p className="text-muted-foreground">Track and manage business expenses</p>
        </div>
        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            setAddOpen(open);
            if (!open) {
              setCreateStatus("pending");
              setCreateMethod("");
              setCreateMethodCustom("");
              setCreateCategory(NO_CATEGORY_VALUE);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90">
              <Plus className="mr-2 h-4 w-4" />
              Add Expense
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Expense</DialogTitle>
              <DialogDescription>Record a new business expense</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateExpense} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="expenseDate">Date</Label>
                <Input id="expenseDate" name="expense_date" type="date" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select value={createCategory} onValueChange={setCreateCategory}>
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY_VALUE}>No category</SelectItem>
                    <SelectItem value="Utilities">Utilities</SelectItem>
                    <SelectItem value="Supplies">Supplies</SelectItem>
                    <SelectItem value="Maintenance">Maintenance</SelectItem>
                    <SelectItem value="Rent">Rent</SelectItem>
                    <SelectItem value="Salaries">Salaries</SelectItem>
                    <SelectItem value="Insurance">Insurance</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Describe the expense..."
                  rows={3}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Amount ($)</Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Payment Status</Label>
                <RadioGroup
                  value={createStatus}
                  onValueChange={(value) => setCreateStatus(value as PaymentStatus)}
                  className="flex flex-wrap gap-4"
                >
                  {(["pending", "paid", "unpaid"] as PaymentStatus[]).map((status) => (
                    <div key={status} className="flex items-center space-x-2">
                      <RadioGroupItem value={status} id={`create-status-${status}`} />
                      <Label htmlFor={`create-status-${status}`}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {createStatus === "paid" && (
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <RadioGroup
                    value={createMethod}
                    onValueChange={(value) => {
                      setCreateMethod(value);
                      if (value !== OTHER_METHOD_VALUE) {
                        setCreateMethodCustom("");
                      }
                    }}
                    className="flex flex-wrap gap-4"
                  >
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <div key={option} className="flex items-center space-x-2">
                        <RadioGroupItem value={option} id={`create-method-${option}`} />
                        <Label htmlFor={`create-method-${option}`}>{option}</Label>
                      </div>
                    ))}
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value={OTHER_METHOD_VALUE} id="create-method-other" />
                      <Label htmlFor="create-method-other">Other</Label>
                    </div>
                  </RadioGroup>
                  {createMethod === OTHER_METHOD_VALUE && (
                    <Input
                      id="createMethodCustom"
                      placeholder="Enter payment method"
                      value={createMethodCustom}
                      onChange={(event) => setCreateMethodCustom(event.target.value)}
                    />
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="remarks">Remarks</Label>
                <Textarea
                  id="remarks"
                  name="remarks"
                  placeholder="Optional notes..."
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-primary"
                  disabled={createExpenseMutation.isPending}
                >
                  {createExpenseMutation.isPending ? "Adding..." : "Add Expense"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Daily Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{currency(totals.dailyTotal)}</div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
              <TrendingUp className="h-3 w-3" />
              Today's total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Monthly Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{currency(totals.monthlyTotal)}</div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
              <TrendingUp className="h-3 w-3" />
              This month's total
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {expensesLoading && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Loading expenses...
            </div>
          )}

          {expensesError && !expensesLoading && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-6 text-center text-sm text-destructive">
              {expensesErrorObject?.message ?? "Failed to load expenses."}
            </div>
          )}

          {!expensesLoading && !expensesError && expenses.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No expenses recorded yet.
            </div>
          )}

          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium">Date</th>
                  <th className="p-3 text-left text-sm font-medium">Category</th>
                  <th className="p-3 text-left text-sm font-medium">Description</th>
                  <th className="p-3 w-48 text-left text-sm font-medium">Remarks</th>
                  <th className="p-3 pr-8 text-right text-sm font-medium">Amount</th>
                  <th className="p-3 pl-4 text-left text-sm font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {!expensesLoading &&
                  !expensesError &&
                  expenses.map((expense) => (
                  <tr 
                    key={expense.id} 
                    className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedExpense(expense);
                      setDetailOpen(true);
                    }}
                  >
                    <td className="p-3 text-muted-foreground whitespace-nowrap">
                      {formatDate(expense.expense_date)}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {expense.category ? <Badge variant="outline">{expense.category}</Badge> : "—"}
                    </td>
                    <td className="p-3">
                      <span
                        className="block max-w-[320px] truncate text-sm"
                        title={expense.description}
                      >
                        {expense.description}
                      </span>
                    </td>
                    <td className="p-3 w-48">
                      <span
                        className="block truncate text-sm text-muted-foreground"
                        title={expense.remarks || "N/A"}
                      >
                        {expense.remarks || "N/A"}
                      </span>
                    </td>
                    <td className="p-3 pr-8 font-semibold text-right whitespace-nowrap">
                      {currency(expense.amount)}
                    </td>
                    <td className="p-3 pl-4">
                      <Badge className={STATUS_STYLES[expense.payment_status]}>
                        {statusLabel(expense.payment_status)}
                      </Badge>
                    </td>
                  </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Expense Detail Modal */}
      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open && !editOpen && !deleteOpen) {
            setSelectedExpense(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Expense Details</DialogTitle>
            <DialogDescription>Complete information for expense</DialogDescription>
          </DialogHeader>
          {selectedExpense && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Date</Label>
                  <p className="font-semibold">{formatDate(selectedExpense.expense_date)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Category</Label>
                  <p className="font-semibold">{selectedExpense.category || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Amount</Label>
                  <p className="font-semibold text-lg">{currency(selectedExpense.amount)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Payment Status</Label>
                  <div className="mt-1">
                    <Badge className={STATUS_STYLES[selectedExpense.payment_status]}>
                      {statusLabel(selectedExpense.payment_status)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Payment Method</Label>
                  <p className="font-semibold">{selectedExpense.payment_method || "—"}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Description</Label>
                  <p className="font-semibold">{selectedExpense.description}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Remarks</Label>
                  <p className="font-semibold">{selectedExpense.remarks || "—"}</p>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => {
                    setDetailOpen(false);
                    setEditOpen(true);
                  }}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button 
                  variant="destructive" 
                  className="flex-1"
                  onClick={() => {
                    setDetailOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Expense Modal */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open && !detailOpen && !deleteOpen) {
            setSelectedExpense(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Expense</DialogTitle>
            <DialogDescription>Update expense details</DialogDescription>
          </DialogHeader>
          {selectedExpense && (
            <form onSubmit={handleUpdateExpense} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="editDate">Date</Label>
                <Input
                  id="editDate"
                  name="expense_date"
                  type="date"
                  defaultValue={selectedExpense.expense_date?.slice(0, 10)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editCategory">Category</Label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger id="editCategory">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY_VALUE}>No category</SelectItem>
                    <SelectItem value="Utilities">Utilities</SelectItem>
                    <SelectItem value="Supplies">Supplies</SelectItem>
                    <SelectItem value="Maintenance">Maintenance</SelectItem>
                    <SelectItem value="Rent">Rent</SelectItem>
                    <SelectItem value="Salaries">Salaries</SelectItem>
                    <SelectItem value="Insurance">Insurance</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editDescription">Description</Label>
                <Textarea
                  id="editDescription"
                  name="description"
                  defaultValue={selectedExpense.description}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editAmount">Amount</Label>
                <Input
                  id="editAmount"
                  name="amount"
                  type="number"
                  step="0.01"
                  defaultValue={selectedExpense.amount}
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Status</Label>
                <RadioGroup
                  value={editStatus}
                  onValueChange={(value) => setEditStatus(value as PaymentStatus)}
                  className="flex flex-wrap gap-4"
                >
                  {(["pending", "paid", "unpaid"] as PaymentStatus[]).map((status) => (
                    <div key={status} className="flex items-center space-x-2">
                      <RadioGroupItem value={status} id={`edit-status-${status}`} />
                      <Label htmlFor={`edit-status-${status}`}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              {editStatus === "paid" && (
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <RadioGroup
                    value={editMethod}
                    onValueChange={(value) => {
                      setEditMethod(value);
                      if (value !== OTHER_METHOD_VALUE) {
                        setEditMethodCustom("");
                      }
                    }}
                    className="flex flex-wrap gap-4"
                  >
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <div key={option} className="flex items-center space-x-2">
                        <RadioGroupItem value={option} id={`edit-method-${option}`} />
                        <Label htmlFor={`edit-method-${option}`}>{option}</Label>
                      </div>
                    ))}
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value={OTHER_METHOD_VALUE} id="edit-method-other" />
                      <Label htmlFor="edit-method-other">Other</Label>
                    </div>
                  </RadioGroup>
                  {editMethod === OTHER_METHOD_VALUE && (
                    <Input
                      id="editMethodCustom"
                      placeholder="Enter payment method"
                      value={editMethodCustom}
                      onChange={(event) => setEditMethodCustom(event.target.value)}
                    />
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="editRemarks">Remarks</Label>
                <Textarea
                  id="editRemarks"
                  name="remarks"
                  defaultValue={selectedExpense.remarks ?? ""}
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-primary"
                  disabled={updateExpenseMutation.isPending}
                >
                  {updateExpenseMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open && !detailOpen && !editOpen) {
            setSelectedExpense(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this expense? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteExpenseMutation.isPending}
              onClick={() => {
                if (!selectedExpense) return;
                deleteExpenseMutation.mutate(selectedExpense.id);
              }}
            >
              {deleteExpenseMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Expenses;
