import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Edit, Package, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState, useEffect } from "react";

type InventoryType = "consumable" | "non-consumable" | "bulk";

type InventoryItem = {
  id: number;
  name: string;
  description: string | null;
  type: InventoryType;
  unit: string | null;
  quantity: number;
  unit_cost: number | null;
  reorder_level: number | null;
  created_at?: string;
  updated_at?: string;
};

type InventoryPayload = Partial<{
  name: string;
  description: string | null;
  type: InventoryType;
  unit: string | null;
  quantity: number;
  unit_cost: number | null;
  reorder_level: number | null;
}>;

const INVENTORY_QUERY_KEY = ["inventory"];
const typeOptions: Array<{ value: InventoryType; label: string }> = [
  { value: "consumable", label: "Consumable" },
  { value: "non-consumable", label: "Non-Consumable" },
  { value: "bulk", label: "Bulk" },
];

const typeLabels: Record<InventoryType, string> = {
  consumable: "Consumable",
  "non-consumable": "Non-Consumable",
  bulk: "Bulk",
};

const typeBadgeStyles: Record<InventoryType, string> = {
  consumable: "bg-blue-600 text-white",
  "non-consumable": "bg-secondary text-secondary-foreground",
  bulk: "bg-gray-600 text-white",
};

const statusBadgeStyles = {
  "Low Stock": "bg-warning text-warning-foreground",
  "In Stock": "bg-success text-success-foreground",
} as const;

const UNIT_OPTIONS = [
  "Liters",
  "Units",
  "Sets",
  "Pieces",
  "Gallons",
  "Kilograms",
  "Boxes",
  "Packs",
  "Hours",
  "Meters",
] as const;

const OTHER_UNIT_VALUE = "__other__";
const NO_UNIT_VALUE = "__none__";

const formatCurrency = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "LKR",
      }).format(value);

