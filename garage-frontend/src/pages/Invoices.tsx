import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, FileText, Mail, Download, Edit } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import {
  DEFAULT_PAYMENT_METHOD_OPTIONS,
  PAYMENT_METHOD_NONE_VALUE,
  PAYMENT_METHOD_OTHER_VALUE,
  PaymentMethodSelector,
  type PaymentMethodOption,
} from "@/components/payment-method-selector";

type InvoiceSummary = {
  id: number;
  invoice_no: string | null;
  job_id: number | null;
  invoice_date: string;
  payment_status: string;
  final_total: number | null;
  items_total: number | null;
  total_charges: number | null;
  total_deductions: number | null;
  notes: string | null;
  customer_name: string | null;
};

type InvoiceItem = {
  id: number;
  invoice_id: number;
  inventory_item_id: number | null;
  item_name: string;
  type: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type InvoiceExtra = {
  id: number;
  label: string;
  type: "charge" | "deduction";
  amount: number;
};

type InvoiceDetail = InvoiceSummary & {
  items: InvoiceItem[];
  charges: InvoiceExtra[];
  reductions: InvoiceExtra[];
  payment_method: string | null;
};

type InventoryOption = {
  id: number;
  name: string;
  type: "consumable" | "non-consumable" | "bulk";
  quantity: number;
  unit_cost: number | null;
};

type PendingInventoryCharge = {
  item: InventoryOption;
  quantity: number;
  rate: number;
  label: string;
  lineTotal: number;
};

type UpdateInvoicePayload = {
  payment_method: string | null;
  payment_status: "unpaid" | "partial" | "paid";
  notes: string | null;
  charges: Array<{ label: string; amount: number }>;
  reductions: Array<{ label: string; amount: number }>;
};

const formatCurrency = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
};

