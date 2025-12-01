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
import { useMemo, useState } from "react";

type Supplier = {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status?: string | null;
};

type SupplierPayload = Partial<{
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}>;

const SUPPLIERS_QUERY_KEY = ["suppliers"];

type SupplierTransaction = {
  date: string;
  supplier: string;
  item: string;
  quantity: number;
  cost: string;
  method: string;
  status: "Paid" | "Pending";
};

const mockTransactions: SupplierTransaction[] = [
  {
    date: "2024-01-15",
    supplier: "AutoParts Direct",
    item: "Brake Pads",
    quantity: 20,
    cost: "$900",
    method: "Bank Transfer",
    status: "Paid",
  },
  {
    date: "2024-01-14",
    supplier: "Premium Oil Co",
    item: "Engine Oil 5W-30",
    quantity: 50,
    cost: "$425",
    method: "Credit",
    status: "Pending",
  },
  {
    date: "2024-01-13",
    supplier: "Quality Motors Supply",
    item: "Air Filter",
    quantity: 15,
    cost: "$225",
    method: "Cash",
    status: "Paid",
  },
  {
    date: "2024-01-12",
    supplier: "AutoParts Direct",
    item: "Spark Plugs",
    quantity: 30,
    cost: "$750",
    method: "Bank Transfer",
    status: "Paid",
  },
];

const Suppliers = () => {
  const [addOpen, setAddOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [transactionDetailOpen, setTransactionDetailOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<SupplierTransaction | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formLoading, setFormLoading] = useState(false);

  const {
    data: suppliersData,
    isLoading,
    isError,
    error,
  } = useQuery<Supplier[], Error>({
    queryKey: SUPPLIERS_QUERY_KEY,
    queryFn: () => apiFetch<Supplier[]>("/suppliers"),
  });

  const suppliers = suppliersData ?? [];

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

  const createSupplierMutation = useMutation<Supplier, Error, SupplierPayload>({
    mutationFn: (payload) =>
      apiFetch<Supplier>("/suppliers", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onMutate: () => setFormLoading(true),
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
    onSettled: () => setFormLoading(false),
  });

  const updateSupplierMutation = useMutation<Supplier, Error, { id: number; payload: SupplierPayload }>(
    {
      mutationFn: ({ id, payload }) =>
        apiFetch<Supplier>(`/suppliers/${id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        }),
      onMutate: () => setFormLoading(true),
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
      onSettled: () => setFormLoading(false),
    }
  );

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

  const handleRowClick = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setDetailOpen(true);
  };

  const handleTransactionClick = (transaction: SupplierTransaction) => {
    setSelectedTransaction(transaction);
    setTransactionDetailOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Suppliers</h1>
          <p className="text-muted-foreground">Manage supplier relationships and contacts</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Record Purchase</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Record Purchase</DialogTitle>
                <DialogDescription>Record a new purchase from a supplier</DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
                <div className="space-y-2">
                  <Label htmlFor="purchaseSupplier">Supplier</Label>
                  <select
                    id="purchaseSupplier"
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
                    <Label htmlFor="purchaseItem">Inventory Item</Label>
                    <Input id="purchaseItem" placeholder="e.g., Brake Pads" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="purchaseQuantity">Quantity</Label>
                    <Input
                      id="purchaseQuantity"
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
                    <Label htmlFor="purchaseCost">Total Cost ($)</Label>
                    <Input
                      id="purchaseCost"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="purchaseMethod">Payment Method</Label>
                    <select
                      id="purchaseMethod"
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      defaultValue=""
                      required
                    >
                      <option value="" disabled>
                        Select method
                      </option>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank">Bank Transfer</option>
                      <option value="credit">Credit</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="purchaseStatus">Payment Status</Label>
                  <select
                    id="purchaseStatus"
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    defaultValue="paid"
                  >
                    <option value="paid">Paid</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setPurchaseOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-primary">
                    Record Purchase
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
                  <Input
                    id="supplierName"
                    name="name"
                    placeholder="AutoParts Direct"
                    required
                  />
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
                <Button type="submit" className="bg-primary" disabled={formLoading}>
                  {formLoading ? "Adding..." : "Add Supplier"}
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
                {isLoading && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                      Loading suppliers...
                    </td>
                  </tr>
                )}
                {isError && !isLoading && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-sm text-destructive">
                      {error?.message ?? "Failed to load suppliers."}
                    </td>
                  </tr>
                )}
                {!isLoading && !isError && filteredSuppliers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                      No suppliers match the current search.
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  !isError &&
                  filteredSuppliers.map((supplier) => (
                    <tr
                      key={supplier.id}
                      className="border-b cursor-pointer transition-colors hover:bg-muted/50"
                      onClick={() => handleRowClick(supplier)}
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
                  <Input
                    id="editSupplierName"
                    name="name"
                    defaultValue={selectedSupplier.name}
                    required
                  />
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
                  <Input
                    id="editPhone"
                    name="phone"
                    defaultValue={selectedSupplier.phone ?? ""}
                  />
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
                  <Input
                    id="editAddress"
                    name="address"
                    defaultValue={selectedSupplier.address ?? ""}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="editRemarks">Notes</Label>
                  <Input
                    id="editRemarks"
                    name="notes"
                    defaultValue={selectedSupplier.notes ?? ""}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-primary" disabled={formLoading}>
                  {formLoading ? "Saving..." : "Save Changes"}
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

      <Card>
        <CardHeader>
          <CardTitle>Past Transactions</CardTitle>
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
                  <th className="p-3 text-left text-sm font-medium">Cost</th>
                  <th className="p-3 text-left text-sm font-medium">Payment Method</th>
                  <th className="p-3 text-left text-sm font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {mockTransactions.map((transaction, index) => (
                  <tr
                    key={`${transaction.supplier}-${transaction.date}-${index}`}
                    className="border-b cursor-pointer transition-colors hover:bg-muted/50"
                    onClick={() => handleTransactionClick(transaction)}
                  >
                    <td className="p-3 text-muted-foreground">{transaction.date}</td>
                    <td className="p-3 font-medium">{transaction.supplier}</td>
                    <td className="p-3">{transaction.item}</td>
                    <td className="p-3">{transaction.quantity}</td>
                    <td className="p-3 font-semibold">{transaction.cost}</td>
                    <td className="p-3">
                      <Badge variant="outline">{transaction.method}</Badge>
                    </td>
                    <td className="p-3">
                      <Badge
                        className={
                          transaction.status === "Paid"
                            ? "bg-success text-success-foreground"
                            : "bg-warning text-warning-foreground"
                        }
                      >
                        {transaction.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={transactionDetailOpen} onOpenChange={setTransactionDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
            <DialogDescription>Complete information for transaction</DialogDescription>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-muted-foreground">Date</Label>
                  <p className="font-semibold">{selectedTransaction.date}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge
                      className={
                        selectedTransaction.status === "Paid"
                          ? "bg-success text-success-foreground"
                          : "bg-warning text-warning-foreground"
                      }
                    >
                      {selectedTransaction.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Supplier</Label>
                  <p className="font-semibold">{selectedTransaction.supplier}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Payment Method</Label>
                  <Badge variant="outline">{selectedTransaction.method}</Badge>
                </div>
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Item</Label>
                  <p className="font-semibold">{selectedTransaction.item}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Quantity</Label>
                  <p className="font-semibold">{selectedTransaction.quantity}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Total Cost</Label>
                  <p className="font-semibold text-lg">{selectedTransaction.cost}</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Suppliers;
