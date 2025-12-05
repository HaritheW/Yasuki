import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  PAYMENT_METHOD_NONE_VALUE,
  PAYMENT_METHOD_OTHER_VALUE,
  PaymentMethodSelector,
} from "@/components/payment-method-selector";

type Supplier = {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

type SupplierPayload = Partial<{
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}>;

type InventoryItem = {
  id: number;
  name: string;
  type: string;
  quantity: number;
  unit: string | null;
  unit_cost: number | null;
};

type SupplierPurchase = {
  id: number;
  supplier_id: number;
  supplier_name: string | null;
  inventory_item_id: number | null;
  item_name: string;
  quantity: number;
  unit_cost: number | null;
  payment_status: "paid" | "unpaid";
  payment_method: string | null;
  purchase_date: string;
  notes: string | null;
};

type SupplierPurchasePayload = Partial<{
  inventory_item_id: number | null;
  item_name: string;
  quantity: number;
  unit_cost: number | null;
  payment_status: "paid" | "unpaid";
  payment_method: string | null;
  purchase_date: string | null;
  notes: string | null;
  update_inventory_price: boolean;
}>;

const SUPPLIERS_QUERY_KEY = ["suppliers"];
const SUPPLIER_PURCHASES_QUERY_KEY = ["supplierPurchases"];
const INVENTORY_QUERY_KEY = ["inventory"];

const PURCHASE_PAYMENT_METHODS = ["Cash", "Card", "Bank Transfer", "Credit"];
const DEFAULT_PAYMENT_METHOD = PURCHASE_PAYMENT_METHODS[0];

const formatCurrency = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "LKR",
      }).format(value);

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  const adjusted = new Date(parsed.getTime() + 5.5 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(adjusted);
};