const Invoices = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [emailOpen, setEmailOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedInvoiceLabel, setSelectedInvoiceLabel] = useState("");
  const [selectedInvoiceDetail, setSelectedInvoiceDetail] = useState<InvoiceDetail | null>(null);
  const [invoiceDetailLoading, setInvoiceDetailLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLabel, setPreviewLabel] = useState("");
  const [previewDetail, setPreviewDetail] = useState<InvoiceDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "partial" | "unpaid">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [editPaymentStatus, setEditPaymentStatus] = useState<"unpaid" | "partial" | "paid">("unpaid");
  const [editMethodChoice, setEditMethodChoice] = useState<string>(PAYMENT_METHOD_NONE_VALUE);
  const [editMethodCustom, setEditMethodCustom] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editCharges, setEditCharges] = useState<Array<{ label: string; amount: string }>>([]);
  const [editReductions, setEditReductions] = useState<Array<{ label: string; amount: string }>>([]);
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [addChargeMode, setAddChargeMode] = useState<"manual" | "inventory">("manual");
  const [addChargeLabel, setAddChargeLabel] = useState("");
  const [addChargeAmount, setAddChargeAmount] = useState("");
  const [selectedInventoryOption, setSelectedInventoryOption] = useState<InventoryOption | null>(null);
  const [inventoryPickerOpen, setInventoryPickerOpen] = useState(false);
  const [addChargeQuantity, setAddChargeQuantity] = useState("1");
  const [addChargeRate, setAddChargeRate] = useState("");
  const [pendingInventoryCharge, setPendingInventoryCharge] = useState<PendingInventoryCharge | null>(null);
  const [confirmDeductOpen, setConfirmDeductOpen] = useState(false);
  const [deductInventoryLoading, setDeductInventoryLoading] = useState(false);

  const invoicesQuery = useQuery<InvoiceSummary[], Error>({
    queryKey: ["invoices"],
    queryFn: () => apiFetch<InvoiceSummary[]>("/invoices"),
  });

  const syncEditPaymentMethod = (method: string | null | undefined) => {
    const normalized = method?.trim() ?? "";
    if (!normalized) {
      setEditMethodChoice(PAYMENT_METHOD_NONE_VALUE);
      setEditMethodCustom("");
      return;
    }

    if ((DEFAULT_PAYMENT_METHOD_OPTIONS as readonly string[]).includes(normalized as PaymentMethodOption)) {
      setEditMethodChoice(normalized);
      setEditMethodCustom("");
      return;
    }

    setEditMethodChoice(PAYMENT_METHOD_OTHER_VALUE);
    setEditMethodCustom(normalized);
  };

  const inventoryQuery = useQuery<InventoryOption[], Error>({
    queryKey: ["inventory", "options"],
    queryFn: () => apiFetch<InventoryOption[]>("/inventory"),
  });

  const openInvoiceDetail = (
    invoice: InvoiceSummary,
    options: { fromNavigation?: boolean } = {}
  ) => {
    setSelectedInvoiceLabel(invoice.invoice_no ?? `Invoice #${invoice.id}`);
    setSelectedInvoiceDetail(null);
    setDetailOpen(true);
    setInvoiceDetailLoading(true);

    apiFetch<InvoiceDetail>(`/invoices/${invoice.id}`)
      .then((detail) => {
        setSelectedInvoiceDetail(detail);
      })
      .catch((error) => {
    toast({
          title: "Unable to load invoice",
          description: error.message,
          variant: "destructive",
    });
        if (!options.fromNavigation) {
    setDetailOpen(false);
        }
      })
      .finally(() => {
        setInvoiceDetailLoading(false);
      });
  };

  const openInvoicePreview = (invoice: InvoiceSummary) => {
    setPreviewLabel(invoice.invoice_no ?? `Invoice #${invoice.id}`);
    setPreviewDetail(null);
    setPreviewOpen(true);
    setPreviewLoading(true);

    apiFetch<InvoiceDetail>(`/invoices/${invoice.id}`)
      .then((detail) => {
        setPreviewDetail(detail);
      })
      .catch((error) => {
        toast({
          title: "Unable to load invoice preview",
          description: error.message,
          variant: "destructive",
        });
        setPreviewOpen(false);
      })
      .finally(() => {
        setPreviewLoading(false);
      });
  };

  const invoices = invoicesQuery.data ?? [];
  const highlightInvoiceId = (location.state as { invoiceId?: number } | null)?.invoiceId;

  useEffect(() => {
    if (!highlightInvoiceId || invoicesQuery.isLoading) return;
    const invoice = invoices.find((inv) => inv.id === highlightInvoiceId);
    if (invoice) {
      openInvoiceDetail(invoice, { fromNavigation: true });
      navigate(".", { replace: true, state: {} });
    }
  }, [highlightInvoiceId, invoices, invoicesQuery.isLoading]);

  const handleInvoiceRowClick = (invoice: InvoiceSummary) => {
    openInvoiceDetail(invoice);
  };

  const openEditModal = () => {
    if (!selectedInvoiceDetail) return;
    const currentCharges = selectedInvoiceDetail.charges ?? [];
    const currentReductions = selectedInvoiceDetail.reductions ?? [];
    setEditPaymentStatus(
      (selectedInvoiceDetail.payment_status as "unpaid" | "partial" | "paid") ?? "unpaid"
    );
    syncEditPaymentMethod(selectedInvoiceDetail.payment_method ?? "");
    setEditNotes(selectedInvoiceDetail.notes ?? "");
    setEditCharges(
      currentCharges.map((entry) => ({
        label: entry.label ?? "",
        amount: entry.amount?.toString() ?? "",
      }))
    );
    setEditReductions(
      currentReductions.map((entry) => ({
        label: entry.label ?? "",
        amount: entry.amount?.toString() ?? "",
      }))
    );
    setAddChargeMode("manual");
    setAddChargeLabel("");
    setAddChargeAmount("");
    setSelectedInventoryOption(null);
    setAddChargeQuantity("1");
    setAddChargeRate("");
    setAddChargeOpen(false);
    setEditOpen(true);
  };

  const updateInvoiceMutation = useMutation<
    InvoiceDetail,
    Error,
    { id: number; payload: UpdateInvoicePayload }
  >({
    mutationFn: ({ id, payload }) =>
      apiFetch<InvoiceDetail>(`/invoices/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (invoice) => {
      setSelectedInvoiceDetail(invoice);
      setSelectedInvoiceLabel(invoice.invoice_no ?? `Invoice #${invoice.id}`);
      setEditOpen(false);
      setDetailOpen(true);
      setEditPaymentStatus((invoice.payment_status as "unpaid" | "partial" | "paid") ?? "unpaid");
      syncEditPaymentMethod(invoice.payment_method ?? "");
      setEditNotes(invoice.notes ?? "");
      setEditCharges(
        (invoice.charges ?? []).map((entry) => ({
          label: entry.label ?? "",
          amount: entry.amount?.toString() ?? "",
        }))
      );
      setEditReductions(
        (invoice.reductions ?? []).map((entry) => ({
          label: entry.label ?? "",
          amount: entry.amount?.toString() ?? "",
        }))
      );
    toast({
        title: "Invoice updated",
        description: `Invoice ${invoice.invoice_no ?? `#${invoice.id}`} updated successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (error) => {
      toast({
        title: "Unable to update invoice",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteInvoiceMutation = useMutation<void, Error, { id: number; label: string }>({
    mutationFn: ({ id }) =>
      apiFetch(`/invoices/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, variables) => {
    toast({
        title: "Invoice deleted",
        description: `${variables.label} has been deleted successfully.`,
    });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    setDeleteOpen(false);
    setDetailOpen(false);
      setSelectedInvoiceDetail(null);
      setSelectedInvoiceLabel("");
    },
    onError: (error) => {
    toast({
        title: "Unable to delete invoice",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getStatusMeta = (status: string) => {
    const normalized = status?.toLowerCase();
    switch (normalized) {
      case "paid":
        return { label: "Paid", className: "bg-success text-success-foreground" };
      case "partial":
        return { label: "Partial", className: "bg-warning text-warning-foreground" };
      case "unpaid":
      default:
        return { label: normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Unpaid", className: "bg-destructive text-destructive-foreground" };
    }
  };

  const filteredInvoices = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (statusFilter !== "all" && invoice.payment_status.toLowerCase() !== statusFilter) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        invoice.invoice_no ?? `INV-${invoice.id}`,
        String(invoice.id),
        invoice.customer_name ?? "",
        invoice.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [invoices, statusFilter, searchTerm]);

  const handleEdit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedInvoiceDetail) return;

    const parseEntries = (
      entries: Array<{ label: string; amount: string }>,
      kind: "charge" | "reduction"
    ) => {
      const parsed: Array<{ label: string; amount: number }> = [];
      for (const entry of entries) {
        const label = entry.label.trim();
        const rawAmount = entry.amount.trim();

        if (!label && !rawAmount) {
          continue;
        }

        const amount = Number(rawAmount);
        if (!label || !Number.isFinite(amount) || amount < 0) {
    toast({
            title: "Incomplete entry",
            description: `Each ${kind === "charge" ? "charge" : "reduction"} requires a label and non-negative amount.`,
            variant: "destructive",
          });
          return null;
        }

        parsed.push({ label, amount });
      }
      return parsed;
    };

    const parsedCharges = parseEntries(editCharges, "charge");
    if (!parsedCharges) return;
    const parsedReductions = parseEntries(editReductions, "reduction");
    if (!parsedReductions) return;

    let paymentMethodValue = "";
    if (editMethodChoice === PAYMENT_METHOD_OTHER_VALUE) {
      const customMethod = editMethodCustom.trim();
      if (!customMethod) {
        toast({
          title: "Missing payment method",
          description: "Provide a name for the payment method or select another option.",
          variant: "destructive",
        });
        return;
      }
      paymentMethodValue = customMethod;
    } else if (editMethodChoice === PAYMENT_METHOD_NONE_VALUE) {
      paymentMethodValue = "";
    } else {
      paymentMethodValue = editMethodChoice;
    }

    updateInvoiceMutation.mutate({
      id: selectedInvoiceDetail.id,
      payload: {
        payment_method: paymentMethodValue ? paymentMethodValue : null,
        payment_status: editPaymentStatus,
        notes: editNotes.trim() ? editNotes.trim() : null,
        charges: parsedCharges,
        reductions: parsedReductions,
      },
    });
  };

  const handleSendEmail = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Invoice Sent",
      description: `Invoice ${selectedInvoiceLabel || ""} has been sent successfully.`,
    });
    setEmailOpen(false);
  };

  const handleDelete = () => {
    if (!selectedInvoiceDetail) return;
    deleteInvoiceMutation.mutate({ id: selectedInvoiceDetail.id, label: selectedInvoiceLabel });
  };

  const detailCharges = selectedInvoiceDetail?.charges ?? [];
  const detailReductions = selectedInvoiceDetail?.reductions ?? [];
  const itemsTotal = selectedInvoiceDetail
    ? selectedInvoiceDetail.items_total ??
      selectedInvoiceDetail.items.reduce((sum, item) => sum + item.line_total, 0)
    : 0;
  const chargesTotal =
    selectedInvoiceDetail?.total_charges ??
    detailCharges.reduce((sum, entry) => sum + entry.amount, 0);
  const reductionsTotal =
    selectedInvoiceDetail?.total_deductions ??
    detailReductions.reduce((sum, entry) => sum + entry.amount, 0);
  const finalAmount = selectedInvoiceDetail?.final_total ?? itemsTotal + chargesTotal - reductionsTotal;
  const detailStatusMeta = selectedInvoiceDetail ? getStatusMeta(selectedInvoiceDetail.payment_status) : null;
  const estimateAmount = selectedInvoiceDetail?.initial_amount ?? null;
  const advanceReduction = detailReductions.find(
    (entry) => entry.label?.toLowerCase() === "advance"
  );

  const previewCharges = previewDetail?.charges ?? [];
  const previewReductions = previewDetail?.reductions ?? [];
  const previewItemsTotal = previewDetail
    ? previewDetail.items_total ??
      previewDetail.items.reduce((sum, item) => sum + item.line_total, 0)
    : 0;
  const previewChargesTotal =
    previewDetail?.total_charges ??
    previewCharges.reduce((sum, entry) => sum + entry.amount, 0);
  const previewReductionsTotal =
    previewDetail?.total_deductions ??
    previewReductions.reduce((sum, entry) => sum + entry.amount, 0);
  const previewFinalAmount =
    previewDetail?.final_total ?? previewItemsTotal + previewChargesTotal - previewReductionsTotal;
  const previewStatusMeta = previewDetail ? getStatusMeta(previewDetail.payment_status) : null;
  const previewAdvanceReduction = previewReductions.find(
    (entry) => entry.label?.toLowerCase() === "advance"
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Paid":
        return "bg-success text-success-foreground";
      case "Pending":
        return "bg-warning text-warning-foreground";
      case "Overdue":
        return "bg-destructive text-destructive-foreground";
      default:
        return "bg-secondary text-secondary-foreground";
    }
  };

  const resetAddChargeForm = () => {
    setAddChargeMode("manual");
    setAddChargeLabel("");
    setAddChargeAmount("");
    setSelectedInventoryOption(null);
    setInventoryPickerOpen(false);
    setAddChargeQuantity("1");
    setAddChargeRate("");
    setPendingInventoryCharge(null);
    setConfirmDeductOpen(false);
  };

  const finalizeInventoryChargeAddition = ({
    item,
    label,
    lineTotal,
    quantity,
    deducted,
  }: {
    item: InventoryOption;
    label: string;
    lineTotal: number;
    quantity: number;
    deducted: boolean;
  }) => {
    const unitsLabel = quantity === 1 ? "unit" : "units";

    setEditCharges((prev) => [
      ...prev,
      { label, amount: lineTotal.toString() },
    ]);

    toast({
      title: "Inventory item added",
      description: deducted
        ? `${item.name} added and ${quantity} ${unitsLabel} deducted from inventory.`
        : `${item.name} added as a charge${item.type === "consumable" ? ", inventory left unchanged." : "."}`,
    });

    resetAddChargeForm();
    setAddChargeOpen(false);
  };

  useEffect(() => {
    if (selectedInventoryOption) {
      setAddChargeRate(
        selectedInventoryOption.unit_cost !== null
          ? selectedInventoryOption.unit_cost.toString()
          : ""
      );
    }
  }, [selectedInventoryOption]);

  const handleAddChargeSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (addChargeMode === "manual") {
      const label = addChargeLabel.trim();
      const amountValue = Number(addChargeAmount);

      if (!label || !Number.isFinite(amountValue) || amountValue <= 0) {
        toast({
          title: "Incomplete charge",
          description: "Provide a description and a positive amount.",
          variant: "destructive",
        });
        return;
      }

      setEditCharges((prev) => [...prev, { label, amount: amountValue.toString() }]);
      toast({
        title: "Charge added",
        description: `${label} recorded as a charge.`,
      });
      resetAddChargeForm();
      setAddChargeOpen(false);
      return;
    }

    const inventoryItem = selectedInventoryOption;
    if (!inventoryItem) {
      toast({
        title: "Select an item",
        description: "Choose an inventory item to add as a charge.",
        variant: "destructive",
      });
      return;
    }

    const quantityValue = Number(addChargeQuantity);
    const rateValue = addChargeRate.trim().length
      ? Number(addChargeRate)
      : inventoryItem.unit_cost ?? 0;

    if (!Number.isFinite(quantityValue) || quantityValue <= 0 || !Number.isFinite(rateValue) || rateValue < 0) {
      toast({
        title: "Invalid entry",
        description: "Provide a valid quantity and unit price.",
        variant: "destructive",
      });
      return;
    }

    const lineTotal = quantityValue * rateValue;
    const label = `${inventoryItem.name}${quantityValue > 1 ? ` (${quantityValue}×)` : ""}`;

    if (inventoryItem.type === "consumable") {
      setPendingInventoryCharge({
        item: inventoryItem,
        quantity: quantityValue,
        rate: rateValue,
        label,
        lineTotal,
      });
      setConfirmDeductOpen(true);
      return;
    }

    finalizeInventoryChargeAddition({
      item: inventoryItem,
      label,
      lineTotal,
      quantity: quantityValue,
      deducted: false,
    });
  };

  const handleCancelInventoryDeduction = () => {
    if (deductInventoryLoading) return;
    setConfirmDeductOpen(false);
    setPendingInventoryCharge(null);
  };

  const handleSkipInventoryDeduction = () => {
    if (!pendingInventoryCharge) return;

    const { item, label, lineTotal, quantity } = pendingInventoryCharge;

    finalizeInventoryChargeAddition({
      item,
      label,
      lineTotal,
      quantity,
      deducted: false,
    });
  };

  const handleConfirmInventoryDeduction = async () => {
    if (!pendingInventoryCharge) return;

    setDeductInventoryLoading(true);
    try {
      await apiFetch(`/inventory/${pendingInventoryCharge.item.id}/deduct`, {
        method: "POST",
        body: JSON.stringify({ quantity: pendingInventoryCharge.quantity }),
      });
      queryClient.invalidateQueries({ queryKey: ["inventory", "options"] });

      const { item, label, lineTotal, quantity } = pendingInventoryCharge;
      finalizeInventoryChargeAddition({
        item,
        label,
        lineTotal,
        quantity,
        deducted: true,
      });
    } catch (error) {
      toast({
        title: "Stock deduction failed",
        description: error instanceof Error ? error.message : "Unable to deduct inventory.",
        variant: "destructive",
      });
    } finally {
      setDeductInventoryLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Manage Invoices</h1>
        <p className="text-muted-foreground">View and manage customer invoices</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search invoices..."
                className="pl-10"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium">Invoice</th>
                  <th className="p-3 text-left text-sm font-medium">Customer</th>
                  <th className="p-3 text-left text-sm font-medium">Date</th>
                  <th className="p-3 text-left text-sm font-medium">Amount</th>
                  <th className="p-3 text-left text-sm font-medium">Status</th>
                  <th className="p-3 text-left text-sm font-medium">Notes</th>
                  <th className="p-3 text-left text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoicesQuery.isLoading && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-sm text-muted-foreground">
                      Loading invoices...
                    </td>
                  </tr>
                )}
                {invoicesQuery.isError && !invoicesQuery.isLoading && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-sm text-destructive">
                      {invoicesQuery.error?.message ?? "Unable to load invoices."}
                    </td>
                  </tr>
                )}
                {!invoicesQuery.isLoading && !invoicesQuery.isError && filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      No invoices found.
                    </td>
                  </tr>
                )}
                {!invoicesQuery.isLoading && !invoicesQuery.isError &&
                  filteredInvoices.map((invoice) => {
                    const statusMeta = getStatusMeta(invoice.payment_status);
                    const displayId = invoice.invoice_no ?? `INV-${invoice.id}`;
                    return (
                  <tr 
                    key={invoice.id} 
                    className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => handleInvoiceRowClick(invoice)}
                      >
                        <td className="p-3 font-semibold">{displayId}</td>
                        <td className="p-3">{invoice.customer_name ?? "Walk-in customer"}</td>
                        <td className="p-3 text-muted-foreground">{formatDate(invoice.invoice_date)}</td>
                        <td className="p-3 font-semibold">{formatCurrency(invoice.final_total)}</td>
                    <td className="p-3">
                          <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                    </td>
                        <td className="p-3 text-sm text-muted-foreground max-w-[220px] truncate" title={invoice.notes ?? "—"}>
                          {invoice.notes ?? "—"}
                        </td>
                        <td className="p-3" onClick={(event) => event.stopPropagation()}>
                      <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="View"
                              onClick={() => openInvoicePreview(invoice)}
                            >
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
                          <DialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Send Email"
                                  onClick={() => setSelectedInvoiceLabel(displayId)}
                                >
                              <Mail className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Send Invoice via Email</DialogTitle>
                                  <DialogDescription>Send {displayId} to the customer's email address</DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleSendEmail} className="space-y-4">
                              <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input id="email" type="email" placeholder="customer@example.com" required />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="subject">Subject</Label>
                                    <Input id="subject" defaultValue={`Invoice ${displayId} from Garage`} required />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="message">Message (Optional)</Label>
                                <Input id="message" placeholder="Add a custom message..." />
                              </div>
                              <div className="flex justify-end gap-3">
                                <Button type="button" variant="outline" onClick={() => setEmailOpen(false)}>
                                  Cancel
                                </Button>
                                <Button type="submit" className="bg-primary">
                                  Send Invoice
                                </Button>
                              </div>
                            </form>
                          </DialogContent>
                        </Dialog>
                        <Button variant="ghost" size="icon" title="Download">
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Detail Modal */}
      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedInvoiceDetail(null);
            setInvoiceDetailLoading(false);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice</DialogTitle>
            <DialogDescription>{selectedInvoiceLabel || "Select an invoice to view details"}</DialogDescription>
          </DialogHeader>
          {invoiceDetailLoading && (
            <div className="rounded-md border border-dashed border-muted p-3 text-sm text-muted-foreground">
              Loading invoice details...
            </div>
          )}
          {selectedInvoiceDetail && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-2xl font-bold">
                    {selectedInvoiceDetail.invoice_no ?? `Invoice #${selectedInvoiceDetail.id}`}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Issued on {formatDate(selectedInvoiceDetail.invoice_date)}
                  </p>
                  {selectedInvoiceDetail.job_id && (
                    <p className="text-sm text-muted-foreground">Linked job #{selectedInvoiceDetail.job_id}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {detailStatusMeta && (
                    <Badge className={detailStatusMeta.className}>{detailStatusMeta.label}</Badge>
                  )}
                  <div className="text-right">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Invoice total</Label>
                    <p className="text-xl font-semibold">{formatCurrency(finalAmount)}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Customer</Label>
                  <p className="font-semibold text-sm">
                    {selectedInvoiceDetail.customer_name ?? "Walk-in customer"}
                  </p>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Payment method</Label>
                  <p className="font-semibold text-sm">
                    {selectedInvoiceDetail.payment_method ?? "Not specified"}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Notes</Label>
                  <p className="rounded-md border border-muted bg-muted/30 p-3 text-sm">
                    {selectedInvoiceDetail.notes ?? "No notes recorded."}
                  </p>
                </div>
              </div>

              {(estimateAmount || advanceReduction) && (
                <div className="grid gap-4 md:grid-cols-2">
                  {estimateAmount && (
                    <div className="rounded-md border border-muted/60 bg-muted/20 p-4">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Estimated amount
                      </Label>
                      <p className="mt-1 text-lg font-semibold">{formatCurrency(estimateAmount)}</p>
                      <p className="text-xs text-muted-foreground">
                        Derived from the job estimate before work started.
                      </p>
                    </div>
                  )}
                  {advanceReduction && (
                    <div className="rounded-md border border-muted/60 bg-muted/20 p-4">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Advance received
                      </Label>
                      <p className="mt-1 text-lg font-semibold">{formatCurrency(advanceReduction.amount)}</p>
                      <p className="text-xs text-muted-foreground">Already collected and deducted from the total.</p>
                    </div>
                  )}
                </div>
              )}

              {selectedInvoiceDetail.items.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Line items</h3>
                    <span className="text-sm text-muted-foreground">
                      {selectedInvoiceDetail.items.length} item{selectedInvoiceDetail.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left">
                        <tr>
                          <th className="p-3 font-medium">Item</th>
                          <th className="p-3 font-medium">Type</th>
                          <th className="p-3 font-medium">Qty</th>
                          <th className="p-3 font-medium">Unit price</th>
                          <th className="p-3 font-medium">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedInvoiceDetail.items.map((item) => (
                          <tr key={item.id} className="border-t">
                            <td className="p-3 font-semibold">{item.item_name}</td>
                            <td className="p-3 capitalize text-muted-foreground">{item.type}</td>
                            <td className="p-3">{item.quantity}</td>
                            <td className="p-3">{formatCurrency(item.unit_price)}</td>
                            <td className="p-3 font-semibold">{formatCurrency(item.line_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold">Charges</h3>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left">
                        <tr>
                          <th className="p-3 font-medium">Category</th>
                          <th className="p-3 font-medium text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailCharges.length === 0 && (
                          <tr>
                            <td colSpan={2} className="p-3 text-sm text-muted-foreground">
                              No charges recorded.
                            </td>
                          </tr>
                        )}
                        {detailCharges.map((charge) => (
                          <tr key={`${charge.label}-${charge.id ?? ""}`} className="border-t">
                            <td className="p-3">
                              <span className="font-medium">{charge.label}</span>
                              {charge.label?.toLowerCase() === "initial amount" && (
                                <span className="ml-2 text-xs text-muted-foreground">(Estimate)</span>
                              )}
                            </td>
                            <td className="p-3 text-right font-semibold">
                              {formatCurrency(charge.amount)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t font-semibold">
                          <td className="p-3">Total charges</td>
                          <td className="p-3 text-right">{formatCurrency(chargesTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold">Reductions</h3>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left">
                        <tr>
                          <th className="p-3 font-medium">Category</th>
                          <th className="p-3 font-medium text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailReductions.length === 0 && (
                          <tr>
                            <td colSpan={2} className="p-3 text-sm text-muted-foreground">
                              No reductions recorded.
                            </td>
                          </tr>
                        )}
                        {detailReductions.map((reduction) => (
                          <tr key={`${reduction.label}-${reduction.id ?? ""}`} className="border-t">
                            <td className="p-3">
                              <span className="font-medium">{reduction.label}</span>
                              {reduction.label?.toLowerCase() === "advance" && (
                                <span className="ml-2 text-xs text-muted-foreground">(Advance)</span>
                              )}
                            </td>
                            <td className="p-3 text-right font-semibold">
                              {formatCurrency(reduction.amount)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t font-semibold">
                          <td className="p-3">Total reductions</td>
                          <td className="p-3 text-right">{formatCurrency(reductionsTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="space-y-2 rounded-md border bg-muted/20 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Charges</span>
                  <span className="font-semibold">{formatCurrency(chargesTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Reductions</span>
                  <span className="font-semibold">{formatCurrency(reductionsTotal)}</span>
                </div>
                <div className="flex items-center justify-between border-t pt-3 text-lg font-bold">
                  <span>Final amount</span>
                  <span>{formatCurrency(finalAmount)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t pt-4 md:flex-row">
                <Button
                  variant="outline"
                  className="md:flex-1"
                  onClick={() => {
                    setDetailOpen(false);
                    openEditModal();
                  }}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button variant="destructive" className="md:flex-1" onClick={() => setDeleteOpen(true)}>
                  Delete
                </Button>
              </div>
            </div>
          )}
          {!selectedInvoiceDetail && !invoiceDetailLoading && (
            <p className="text-sm text-muted-foreground">Select an invoice to view its details.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Invoice Modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Invoice</DialogTitle>
            <DialogDescription>
              Update invoice details for {selectedInvoiceDetail?.invoice_no ?? `#${selectedInvoiceDetail?.id}`}
            </DialogDescription>
          </DialogHeader>
          {selectedInvoiceDetail && (
            <form onSubmit={handleEdit} className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
                  <Label htmlFor="editStatus">Payment status</Label>
                  <Select
                    value={editPaymentStatus}
                    onValueChange={(value) => setEditPaymentStatus(value as "unpaid" | "partial" | "paid")}
                  >
                    <SelectTrigger id="editStatus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="partial">Partial</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
                  <PaymentMethodSelector
                    label="Payment method"
                    value={editMethodChoice}
                    onValueChange={setEditMethodChoice}
                    customValue={editMethodCustom}
                    onCustomValueChange={setEditMethodCustom}
                    options={DEFAULT_PAYMENT_METHOD_OPTIONS}
                    includeNotSpecified
                    placeholder="Enter payment method"
                    idPrefix="invoice-edit-method"
                  />
              </div>

                  <div className="space-y-2">
                <Label htmlFor="editNotes">Remarks</Label>
                <Textarea
                  id="editNotes"
                  rows={4}
                  placeholder="Optional notes visible on the invoice"
                  value={editNotes}
                  onChange={(event) => setEditNotes(event.target.value)}
                />
                  </div>

                <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Charges</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      resetAddChargeForm();
                      setAddChargeMode("manual");
                      setAddChargeOpen(true);
                    }}
                  >
                    Add charge
                  </Button>
                  </div>
                {editCharges.length === 0 && (
                  <p className="rounded-md border border-dashed border-muted p-3 text-sm text-muted-foreground">
                    No charges yet. Use “Add charge” to include labour, parts, or other costs.
                  </p>
                )}
                {editCharges.map((entry, index) => (
                  <div
                    key={`charge-${index}`}
                    className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_auto]"
                  >
                    <Input
                      placeholder="Charge category"
                      value={entry.label}
                      onChange={(event) => {
                        const next = [...editCharges];
                        next[index] = { ...next[index], label: event.target.value };
                        setEditCharges(next);
                      }}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={entry.amount}
                      onChange={(event) => {
                        const next = [...editCharges];
                        next[index] = { ...next[index], amount: event.target.value };
                        setEditCharges(next);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-self-end text-muted-foreground"
                      onClick={() =>
                        setEditCharges((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                  </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Reductions</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditReductions((prev) => [...prev, { label: "", amount: "" }])}
                  >
                    Add reduction
                  </Button>
                </div>
                {editReductions.length === 0 && (
                  <p className="rounded-md border border-dashed border-muted p-3 text-sm text-muted-foreground">
                    No reductions yet. Add discounts or advances collected here.
                  </p>
                )}
                {editReductions.map((entry, index) => (
                  <div
                    key={`reduction-${index}`}
                    className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_auto]"
                  >
                    <Input
                      placeholder="Reduction category"
                      value={entry.label}
                      onChange={(event) => {
                        const next = [...editReductions];
                        next[index] = { ...next[index], label: event.target.value };
                        setEditReductions(next);
                      }}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={entry.amount}
                      onChange={(event) => {
                        const next = [...editReductions];
                        next[index] = { ...next[index], amount: event.target.value };
                        setEditReductions(next);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-self-end text-muted-foreground"
                      onClick={() =>
                        setEditReductions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
            </div>
            
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
                <Button type="submit" disabled={updateInvoiceMutation.isPending}>
                  {updateInvoiceMutation.isPending ? "Saving..." : "Save invoice"}
              </Button>
            </div>
          </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete invoice</DialogTitle>
            <DialogDescription>
              This will remove {selectedInvoiceLabel || "this invoice"} permanently. Any consumable items linked to
              the invoice will be returned to inventory automatically.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to continue?
          </p>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteInvoiceMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteInvoiceMutation.isPending}
            >
              {deleteInvoiceMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer Preview Dialog */}
      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) {
            setPreviewDetail(null);
            setPreviewLabel("");
            setPreviewLoading(false);
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice preview</DialogTitle>
            <DialogDescription>
              {previewLabel || "Select an invoice to preview the customer-facing layout."}
            </DialogDescription>
          </DialogHeader>
          {previewLoading && (
            <div className="rounded-md border border-dashed border-muted p-3 text-sm text-muted-foreground">
              Loading preview...
            </div>
          )}
          {previewDetail && (
            <div className="overflow-hidden rounded-lg border bg-background shadow-sm">
              <div className="border-b bg-muted/20 p-6">
                <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Garage invoice</p>
                    <p className="text-2xl font-bold text-foreground">
                      {previewDetail.invoice_no ?? `Invoice #${previewDetail.id}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Issued on {formatDate(previewDetail.invoice_date)}
                      {previewDetail.job_id ? ` • Job #${previewDetail.job_id}` : ""}
                    </p>
                  </div>
                  <div className="space-y-2 text-right">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount due</p>
                      <p className="text-2xl font-semibold text-foreground">{formatCurrency(previewFinalAmount)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 border-b p-6 md:grid-cols-2">
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Bill to</p>
                  <p className="text-base font-semibold text-foreground">
                    {previewDetail.customer_name ?? "Walk-in customer"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Please review the summary below. Contact us if you have any questions about this invoice.
                  </p>
                </div>
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Payment summary</p>
                    <div className="space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Payment method</span>
                      <span className="font-medium text-foreground">
                        {previewDetail.payment_method ?? "Not specified"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <span className="font-medium text-foreground">
                        {previewStatusMeta ? previewStatusMeta.label : "Unpaid"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {previewDetail.items.length > 0 && (
                <div className="border-b p-6">
                  <h3 className="text-base font-semibold text-foreground">Services provided</h3>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Detailed breakdown of labour and parts used during the job.
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="p-3 font-medium">Description</th>
                          <th className="p-3 font-medium text-right">Qty</th>
                          <th className="p-3 font-medium text-right">Unit price</th>
                          <th className="p-3 font-medium text-right">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewDetail.items.map((item) => (
                          <tr key={item.id} className="border-t">
                            <td className="p-3 font-medium text-foreground">{item.item_name}</td>
                            <td className="p-3 text-right text-muted-foreground">{item.quantity}</td>
                            <td className="p-3 text-right text-muted-foreground">{formatCurrency(item.unit_price)}</td>
                            <td className="p-3 text-right font-semibold text-foreground">
                              {formatCurrency(item.line_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {(previewCharges.length > 0 || previewReductions.length > 0) && (
                <div className="grid gap-6 border-b p-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="text-base font-semibold text-foreground">Additional charges</h3>
                    <p className="text-sm text-muted-foreground">
                      Any supplemental labour, diagnostics, or consumables added to the invoice.
                    </p>
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="p-3 font-medium">Description</th>
                            <th className="p-3 font-medium text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewCharges.length === 0 && (
                            <tr>
                              <td colSpan={2} className="p-3 text-sm text-muted-foreground">
                                No additional charges applied.
                              </td>
                            </tr>
                          )}
                          {previewCharges.map((charge) => (
                            <tr key={`${charge.label}-${charge.id ?? ""}`} className="border-t">
                              <td className="p-3 font-medium text-foreground">{charge.label}</td>
                              <td className="p-3 text-right font-semibold text-foreground">
                                {formatCurrency(charge.amount)}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t font-semibold">
                            <td className="p-3 text-foreground">Total charges</td>
                            <td className="p-3 text-right text-foreground">{formatCurrency(previewChargesTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-base font-semibold text-foreground">Reductions & credits</h3>
                    <p className="text-sm text-muted-foreground">
                      Discounts, advances, or other credits that reduce the balance.
                    </p>
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="p-3 font-medium">Description</th>
                            <th className="p-3 font-medium text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewReductions.length === 0 && (
                            <tr>
                              <td colSpan={2} className="p-3 text-sm text-muted-foreground">
                                No reductions recorded.
                              </td>
                            </tr>
                          )}
                          {previewReductions.map((reduction) => (
                            <tr key={`${reduction.label}-${reduction.id ?? ""}`} className="border-t">
                              <td className="p-3 font-medium text-foreground">{reduction.label}</td>
                              <td className="p-3 text-right font-semibold text-foreground">
                                {formatCurrency(reduction.amount)}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t font-semibold">
                            <td className="p-3 text-foreground">Total reductions</td>
                            <td className="p-3 text-right text-foreground">
                              {formatCurrency(previewReductionsTotal)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3 p-6">
                <h3 className="text-base font-semibold text-foreground">Financial summary</h3>
                <div className="space-y-2 rounded-md border border-muted bg-muted/10 p-4 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Charges</span>
                    <span className="font-semibold text-foreground">{formatCurrency(previewChargesTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Reductions & credits</span>
                    <span className="font-semibold text-foreground">
                      -{formatCurrency(previewReductionsTotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3 text-lg font-bold text-foreground">
                    <span>Balance due</span>
                    <span>{formatCurrency(previewFinalAmount)}</span>
                  </div>
                </div>
                {previewAdvanceReduction && (
                  <p className="text-xs text-muted-foreground">
                    Advance received: {formatCurrency(previewAdvanceReduction.amount)} (already reflected above).
                  </p>
                )}
              </div>

              {previewDetail.notes && (
                <div className="border-t p-6">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Additional notes</p>
                  <p className="mt-2 rounded-md border border-muted bg-muted/10 p-3 text-sm text-foreground">
                    {previewDetail.notes}
                  </p>
                </div>
              )}

              <div className="border-t bg-muted/20 p-6 text-xs text-muted-foreground">
                Thank you for choosing our garage. Please settle the balance by the agreed payment terms.{" "}
                <span className="text-foreground">If you have already paid, kindly ignore this reminder.</span>
              </div>
            </div>
          )}
          {!previewDetail && !previewLoading && (
            <p className="text-sm text-muted-foreground">Select an invoice to preview.</p>
          )}
          <div className="flex justify-end pt-4">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Charge / Item Dialog */}
      <Dialog
        open={addChargeOpen}
        onOpenChange={(open) => {
          setAddChargeOpen(open);
          if (!open) {
            resetAddChargeForm();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add charge or item</DialogTitle>
            <DialogDescription>
              Record a manual service charge or pull an item from inventory to include on the invoice.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddChargeSubmit} className="space-y-6">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={addChargeMode === "manual" ? "default" : "outline"}
                onClick={() => {
                  setAddChargeMode("manual");
                  setSelectedInventoryOption(null);
                }}
              >
                Manual entry
              </Button>
              <Button
                type="button"
                variant={addChargeMode === "inventory" ? "default" : "outline"}
                onClick={() => setAddChargeMode("inventory")}
              >
                From inventory
              </Button>
            </div>

            {addChargeMode === "manual" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="manualLabel">Description</Label>
                  <Input
                    id="manualLabel"
                    placeholder="e.g., Labour, Diagnostic fee"
                    value={addChargeLabel}
                    onChange={(event) => setAddChargeLabel(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manualAmount">Amount (LKR)</Label>
                  <Input
                    id="manualAmount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={addChargeAmount}
                    onChange={(event) => setAddChargeAmount(event.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Inventory item</Label>
                  <Popover open={inventoryPickerOpen} onOpenChange={setInventoryPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" className="w-full justify-between">
                        {selectedInventoryOption ? selectedInventoryOption.name : "Select item"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-0">
                      <Command>
                        <CommandInput placeholder="Search inventory..." />
                        <CommandList>
                          <CommandEmpty>No items found.</CommandEmpty>
                          <CommandGroup>
                            {(inventoryQuery.data ?? []).map((item) => (
                              <CommandItem
                                key={item.id}
                                value={`${item.name} ${item.type}`}
                                onSelect={() => {
                                  setSelectedInventoryOption(item);
                                  setInventoryPickerOpen(false);
                                }}
                              >
                                <div className="flex flex-col">
                                  <span className="font-medium">{item.name}</span>
                                  <span className="text-xs text-muted-foreground capitalize">
                                    {item.type} • In stock: {item.quantity}
                                  </span>
                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {inventoryQuery.isError && (
                    <p className="text-xs text-destructive">
                      {inventoryQuery.error?.message ?? "Unable to load inventory."}
                    </p>
                  )}
                </div>

                {selectedInventoryOption && (
                  <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                      <Label htmlFor="inventoryQuantity">Quantity</Label>
                      <Input
                        id="inventoryQuantity"
                        type="number"
                        step="0.01"
                        min="0"
                        value={addChargeQuantity}
                        onChange={(event) => setAddChargeQuantity(event.target.value)}
                      />
                </div>
                    <div className="space-y-2">
                      <Label htmlFor="inventoryRate">Unit price (LKR)</Label>
                      <Input
                        id="inventoryRate"
                        type="number"
                        step="0.01"
                        min="0"
                        value={addChargeRate}
                        onChange={(event) => setAddChargeRate(event.target.value)}
                      />
                </div>
              </div>
                )}
              </div>
            )}

          <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setAddChargeOpen(false)}>
              Cancel
            </Button>
              <Button type="submit">
                {addChargeMode === "manual" ? "Add charge" : "Add inventory item"}
            </Button>
          </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDeductOpen}
        onOpenChange={(open) => {
          if (deductInventoryLoading) return;
          setConfirmDeductOpen(open);
          if (!open) {
            setPendingInventoryCharge(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deduct inventory?</AlertDialogTitle>
            <AlertDialogDescription>
              Decide whether to decrease stock for this consumable now or keep inventory unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingInventoryCharge && (
            <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">{pendingInventoryCharge.item.name}</span>
                <span className="text-xs text-muted-foreground capitalize">
                  {pendingInventoryCharge.item.type}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-background p-2">
                  <p className="text-xs text-muted-foreground">Quantity to add</p>
                  <p className="font-semibold">{pendingInventoryCharge.quantity}</p>
                </div>
                <div className="rounded-md bg-background p-2">
                  <p className="text-xs text-muted-foreground">Current stock</p>
                  <p className="font-semibold">{pendingInventoryCharge.item.quantity}</p>
                </div>
              </div>
              <div className="rounded-md bg-background p-2">
                <p className="text-xs text-muted-foreground">Charge total</p>
                <p className="font-semibold">
                  {formatCurrency(pendingInventoryCharge.lineTotal)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                You can deduct stock now or add the item without altering inventory.
              </p>
            </div>
          )}
          <AlertDialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <AlertDialogCancel
              onClick={handleCancelInventoryDeduction}
              disabled={deductInventoryLoading}
            >
              Back
            </AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={handleSkipInventoryDeduction}
              disabled={deductInventoryLoading || !pendingInventoryCharge}
            >
              Add without deduction
            </Button>
            <Button
              type="button"
              onClick={handleConfirmInventoryDeduction}
              disabled={deductInventoryLoading || !pendingInventoryCharge}
            >
              {deductInventoryLoading ? "Deducting..." : "Deduct & add"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Invoices;