const Inventory = () => {
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "in-stock" | "low-stock">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | InventoryType>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [createType, setCreateType] = useState<InventoryType | "">("");
  const [createUnit, setCreateUnit] = useState<string>(NO_UNIT_VALUE);
  const [createUnitCustom, setCreateUnitCustom] = useState<string>("");
  const [editType, setEditType] = useState<InventoryType | "">("");
  const [editUnitSelect, setEditUnitSelect] = useState<string>(NO_UNIT_VALUE);
  const [editUnitCustom, setEditUnitCustom] = useState<string>("");
  const [addStockItemId, setAddStockItemId] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: inventoryData,
    isLoading,
    isError,
    error,
  } = useQuery<InventoryItem[], Error>({
    queryKey: INVENTORY_QUERY_KEY,
    queryFn: () => apiFetch<InventoryItem[]>("/inventory"),
  });

  const inventory = inventoryData ?? [];

  const handleCreateTypeChange = (value: string) =>
    setCreateType((value || "") as InventoryType | "");

  const handleEditTypeChange = (value: string) =>
    setEditType((value || "") as InventoryType | "");

  const handleCreateUnitChange = (value: string) => {
    setCreateUnit(value);
    if (value !== OTHER_UNIT_VALUE) {
      setCreateUnitCustom("");
    }
  };

  const handleEditUnitChange = (value: string) => {
    setEditUnitSelect(value);
    if (value !== OTHER_UNIT_VALUE) {
      setEditUnitCustom("");
    }
  };

  useEffect(() => {
    if (addItemOpen) {
      setCreateType("");
      setCreateUnit(NO_UNIT_VALUE);
    setCreateUnitCustom("");
    }
  }, [addItemOpen]);

  useEffect(() => {
    if (selectedItem && editOpen) {
      setEditType(selectedItem.type);
    if (selectedItem.unit) {
      if ((UNIT_OPTIONS as readonly string[]).includes(selectedItem.unit)) {
        setEditUnitSelect(selectedItem.unit);
        setEditUnitCustom("");
      } else {
        setEditUnitSelect(OTHER_UNIT_VALUE);
        setEditUnitCustom(selectedItem.unit);
      }
    } else {
      setEditUnitSelect(NO_UNIT_VALUE);
      setEditUnitCustom("");
    }
  } else if (!editOpen) {
    setEditUnitSelect(NO_UNIT_VALUE);
    setEditUnitCustom("");
    }
  }, [selectedItem, editOpen]);

  const getStatusLabel = (item: InventoryItem) => {
    const minLevel = Number(item.reorder_level ?? 0);
    return item.quantity <= minLevel ? "Low Stock" : "In Stock";
  };

  const filteredInventory = useMemo(() => {
    return inventory
      .filter((item) => {
        if (!searchTerm.trim()) return true;
        const query = searchTerm.trim().toLowerCase();
        return (
          item.name.toLowerCase().includes(query) ||
          (item.description ?? "").toLowerCase().includes(query) ||
          (item.unit ?? "").toLowerCase().includes(query)
        );
      })
      .filter((item) => {
        if (typeFilter === "all") return true;
        return item.type === typeFilter;
      })
      .filter((item) => {
        if (statusFilter === "all") return true;
        const status = getStatusLabel(item);
        return statusFilter === "low-stock" ? status === "Low Stock" : status === "In Stock";
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory, searchTerm, typeFilter, statusFilter]);

  const createItemMutation = useMutation<InventoryItem, Error, InventoryPayload>({
    mutationFn: (payload) =>
      apiFetch<InventoryItem>("/inventory", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY });
    toast({
        title: "Item added",
        description: `${item.name} added to inventory.`,
      });
      setAddItemOpen(false);
    },
    onError: (err) => {
      toast({
        title: "Unable to add item",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateItemMutation = useMutation<
    InventoryItem,
    Error,
    { id: number; payload: InventoryPayload; message: string }
  >({
    mutationFn: ({ id, payload }) =>
      apiFetch<InventoryItem>(`/inventory/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (item, variables) => {
      queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY });
      toast({
        title: "Item updated",
        description: variables.message,
      });
      setSelectedItem(item);
      setEditOpen(false);
    setAddStockOpen(false);
    },
    onError: (err) => {
      toast({
        title: "Unable to update item",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deleteItemMutation = useMutation<void, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/inventory/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY });
    toast({
        title: "Item deleted",
        description: `Inventory item #${id} removed.`,
    });
    setDeleteOpen(false);
    setDetailOpen(false);
      setSelectedItem(null);
    },
    onError: (err) => {
      toast({
        title: "Unable to delete item",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateItem = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const name = String(formData.get("name") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const quantityValue = Number(formData.get("quantity") || 0);
    const unitCostValueRaw = String(formData.get("unit_cost") || "");
    const reorderLevelValueRaw = String(formData.get("reorder_level") || "");

    if (!name) {
      toast({
        title: "Item name required",
        description: "Provide a name before saving.",
        variant: "destructive",
      });
      return;
    }

    if (!createType) {
      toast({
        title: "Item type required",
        description: "Select the item type before saving.",
        variant: "destructive",
      });
      return;
    }

    const unitValue =
      createUnit === OTHER_UNIT_VALUE
        ? createUnitCustom.trim()
        : createUnit === NO_UNIT_VALUE
        ? ""
        : createUnit.trim();

    if (createUnit === OTHER_UNIT_VALUE && !unitValue) {
      toast({
        title: "Unit name required",
        description: "Provide the unit name when choosing Other.",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isFinite(quantityValue) || quantityValue < 0) {
      toast({
        title: "Invalid quantity",
        description: "Quantity must be zero or greater.",
        variant: "destructive",
      });
      return;
    }

    const unitCostValue =
      unitCostValueRaw === "" ? null : Number(unitCostValueRaw);
    if (unitCostValue !== null && (!Number.isFinite(unitCostValue) || unitCostValue < 0)) {
      toast({
        title: "Invalid unit cost",
        description: "Unit cost must be zero or greater.",
        variant: "destructive",
      });
      return;
    }

    const reorderLevelValue =
      reorderLevelValueRaw === "" ? null : Number(reorderLevelValueRaw);
    if (reorderLevelValue !== null && (!Number.isFinite(reorderLevelValue) || reorderLevelValue < 0)) {
      toast({
        title: "Invalid minimum quantity",
        description: "Minimum quantity must be zero or greater.",
        variant: "destructive",
      });
      return;
    }

    createItemMutation.mutate(
      {
        name,
        description: description || null,
        type: createType as InventoryType,
        unit: unitValue ? unitValue : null,
        quantity: quantityValue,
        unit_cost: unitCostValue,
        reorder_level: reorderLevelValue,
      },
      {
        onSuccess: () => {
          form.reset();
          setCreateType("");
          setCreateUnit(NO_UNIT_VALUE);
          setCreateUnitCustom("");
        },
      }
    );
  };

  const handleUpdateItem = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedItem) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    const description = String(formData.get("description") || "").trim();
    const quantityValueRaw = String(formData.get("quantity") || "");
    const unitCostValueRaw = String(formData.get("unit_cost") || "");
    const reorderLevelValueRaw = String(formData.get("reorder_level") || "");

    if (!editType) {
      toast({
        title: "Item type required",
        description: "Select the item type before saving.",
        variant: "destructive",
      });
      return;
    }

    const unitValue =
      editUnitSelect === OTHER_UNIT_VALUE
        ? editUnitCustom.trim()
        : editUnitSelect === NO_UNIT_VALUE
        ? ""
        : editUnitSelect.trim();

    if (editUnitSelect === OTHER_UNIT_VALUE && !unitValue) {
      toast({
        title: "Unit name required",
        description: "Provide the unit name when choosing Other.",
        variant: "destructive",
      });
      return;
    }

    const payload: InventoryPayload = {
      description: description || null,
      type: editType as InventoryType,
      unit: unitValue ? unitValue : null,
    };

    if (quantityValueRaw !== "") {
      const quantityValue = Number(quantityValueRaw);
      if (!Number.isFinite(quantityValue) || quantityValue < 0) {
        toast({
          title: "Invalid quantity",
          description: "Quantity must be zero or greater.",
          variant: "destructive",
        });
        return;
      }
      payload.quantity = quantityValue;
    }

    if (unitCostValueRaw !== "") {
      const unitCostValue = Number(unitCostValueRaw);
      if (!Number.isFinite(unitCostValue) || unitCostValue < 0) {
        toast({
          title: "Invalid unit cost",
          description: "Unit cost must be zero or greater.",
          variant: "destructive",
        });
        return;
      }
      payload.unit_cost = unitCostValue;
    }

    if (reorderLevelValueRaw !== "") {
      const reorderLevelValue = Number(reorderLevelValueRaw);
      if (!Number.isFinite(reorderLevelValue) || reorderLevelValue < 0) {
    toast({
          title: "Invalid minimum quantity",
          description: "Minimum quantity must be zero or greater.",
          variant: "destructive",
        });
        return;
      }
      payload.reorder_level = reorderLevelValue;
    }

    updateItemMutation.mutate({
      id: selectedItem.id,
      payload,
      message: `${selectedItem.name} updated successfully.`,
    });
  };

  const handleAddStock = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const itemId = formData.get("item_id");
    const quantityToAdd = Number(formData.get("add_quantity") || 0);

    if (!itemId) {
      toast({
        title: "Select an item",
        description: "Choose an inventory item to adjust.",
        variant: "destructive",
      });
      return;
    }

    if (!Number.isFinite(quantityToAdd) || quantityToAdd <= 0) {
      toast({
        title: "Invalid quantity",
        description: "Quantity to add must be greater than zero.",
        variant: "destructive",
      });
      return;
    }

    const item = inventory.find((entry) => entry.id === Number(itemId));
    if (!item) {
      toast({
        title: "Item not found",
        description: "The selected item no longer exists.",
        variant: "destructive",
      });
      return;
    }

    updateItemMutation.mutate(
      {
        id: item.id,
        payload: {
          quantity: item.quantity + quantityToAdd,
        },
        message: `Stock increased for ${item.name}.`,
      },
      {
        onSuccess: () => {
          form.reset();
          setAddStockItemId("");
        },
      }
    );
  };

  const handleDeleteItem = () => {
    if (!selectedItem) return;
    deleteItemMutation.mutate(selectedItem.id);
  };

  const handleRowClick = (item: InventoryItem) => {
    setSelectedItem(item);
    setDetailOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Inventory</h1>
          <p className="text-muted-foreground">Manage your garage inventory and stock</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={addStockOpen} onOpenChange={setAddStockOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Package className="mr-2 h-4 w-4" />
                Add Stock
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Add Stock to Existing Item</DialogTitle>
                <DialogDescription>
                  Increase the quantity of an existing inventory item.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddStock} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="existingItem">Select Item</Label>
                  <Select
                    name="item_id"
                    value={addStockItemId}
                    onValueChange={setAddStockItemId}
                  >
                    <SelectTrigger id="existingItem">
                      <SelectValue placeholder="Choose an item" />
                    </SelectTrigger>
                    <SelectContent>
                      {inventory.map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name} (Current: {item.quantity} {item.unit ?? ""})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addQuantity">Quantity to Add</Label>
                  <Input
                    id="addQuantity"
                    name="add_quantity"
                    type="number"
                    placeholder="0"
                    min="0"
                    step="1"
                    required
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => setAddStockOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="bg-primary"
                    disabled={updateItemMutation.isPending}
                  >
                    {updateItemMutation.isPending ? "Updating..." : "Add Stock"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Inventory Item</DialogTitle>
              <DialogDescription>Add a new item to your inventory</DialogDescription>
            </DialogHeader>
              <form onSubmit={handleCreateItem} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="itemName">Item Name</Label>
                  <Input id="itemName" name="name" placeholder="Engine Oil 5W-30" required />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                    <Select value={createType} onValueChange={handleCreateTypeChange}>
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                        {typeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select value={createUnit} onValueChange={handleCreateUnitChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_UNIT_VALUE}>No unit</SelectItem>
                      {UNIT_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                      <SelectItem value={OTHER_UNIT_VALUE}>Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {createUnit === OTHER_UNIT_VALUE && (
                    <Input
                      id="unitCustom"
                      placeholder="Enter unit name"
                      value={createUnitCustom}
                      onChange={(event) => setCreateUnitCustom(event.target.value)}
                    />
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity</Label>
                    <Input id="quantity" name="quantity" type="number" placeholder="0" min="0" step="1" required />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="unit_cost">Unit Cost (LKR)</Label>
                    <Input id="unit_cost" name="unit_cost" type="number" step="0.01" min="0" placeholder="0.00" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reorder_level">Minimum Quantity (Optional)</Label>
                  <Input
                    id="reorder_level"
                    name="reorder_level"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="10"
                  />
              </div>

              <div className="space-y-2">
                  <Label htmlFor="description">Notes (Optional)</Label>
                  <Textarea
                    id="description"
                    name="description"
                    placeholder="Add notes about the item..."
                    rows={3}
                  />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setAddItemOpen(false)}>
                  Cancel
                </Button>
                  <Button
                    type="submit"
                    className="bg-primary"
                    disabled={createItemMutation.isPending}
                  >
                    {createItemMutation.isPending ? "Adding..." : "Add Item"}
                </Button>
              </div>
            </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, description, or unit..."
                className="pl-10"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {typeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="in-stock">In Stock</SelectItem>
                <SelectItem value="low-stock">Low Stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium">Item Name</th>
                  <th className="p-3 text-left text-sm font-medium">Type</th>
                  <th className="p-3 text-left text-sm font-medium">Quantity</th>
                  <th className="p-3 text-left text-sm font-medium">Unit Cost</th>
                  <th className="p-3 text-left text-sm font-medium">Status</th>
                  <th className="p-3 text-left text-sm font-medium max-w-[240px]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      Loading inventory...
                    </td>
                  </tr>
                )}
                {isError && !isLoading && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-destructive">
                      {error?.message ?? "Failed to load inventory."}
                    </td>
                  </tr>
                )}
                {!isLoading && !isError && filteredInventory.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                      No inventory items match the current filters.
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  !isError &&
                  filteredInventory.map((item) => {
                    const statusLabel = getStatusLabel(item);
                    return (
                  <tr 
                        key={item.id}
                    className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => handleRowClick(item)}
                  >
                    <td className="p-3 font-medium">{item.name}</td>
                    <td className="p-3">
                          <Badge className={typeBadgeStyles[item.type]}>
                            {typeLabels[item.type]}
                          </Badge>
                    </td>
                    <td className="p-3">
                          <span
                            className={
                              statusLabel === "Low Stock" ? "text-warning font-semibold" : ""
                            }
                          >
                            {item.quantity} {item.unit ?? ""}
                            {statusLabel === "Low Stock" && (
                              <AlertCircle className="ml-1 inline h-4 w-4" />
                            )}
                      </span>
                    </td>
                        <td className="p-3 font-semibold">{formatCurrency(item.unit_cost)}</td>
                    <td className="p-3">
                          <Badge className={statusBadgeStyles[statusLabel]}>
                            {statusLabel}
                          </Badge>
                        </td>
                        <td className="p-3 max-w-[240px] text-sm text-muted-foreground">
                          <span
                            className="block truncate"
                            title={item.description ?? "No notes"}
                          >
                            {item.description ?? "No notes"}
                          </span>
                    </td>
                  </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setSelectedItem(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Inventory Item Details</DialogTitle>
            <DialogDescription>
              Complete information for {selectedItem?.name ?? "inventory item"}
            </DialogDescription>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-muted-foreground">Item Name</Label>
                  <p className="font-semibold">{selectedItem.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Type</Label>
                  <div className="mt-1">
                    <Badge className={typeBadgeStyles[selectedItem.type]}>
                      {typeLabels[selectedItem.type]}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Quantity</Label>
                  <p className="font-semibold">
                    {selectedItem.quantity} {selectedItem.unit ?? ""}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Minimum Quantity</Label>
                  <p className="font-semibold">{selectedItem.reorder_level ?? "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Unit Cost</Label>
                  <p className="font-semibold">{formatCurrency(selectedItem.unit_cost)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge className={statusBadgeStyles[getStatusLabel(selectedItem)]}>
                      {getStatusLabel(selectedItem)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Unit</Label>
                  <p className="font-semibold">{selectedItem.unit ?? "—"}</p>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Notes</Label>
                  <p className="font-semibold">{selectedItem.description ?? "No notes"}</p>
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
          if (!open && !detailOpen) {
            setSelectedItem(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
            <DialogDescription>
              Update item details for {selectedItem?.name ?? "inventory item"}
            </DialogDescription>
          </DialogHeader>
          {selectedItem && (
            <form onSubmit={handleUpdateItem} className="space-y-4">
                <div className="space-y-2">
                <Label>Item Name</Label>
                <Input value={selectedItem.name} disabled className="bg-muted" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={editType} onValueChange={handleEditTypeChange}>
                    <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                      {typeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                      </SelectContent>
                    </Select>
                  </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select value={editUnitSelect} onValueChange={handleEditUnitChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_UNIT_VALUE}>No unit</SelectItem>
                      {UNIT_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                      <SelectItem value={OTHER_UNIT_VALUE}>Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {editUnitSelect === OTHER_UNIT_VALUE && (
                    <Input
                      id="editUnitCustom"
                      placeholder="Enter unit name"
                      value={editUnitCustom}
                      onChange={(event) => setEditUnitCustom(event.target.value)}
                    />
                  )}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="editQuantity">Quantity</Label>
                  <Input
                    id="editQuantity"
                    name="quantity"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={selectedItem.quantity}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editReorderLevel">Minimum Quantity</Label>
                  <Input
                    id="editReorderLevel"
                    name="reorder_level"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={selectedItem.reorder_level ?? ""}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editUnitCost">Unit Cost (LKR)</Label>
                <Input
                  id="editUnitCost"
                  name="unit_cost"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={selectedItem.unit_cost ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editDescription">Notes</Label>
                <Textarea
                  id="editDescription"
                  name="description"
                  defaultValue={selectedItem.description ?? ""}
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-primary"
                  disabled={updateItemMutation.isPending}
                >
                  {updateItemMutation.isPending ? "Saving..." : "Save Changes"}
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
          if (!open && !detailOpen) {
            setSelectedItem(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedItem?.name ?? "this item"}? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteItemMutation.isPending}
              onClick={handleDeleteItem}
            >
              {deleteItemMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Inventory;