const Suppliers = () => {
  const [addOpen, setAddOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseDetailOpen, setPurchaseDetailOpen] = useState(false);
  const [purchaseEditOpen, setPurchaseEditOpen] = useState(false);
  const [purchaseDeleteOpen, setPurchaseDeleteOpen] = useState(false);
  const [purchaseDeleteAdjust, setPurchaseDeleteAdjust] = useState(false);
  const [priceMismatchOpen, setPriceMismatchOpen] = useState(false);
  const [pendingPurchase, setPendingPurchase] = useState<{
    supplierId: number;
    payload: SupplierPurchasePayload;
    inventoryItem: InventoryItem;
    form: HTMLFormElement;
  } | null>(null);
  const [priceUpdateChoice, setPriceUpdateChoice] = useState<"update" | "keep">("update");
  const pendingInventoryCost = pendingPurchase?.inventoryItem.unit_cost ?? null;
  const pendingPurchaseCost = pendingPurchase?.payload.unit_cost ?? null;
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<SupplierPurchase | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [purchaseSearchTerm, setPurchaseSearchTerm] = useState("");
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [purchasePaymentMethod, setPurchasePaymentMethod] = useState<string>(DEFAULT_PAYMENT_METHOD);
  const [purchasePaymentMethodCustom, setPurchasePaymentMethodCustom] = useState("");
  const [purchaseEditMethodChoice, setPurchaseEditMethodChoice] = useState<string>(
    DEFAULT_PAYMENT_METHOD
  );
  const [purchaseEditMethodCustom, setPurchaseEditMethodCustom] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [supplierFormLoading, setSupplierFormLoading] = useState(false);
  const [purchaseFormLoading, setPurchaseFormLoading] = useState(false);

  const resetPurchaseFormState = () => {
    setPurchasePaymentMethod(DEFAULT_PAYMENT_METHOD);
    setPurchasePaymentMethodCustom("");
  };

  useEffect(() => {
    if (!selectedPurchase) {
      setPurchaseEditMethodChoice(DEFAULT_PAYMENT_METHOD);
      setPurchaseEditMethodCustom("");
      return;
    }

    const method = selectedPurchase.payment_method?.trim() ?? "";

    if (!method) {
      setPurchaseEditMethodChoice(PAYMENT_METHOD_NONE_VALUE);
      setPurchaseEditMethodCustom("");
      return;
    }

    if (PURCHASE_PAYMENT_METHODS.includes(method)) {
      setPurchaseEditMethodChoice(method);
      setPurchaseEditMethodCustom("");
      return;
    }

    setPurchaseEditMethodChoice(PAYMENT_METHOD_OTHER_VALUE);
    setPurchaseEditMethodCustom(method);
  }, [selectedPurchase]);

  const clearPriceMismatchState = () => {
    setPriceMismatchOpen(false);
    setPendingPurchase(null);
    setPriceUpdateChoice("update");
  };

  const {
    data: suppliersData,
    isLoading: suppliersLoading,
    isError: suppliersError,
    error: suppliersErrorObject,
  } = useQuery<Supplier[], Error>({
    queryKey: SUPPLIERS_QUERY_KEY,
    queryFn: () => apiFetch<Supplier[]>("/suppliers"),
  });

  const {
    data: purchasesData,
    isLoading: purchasesLoading,
    isError: purchasesError,
    error: purchasesErrorObject,
  } = useQuery<SupplierPurchase[], Error>({
    queryKey: SUPPLIER_PURCHASES_QUERY_KEY,
    queryFn: () => apiFetch<SupplierPurchase[]>("/suppliers/purchases"),
  });

  const {
    data: inventoryItemsData,
    isLoading: inventoryLoading,
    isError: inventoryError,
    error: inventoryErrorObject,
  } = useQuery<InventoryItem[], Error>({
    queryKey: INVENTORY_QUERY_KEY,
    queryFn: () => apiFetch<InventoryItem[]>("/inventory"),
  });

  const suppliers = suppliersData ?? [];
  const purchases = purchasesData ?? [];
  const inventoryItems = inventoryItemsData ?? [];

  const filteredSuppliers = useMemo(() => {
    if (!searchTerm.trim()) return suppliers;
    const query = searchTerm.trim().toLowerCase();
    return suppliers.filter((supplier) =>
      [
        supplier.name,
        supplier.contact_name,
        supplier.email,
        supplier.phone,
        supplier.address,
        supplier.notes,
      ]
        .map((field) => field?.toLowerCase() ?? "")
        .some((field) => field.includes(query))
    );
  }, [suppliers, searchTerm]);

  const filteredPurchases = useMemo(() => {
    const query = purchaseSearchTerm.trim().toLowerCase();
    return purchases.filter((purchase) => {
      const matchesStatus =
        purchaseStatusFilter === "all" || purchase.payment_status === purchaseStatusFilter;
      if (!matchesStatus) return false;
      if (!query) return true;
      return [
        purchase.item_name,
        purchase.payment_method,
        purchase.notes,
        purchase.supplier_name ?? `supplier #${purchase.supplier_id}`,
      ]
        .map((field) => field?.toLowerCase() ?? "")
        .some((field) => field.includes(query));
    });
  }, [purchases, purchaseSearchTerm, purchaseStatusFilter]);

  const createSupplierMutation = useMutation<Supplier, Error, SupplierPayload>({
    mutationFn: (payload) =>
      apiFetch<Supplier>("/suppliers", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onMutate: () => setSupplierFormLoading(true),
    onSuccess: (supplier) => {
      queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
    toast({
        title: "Supplier added",
        description: `${supplier.name} added successfully.`,
      });
      setAddOpen(false);
    },
    onError: (err) => {
      toast({
        title: "Unable to add supplier",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => setSupplierFormLoading(false),
  });

  const updateSupplierMutation = useMutation<Supplier, Error, { id: number; payload: SupplierPayload }>({
    mutationFn: ({ id, payload }) =>
      apiFetch<Supplier>(`/suppliers/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onMutate: () => setSupplierFormLoading(true),
    onSuccess: (supplier) => {
      queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
      toast({
        title: "Supplier updated",
        description: `${supplier.name} updated successfully.`,
      });
      setSelectedSupplier(supplier);
      setEditOpen(false);
    },
    onError: (err) => {
      toast({
        title: "Unable to update supplier",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => setSupplierFormLoading(false),
  });

  const deleteSupplierMutation = useMutation<void, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/suppliers/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
      toast({
        title: "Supplier deleted",
        description: `Supplier #${id} removed successfully.`,
    });
    setDeleteOpen(false);
    setDetailOpen(false);
      setSelectedSupplier(null);
    },
    onError: (err) => {
      toast({
        title: "Unable to delete supplier",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const createPurchaseMutation = useMutation<
    SupplierPurchase,
    Error,
    { supplierId: number; payload: SupplierPurchasePayload }
  >({
    mutationFn: ({ supplierId, payload }) =>
      apiFetch<SupplierPurchase>(`/suppliers/${supplierId}/purchase`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onMutate: () => setPurchaseFormLoading(true),
    onSuccess: (purchase) => {
      queryClient.invalidateQueries({ queryKey: SUPPLIER_PURCHASES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY });
      toast({
        title: "Purchase recorded",
        description: `${purchase.item_name} recorded for ${purchase.supplier_name ?? "supplier"}.`,
      });
      clearPriceMismatchState();
      resetPurchaseFormState();
      setPurchaseOpen(false);
    },
    onError: (err) => {
      toast({
        title: "Unable to record purchase",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => setPurchaseFormLoading(false),
  });

  const updatePurchaseMutation = useMutation<
    SupplierPurchase,
    Error,
    { id: number; payload: SupplierPurchasePayload }
  >({
    mutationFn: ({ id, payload }) =>
      apiFetch<SupplierPurchase>(`/suppliers/purchases/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onMutate: () => setPurchaseFormLoading(true),
    onSuccess: (purchase) => {
      queryClient.invalidateQueries({ queryKey: SUPPLIER_PURCHASES_QUERY_KEY });
      toast({
        title: "Purchase updated",
        description: `${purchase.item_name} updated successfully.`,
      });
      setSelectedPurchase(purchase);
      setPurchaseEditOpen(false);
      setPurchaseDetailOpen(true);
    },
    onError: (err) => {
      toast({
        title: "Unable to update purchase",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => setPurchaseFormLoading(false),
  });

  const deletePurchaseMutation = useMutation<
    void,
    Error,
    { id: number; adjustInventory: boolean }
  >({
    mutationFn: ({ id, adjustInventory }) =>
      apiFetch(`/suppliers/purchases/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ adjustInventory }),
      }),
    onSuccess: (_, { id, adjustInventory }) => {
      queryClient.invalidateQueries({ queryKey: SUPPLIER_PURCHASES_QUERY_KEY });
      if (adjustInventory) {
        queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY });
      }
      toast({
        title: "Purchase deleted",
        description: `Purchase #${id} removed successfully.`,
      });
      setPurchaseDeleteOpen(false);
      setPurchaseDetailOpen(false);
      setSelectedPurchase(null);
      setPurchaseDeleteAdjust(false);
    },
    onError: (err) => {
      toast({
        title: "Unable to delete purchase",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleAddSupplier = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const name = String(formData.get("name") || "").trim();
    const contact_name = String(formData.get("contact_name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const address = String(formData.get("address") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    if (!name) {
      toast({
        title: "Supplier name required",
        description: "Please provide the supplier's name.",
        variant: "destructive",
      });
      return;
    }

    if (!email) {
      toast({
        title: "Email required",
        description: "Please provide an email address.",
        variant: "destructive",
      });
      return;
    }

    createSupplierMutation.mutate(
      {
        name,
        contact_name: contact_name || null,
        email,
        phone: phone || null,
        address: address || null,
        notes: notes || null,
      },
      {
        onSuccess: () => {
          form.reset();
        },
      }
    );
  };

  const handleUpdateSupplier = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSupplier) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    const name = String(formData.get("name") || "").trim();
    const contact_name = String(formData.get("contact_name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const address = String(formData.get("address") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    if (!name) {
    toast({
        title: "Supplier name required",
        description: "Please provide the supplier's name.",
        variant: "destructive",
      });
      return;
    }

    if (!email) {
      toast({
        title: "Email required",
        description: "Please provide an email address.",
        variant: "destructive",
      });
      return;
    }

    updateSupplierMutation.mutate({
      id: selectedSupplier.id,
      payload: {
        name,
        contact_name: contact_name || null,
        email,
        phone: phone || null,
        address: address || null,
        notes: notes || null,
      },
    });
  };

  const handleDeleteSupplier = () => {
    if (!selectedSupplier) return;
    deleteSupplierMutation.mutate(selectedSupplier.id);
  };

  const submitPurchaseRequest = ({
    supplierId,
    payload,
    form,
    updateInventoryPrice,
  }: {
    supplierId: number;
    payload: SupplierPurchasePayload;
    form: HTMLFormElement;
    updateInventoryPrice: boolean;
  }) => {
    createPurchaseMutation.mutate(
      {
        supplierId,
        payload: {
          ...payload,
          update_inventory_price: updateInventoryPrice,
        },
      },
      {
        onSuccess: () => {
          form.reset();
        },
      }
    );
  };

  const handleRecordPurchase = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const supplierId = Number(formData.get("supplier_id") || 0);
    const inventory_item_id = Number(formData.get("inventory_item_id") || 0);
    const quantity = Number(formData.get("quantity") || 0);
    const unit_cost_raw = formData.get("unit_cost");
    const payment_status = (formData.get("payment_status") || "paid") as "paid" | "unpaid";
    const payment_method_value = String(formData.get("payment_method") || "").trim();
    const purchase_date = String(formData.get("purchase_date") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    if (!supplierId) {
      toast({
        title: "Supplier required",
        description: "Select a supplier before recording a purchase.",
        variant: "destructive",
      });
      return;
    }

    if (!inventory_item_id) {
      toast({
        title: "Inventory item required",
        description: "Choose an inventory item for this purchase.",
        variant: "destructive",
      });
      return;
    }

    const inventoryItem = inventoryItems.find((item) => item.id === inventory_item_id);
    if (!inventoryItem) {
      toast({
        title: "Item not found",
        description: "The selected inventory item no longer exists.",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast({
        title: "Invalid quantity",
        description: "Quantity must be greater than zero.",
        variant: "destructive",
      });
      return;
    }

    if (!payment_method_value) {
      toast({
        title: "Payment method required",
        description: "Specify how this purchase was paid.",
        variant: "destructive",
      });
      return;
    }

    const purchaseUnitCost =
      unit_cost_raw === null || unit_cost_raw === "" ? null : Number(unit_cost_raw);

    if (purchaseUnitCost !== null && (!Number.isFinite(purchaseUnitCost) || purchaseUnitCost < 0)) {
      toast({
        title: "Invalid unit cost",
        description: "Unit cost must be zero or greater.",
        variant: "destructive",
      });
      return;
    }

    const basePayload: SupplierPurchasePayload = {
      inventory_item_id,
      item_name: inventoryItem.name,
      quantity,
      unit_cost: purchaseUnitCost,
      payment_status,
      payment_method: payment_method_value || null,
      purchase_date: purchase_date || null,
      notes: notes || null,
    };

    const inventoryUnitCost = inventoryItem.unit_cost;
    const hasPurchaseCost = purchaseUnitCost !== null;
    const inventoryPriceMissing = inventoryUnitCost === null || inventoryUnitCost === undefined;
    const priceDiff =
      hasPurchaseCost &&
      !inventoryPriceMissing &&
      Math.abs(inventoryUnitCost - purchaseUnitCost) > 0.0001;

    if (hasPurchaseCost && (inventoryPriceMissing || priceDiff)) {
      setPendingPurchase({
        supplierId,
        payload: basePayload,
        inventoryItem,
        form,
      });
      setPriceUpdateChoice("update");
      setPriceMismatchOpen(true);
      return;
    }

    submitPurchaseRequest({
      supplierId,
      payload: basePayload,
      form,
      updateInventoryPrice: hasPurchaseCost,
    });
  };

  const handleConfirmPriceMismatch = () => {
    if (!pendingPurchase) return;

    const decision = priceUpdateChoice === "update";
    const pending = pendingPurchase;
    clearPriceMismatchState();

    submitPurchaseRequest({
      supplierId: pending.supplierId,
      payload: pending.payload,
      form: pending.form,
      updateInventoryPrice: decision,
    });
  };

  const handleCancelPriceMismatch = () => {
    clearPriceMismatchState();
  };

  const handleUpdatePurchase = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPurchase) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    const unit_cost_raw = formData.get("unit_cost");
    const payment_status = (formData.get("payment_status") || "paid") as "paid" | "unpaid";
    const payment_method = String(formData.get("payment_method") || "").trim();
    const purchase_date = String(formData.get("purchase_date") || "").trim();
    const notes = String(formData.get("notes") || "").trim();

    let unit_cost: number | null | undefined;
    if (unit_cost_raw !== null && unit_cost_raw !== "") {
      const parsedCost = Number(unit_cost_raw);
      if (!Number.isFinite(parsedCost) || parsedCost < 0) {
        toast({
          title: "Invalid unit cost",
          description: "Unit cost must be zero or greater.",
          variant: "destructive",
        });
        return;
      }
      unit_cost = parsedCost;
    }

    updatePurchaseMutation.mutate({
      id: selectedPurchase.id,
      payload: {
        unit_cost,
        payment_status,
        payment_method: payment_method || null,
        purchase_date: purchase_date || null,
        notes: notes || null,
      },
    });
  };

  const handleConfirmDeletePurchase = () => {
    if (!selectedPurchase) return;
    deletePurchaseMutation.mutate({
      id: selectedPurchase.id,
      adjustInventory: purchaseDeleteAdjust,
    });
  };

  const handleSupplierRowClick = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setDetailOpen(true);
  };

  const handlePurchaseRowClick = (purchase: SupplierPurchase) => {
    setSelectedPurchase(purchase);
    setPurchaseDetailOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Suppliers</h1>
          <p className="text-muted-foreground">Manage supplier relationships and contacts</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog
            open={purchaseOpen}
            onOpenChange={(open) => {
              setPurchaseOpen(open);
              if (!open) {
                resetPurchaseFormState();
                clearPriceMismatchState();
              } else {
                resetPurchaseFormState();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline">Record Purchase</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Record Purchase</DialogTitle>
                <DialogDescription>Record a new purchase from a supplier</DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={handleRecordPurchase}>
                <div className="space-y-2">
                  <Label htmlFor="purchaseSupplier">Supplier</Label>
                  <select
                    id="purchaseSupplier"
                    name="supplier_id"
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    defaultValue=""
                    required
                  >
                    <option value="" disabled>
                      Select supplier
                    </option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="purchaseInventory">Inventory Item</Label>
                    <select
                      id="purchaseInventory"
                      name="inventory_item_id"
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      defaultValue=""
                      required
                      disabled={inventoryLoading || inventoryItems.length === 0 || inventoryError}
                    >
                      <option value="" disabled>
                        {inventoryLoading ? "Loading items..." : "Select inventory item"}
                      </option>
                      {inventoryItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    {inventoryError && (
                      <p className="text-sm text-destructive">
                        {inventoryErrorObject?.message ?? "Unable to load inventory items."}
                      </p>
                    )}
                    {!inventoryLoading && !inventoryError && inventoryItems.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No inventory items available. Add items in inventory first.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="purchaseQuantity">Quantity</Label>
                    <Input
                      id="purchaseQuantity"
                      name="quantity"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                  <Label htmlFor="purchaseCost">Unit Cost (LKR)</Label>
                    <Input
                      id="purchaseCost"
                      name="unit_cost"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                    />
                  </div>
                  <PaymentMethodSelector
                    label="Payment method"
                    value={purchasePaymentMethod}
                    onValueChange={setPurchasePaymentMethod}
                    customValue={purchasePaymentMethodCustom}
                    onCustomValueChange={setPurchasePaymentMethodCustom}
                    options={PURCHASE_PAYMENT_METHODS}
                    placeholder="Enter payment method"
                    idPrefix="purchase-create-method"
                    helperText="Choose how this purchase was paid. Select “Other” to provide a custom method."
                    name="payment_method"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="purchaseDate">Purchase Date</Label>
                    <Input id="purchaseDate" name="purchase_date" type="date" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="purchaseStatus">Payment Status</Label>
                    <select
                      id="purchaseStatus"
                      name="payment_status"
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      defaultValue="paid"
                    >
                      <option value="paid">Paid</option>
                      <option value="unpaid">Unpaid</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purchaseNotes">Notes (Optional)</Label>
                  <Input id="purchaseNotes" name="notes" placeholder="Additional notes" />
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setPurchaseOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="bg-primary"
                    disabled={
                      purchaseFormLoading ||
                      inventoryLoading ||
                      inventoryItems.length === 0 ||
                      Boolean(inventoryError)
                    }
                  >
                    {purchaseFormLoading ? "Saving..." : "Record Purchase"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" />
                Add Supplier
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Supplier</DialogTitle>
                <DialogDescription>Add a new supplier to your contacts</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddSupplier} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="supplierName">Supplier Name</Label>
                    <Input id="supplierName" name="name" placeholder="AutoParts Direct" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactName">Contact Person</Label>
                    <Input id="contactName" name="contact_name" placeholder="John Doe" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supplierPhone">Phone Number</Label>
                    <Input id="supplierPhone" name="phone" placeholder="+1 555 0100" />
                </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="supplierEmail">Email Address</Label>
                    <Input
                      id="supplierEmail"
                      name="email"
                      type="email"
                      placeholder="contact@supplier.com"
                      required
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address">Address</Label>
                    <Input id="address" name="address" placeholder="123 Main St, City" />
                </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="remarks">Notes (Optional)</Label>
                    <Input id="remarks" name="notes" placeholder="Add notes about the supplier..." />
                </div>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-primary" disabled={supplierFormLoading}>
                    {supplierFormLoading ? "Adding..." : "Add Supplier"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search suppliers..."
              className="pl-10"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium">Supplier Name</th>
                  <th className="p-3 text-left text-sm font-medium">Contact Person</th>
                  <th className="p-3 text-left text-sm font-medium">Email</th>
                  <th className="p-3 text-left text-sm font-medium">Phone</th>
                  <th className="p-3 text-left text-sm font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {suppliersLoading && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                      Loading suppliers...
                    </td>
                  </tr>
                )}
                {suppliersError && !suppliersLoading && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-sm text-destructive">
                      {suppliersErrorObject?.message ?? "Failed to load suppliers."}
                    </td>
                  </tr>
                )}
                {!suppliersLoading && !suppliersError && filteredSuppliers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                      No suppliers match the current search.
                    </td>
                  </tr>
                )}
                {!suppliersLoading &&
                  !suppliersError &&
                  filteredSuppliers.map((supplier) => (
                    <tr
                      key={supplier.id}
                      className="border-b cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => handleSupplierRowClick(supplier)}
                  >
                    <td className="p-3 font-medium">{supplier.name}</td>
                      <td className="p-3">{supplier.contact_name ?? "—"}</td>
                      <td className="p-3 text-muted-foreground">{supplier.email ?? "—"}</td>
                      <td className="p-3 text-muted-foreground">{supplier.phone ?? "—"}</td>
                      <td className="p-3 text-sm text-muted-foreground">
                        <span className="block max-w-[240px] truncate" title={supplier.notes ?? "No notes"}>
                          {supplier.notes ?? "No notes"}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle>Supplier Purchases</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                placeholder="Search purchases..."
                value={purchaseSearchTerm}
                onChange={(event) => setPurchaseSearchTerm(event.target.value)}
                className="min-w-[220px]"
              />
              <select
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-[160px]"
                value={purchaseStatusFilter}
                onChange={(event) =>
                  setPurchaseStatusFilter(event.target.value as "all" | "paid" | "unpaid")
                }
              >
                <option value="all">All statuses</option>
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium">Date</th>
                  <th className="p-3 text-left text-sm font-medium">Supplier</th>
                  <th className="p-3 text-left text-sm font-medium">Item</th>
                  <th className="p-3 text-left text-sm font-medium">Quantity</th>
                  <th className="p-3 text-left text-sm font-medium">Unit Cost</th>
                  <th className="p-3 text-left text-sm font-medium">Status</th>
                  <th className="p-3 text-left text-sm font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {purchasesLoading && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      Loading purchases...
                    </td>
                  </tr>
                )}
                {purchasesError && !purchasesLoading && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-destructive">
                      {purchasesErrorObject?.message ?? "Failed to load purchases."}
                    </td>
                  </tr>
                )}
                {!purchasesLoading && !purchasesError && filteredPurchases.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      No purchases match the current filters.
                    </td>
                  </tr>
                )}
                {!purchasesLoading &&
                  !purchasesError &&
                  filteredPurchases.map((purchase) => (
                    <tr
                      key={purchase.id}
                      className="border-b cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => handlePurchaseRowClick(purchase)}
                    >
                      <td className="p-3 text-muted-foreground">{formatDate(purchase.purchase_date)}</td>
                      <td className="p-3 font-medium">{purchase.supplier_name ?? `Supplier #${purchase.supplier_id}`}</td>
                      <td className="p-3">{purchase.item_name}</td>
                      <td className="p-3">{purchase.quantity}</td>
                      <td className="p-3 font-semibold">{formatCurrency(purchase.unit_cost)}</td>
                    <td className="p-3">
                        <Badge
                          className={
                            purchase.payment_status === "paid"
                              ? "bg-success text-success-foreground"
                              : "bg-warning text-warning-foreground"
                          }
                        >
                          {purchase.payment_status === "paid" ? "Paid" : "Unpaid"}
                        </Badge>
                    </td>
                      <td className="p-3 text-sm text-muted-foreground">
                        <span className="block max-w-[240px] truncate" title={purchase.notes ?? "No notes"}>
                          {purchase.notes ?? "No notes"}
                        </span>
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open && !editOpen && !deleteOpen) setSelectedSupplier(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Supplier Details</DialogTitle>
            <DialogDescription>
              Complete information for {selectedSupplier?.name ?? "supplier"}
            </DialogDescription>
          </DialogHeader>
          {selectedSupplier && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Supplier Name</Label>
                  <p className="font-semibold">{selectedSupplier.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Contact Person</Label>
                  <p className="font-semibold">{selectedSupplier.contact_name ?? "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  <p className="font-semibold">{selectedSupplier.email ?? "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Phone</Label>
                  <p className="font-semibold">{selectedSupplier.phone ?? "—"}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Address</Label>
                  <p className="font-semibold">{selectedSupplier.address ?? "—"}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Notes</Label>
                  <p className="font-semibold">{selectedSupplier.notes ?? "No notes"}</p>
                </div>
              </div>

              <div className="flex gap-3 border-t pt-4">
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

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open && !detailOpen && !deleteOpen) setSelectedSupplier(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Supplier</DialogTitle>
            <DialogDescription>
              Update supplier details for {selectedSupplier?.name ?? "supplier"}
            </DialogDescription>
          </DialogHeader>
          {selectedSupplier && (
            <form onSubmit={handleUpdateSupplier} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="editSupplierName">Supplier Name</Label>
                  <Input id="editSupplierName" name="name" defaultValue={selectedSupplier.name} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editContact">Contact Person</Label>
                  <Input
                    id="editContact"
                    name="contact_name"
                    defaultValue={selectedSupplier.contact_name ?? ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editPhone">Phone Number</Label>
                  <Input id="editPhone" name="phone" defaultValue={selectedSupplier.phone ?? ""} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="editEmail">Email Address</Label>
                  <Input
                    id="editEmail"
                    name="email"
                    type="email"
                    defaultValue={selectedSupplier.email ?? ""}
                    required
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="editAddress">Address</Label>
                  <Input id="editAddress" name="address" defaultValue={selectedSupplier.address ?? ""} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="editRemarks">Notes</Label>
                  <Input id="editRemarks" name="notes" defaultValue={selectedSupplier.notes ?? ""} />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-primary" disabled={supplierFormLoading}>
                  {supplierFormLoading ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open && !detailOpen && !editOpen) setSelectedSupplier(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedSupplier?.name ?? "this supplier"}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSupplier}
              disabled={deleteSupplierMutation.isPending}
            >
              {deleteSupplierMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={purchaseDetailOpen}
        onOpenChange={(open) => {
          setPurchaseDetailOpen(open);
          if (!open && !purchaseEditOpen && !purchaseDeleteOpen) setSelectedPurchase(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Purchase Details</DialogTitle>
            <DialogDescription>Complete information for this purchase</DialogDescription>
          </DialogHeader>
          {selectedPurchase && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-muted-foreground">Supplier</Label>
                  <p className="font-semibold">
                    {selectedPurchase.supplier_name ?? `Supplier #${selectedPurchase.supplier_id}`}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Date</Label>
                  <p className="font-semibold">{formatDate(selectedPurchase.purchase_date)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Item Name</Label>
                  <p className="font-semibold">{selectedPurchase.item_name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Quantity</Label>
                  <p className="font-semibold">{selectedPurchase.quantity}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Unit Cost</Label>
                  <p className="font-semibold">{formatCurrency(selectedPurchase.unit_cost)}</p>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Payment Status</Label>
                  <div className="mt-1">
                    <Badge
                      className={
                        selectedPurchase.payment_status === "paid"
                          ? "bg-success text-success-foreground"
                          : "bg-warning text-warning-foreground"
                      }
                    >
                      {selectedPurchase.payment_status === "paid" ? "Paid" : "Unpaid"}
                    </Badge>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Payment Method</Label>
                  <p className="mt-1 font-semibold">{selectedPurchase.payment_method ?? "—"}</p>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Notes</Label>
                  <p className="font-semibold">{selectedPurchase.notes ?? "No notes"}</p>
                </div>
                </div>

              <div className="flex gap-3 border-t pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setPurchaseDetailOpen(false);
                    setPurchaseEditOpen(true);
                  }}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => {
                    setPurchaseDetailOpen(false);
                    setPurchaseDeleteOpen(true);
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

      <Dialog
        open={purchaseEditOpen}
        onOpenChange={(open) => {
          setPurchaseEditOpen(open);
          if (!open && !purchaseDetailOpen && !purchaseDeleteOpen) setSelectedPurchase(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Purchase</DialogTitle>
            <DialogDescription>Update the purchase details</DialogDescription>
          </DialogHeader>
          {selectedPurchase && (
            <form onSubmit={handleUpdatePurchase} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label>Item Name</Label>
                  <Input value={selectedPurchase.item_name} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input value={selectedPurchase.quantity} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editPurchaseCost">Unit Cost (LKR)</Label>
                  <Input
                    id="editPurchaseCost"
                    name="unit_cost"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={selectedPurchase.unit_cost ?? undefined}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editPurchaseStatus">Payment Status</Label>
                  <select
                    id="editPurchaseStatus"
                    name="payment_status"
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    defaultValue={selectedPurchase.payment_status}
                  >
                    <option value="paid">Paid</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                </div>
                <PaymentMethodSelector
                  label="Payment method"
                  value={purchaseEditMethodChoice}
                  onValueChange={setPurchaseEditMethodChoice}
                  customValue={purchaseEditMethodCustom}
                  onCustomValueChange={setPurchaseEditMethodCustom}
                  options={PURCHASE_PAYMENT_METHODS}
                  includeNotSpecified
                  placeholder="Enter payment method"
                  idPrefix="purchase-edit-method"
                  helperText="Select a preset, enter a custom method, or choose “Not specified” to clear it."
                  name="payment_method"
                />
                <div className="space-y-2">
                  <Label htmlFor="editPurchaseDate">Purchase Date</Label>
                  <Input
                    id="editPurchaseDate"
                    name="purchase_date"
                    type="date"
                    defaultValue={selectedPurchase.purchase_date.slice(0, 10)}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="editPurchaseNotes">Notes</Label>
                  <Input
                    id="editPurchaseNotes"
                    name="notes"
                    defaultValue={selectedPurchase.notes ?? ""}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setPurchaseEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-primary" disabled={purchaseFormLoading}>
                  {purchaseFormLoading ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={purchaseDeleteOpen}
        onOpenChange={(open) => {
          setPurchaseDeleteOpen(open);
          if (!open) {
            setPurchaseDeleteAdjust(false);
          }
          if (!open && !purchaseDetailOpen && !purchaseEditOpen) setSelectedPurchase(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Purchase</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this purchase? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-dashed border-muted p-4">
              <input
                type="checkbox"
                id="adjustInventory"
                className="mt-1"
                checked={purchaseDeleteAdjust}
                onChange={(event) => setPurchaseDeleteAdjust(event.target.checked)}
              />
              <label htmlFor="adjustInventory" className="text-sm">
                Deduct {selectedPurchase?.quantity ?? 0} units of {selectedPurchase?.item_name ?? "item"} from
                inventory as part of deletion.
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setPurchaseDeleteOpen(false);
                  setPurchaseDeleteAdjust(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDeletePurchase}
                disabled={deletePurchaseMutation.isPending}
              >
                {deletePurchaseMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={priceMismatchOpen}
        onOpenChange={(open) => {
          if (!open) {
            clearPriceMismatchState();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Update inventory price?</DialogTitle>
            <DialogDescription>
              Decide whether to align the inventory cost with this purchase.
            </DialogDescription>
          </DialogHeader>
          {pendingPurchase && (
            <div className="space-y-4">
              <div className="space-y-2 rounded-md border border-border p-4">
                <div className="text-sm font-medium text-foreground">
                  {pendingPurchase.inventoryItem.name}
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Current inventory price</span>
                    <span className="font-medium text-foreground">
                      {pendingInventoryCost === null
                        ? "Not set"
                        : formatCurrency(pendingInventoryCost)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Purchase price</span>
                    <span className="font-medium text-foreground">
                      {pendingPurchaseCost === null
                        ? "Not provided"
                        : formatCurrency(pendingPurchaseCost)}
                    </span>
                  </div>
                  {pendingInventoryCost !== null && pendingPurchaseCost !== null && (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Difference</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(Math.abs(pendingPurchaseCost - pendingInventoryCost))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium text-foreground">
                  How should we handle the inventory price?
                </Label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="price-update-choice"
                      value="update"
                      checked={priceUpdateChoice === "update"}
                      onChange={() => setPriceUpdateChoice("update")}
                    />
                    Update inventory price to match this purchase
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="price-update-choice"
                      value="keep"
                      checked={priceUpdateChoice === "keep"}
                      onChange={() => setPriceUpdateChoice("keep")}
                    />
                    Keep existing inventory price
                  </label>
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={handleCancelPriceMismatch}
              disabled={purchaseFormLoading}
            >
              Go back
            </Button>
            <Button onClick={handleConfirmPriceMismatch} disabled={purchaseFormLoading}>
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Suppliers;
