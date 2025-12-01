import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Edit } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const mockSuppliers = [
  { name: "AutoParts Direct", contact: "John Doe", email: "john@autoparts.com", phone: "555-1001", address: "123 Main St", status: "Active", remarks: "Preferred supplier for engine parts" },
  { name: "Quality Motors Supply", contact: "Jane Smith", email: "jane@qms.com", phone: "555-1002", address: "456 Oak Ave", status: "Active", remarks: "Reliable delivery, 30-day payment terms" },
  { name: "Premium Oil Co", contact: "Bob Wilson", email: "bob@premiumoil.com", phone: "555-1003", address: "789 Pine Rd", status: "Active", remarks: "Bulk oil supplier, monthly orders" },
];

const mockTransactions = [
  { date: "2024-01-15", supplier: "AutoParts Direct", item: "Brake Pads", quantity: 20, cost: "$900", method: "Bank Transfer", status: "Paid" },
  { date: "2024-01-14", supplier: "Premium Oil Co", item: "Engine Oil 5W-30", quantity: 50, cost: "$425", method: "Credit", status: "Pending" },
  { date: "2024-01-13", supplier: "Quality Motors Supply", item: "Air Filter", quantity: 15, cost: "$225", method: "Cash", status: "Paid" },
  { date: "2024-01-12", supplier: "AutoParts Direct", item: "Spark Plugs", quantity: 30, cost: "$750", method: "Bank Transfer", status: "Paid" },
];

const Suppliers = () => {
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transactionDetailOpen, setTransactionDetailOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<typeof mockSuppliers[0] | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<typeof mockTransactions[0] | null>(null);
  const { toast } = useToast();

  const handleRowClick = (supplier: typeof mockSuppliers[0]) => {
    setSelectedSupplier(supplier);
    setDetailOpen(true);
  };

  const handleTransactionClick = (transaction: typeof mockTransactions[0]) => {
    setSelectedTransaction(transaction);
    setTransactionDetailOpen(true);
  };

  const handleDelete = () => {
    toast({
      title: "Supplier Deleted",
      description: `${selectedSupplier?.name} has been deleted successfully.`,
    });
    setDeleteOpen(false);
    setDetailOpen(false);
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Supplier Updated",
      description: `${selectedSupplier?.name} has been updated successfully.`,
    });
    setEditOpen(false);
    setDetailOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Suppliers</h1>
          <p className="text-muted-foreground">Manage supplier relationships and purchases</p>
        </div>
        <div className="flex gap-3">
          <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">Record Purchase</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record Purchase</DialogTitle>
                <DialogDescription>Record a new purchase from a supplier</DialogDescription>
              </DialogHeader>
              <form className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="supplier">Supplier</Label>
                  <Select>
                    <SelectTrigger id="supplier">
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {mockSuppliers.map((supplier, index) => (
                        <SelectItem key={index} value={supplier.name}>{supplier.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="item">Inventory Item</Label>
                  <Select>
                    <SelectTrigger id="item">
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="oil">Engine Oil 5W-30</SelectItem>
                      <SelectItem value="brake">Brake Pads</SelectItem>
                      <SelectItem value="filter">Air Filter</SelectItem>
                      <SelectItem value="coolant">Coolant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="purchaseQty">Quantity</Label>
                    <Input id="purchaseQty" type="number" placeholder="0" required />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="purchaseCost">Total Cost ($)</Label>
                    <Input id="purchaseCost" type="number" step="0.01" placeholder="0.00" required />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="paymentMethod">Payment Method</Label>
                  <Select>
                    <SelectTrigger id="paymentMethod">
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="bank">Bank Transfer</SelectItem>
                      <SelectItem value="credit">Credit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="paymentStatus">Payment Status</Label>
                  <Select defaultValue="paid">
                    <SelectTrigger id="paymentStatus">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
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

          <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" />
                Add Supplier
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Supplier</DialogTitle>
                <DialogDescription>Add a new supplier to your contacts</DialogDescription>
              </DialogHeader>
              <form className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="supplierName">Supplier Name</Label>
                  <Input id="supplierName" placeholder="AutoParts Direct" required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contactName">Contact Person</Label>
                  <Input id="contactName" placeholder="John Doe" required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="supplierEmail">Email Address</Label>
                  <Input id="supplierEmail" type="email" placeholder="contact@supplier.com" required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="supplierPhone">Phone Number</Label>
                  <Input id="supplierPhone" type="tel" placeholder="555-1001" required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" placeholder="123 Main St, City" required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="remarks">Remarks (Optional)</Label>
                  <Input id="remarks" placeholder="Add notes about the supplier..." />
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setSupplierOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-primary">
                    Add Supplier
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
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search suppliers..." className="pl-10" />
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
                  <th className="p-3 text-left text-sm font-medium">Status</th>
                  <th className="p-3 text-left text-sm font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {mockSuppliers.map((supplier, index) => (
                  <tr 
                    key={index} 
                    className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => handleRowClick(supplier)}
                  >
                    <td className="p-3 font-medium">{supplier.name}</td>
                    <td className="p-3">{supplier.contact}</td>
                    <td className="p-3 text-muted-foreground">{supplier.email}</td>
                    <td className="p-3 text-muted-foreground">{supplier.phone}</td>
                    <td className="p-3">
                      <Badge className="bg-success text-success-foreground">{supplier.status}</Badge>
                    </td>
                    <td className="p-3 text-muted-foreground text-sm max-w-[200px] truncate">{supplier.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Supplier Detail Modal */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Supplier Details</DialogTitle>
            <DialogDescription>Complete information for {selectedSupplier?.name}</DialogDescription>
          </DialogHeader>
          {selectedSupplier && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Supplier Name</Label>
                  <p className="font-semibold">{selectedSupplier.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge className="bg-success text-success-foreground">{selectedSupplier.status}</Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Contact Person</Label>
                  <p className="font-semibold">{selectedSupplier.contact}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Phone</Label>
                  <p className="font-semibold">{selectedSupplier.phone}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Email</Label>
                  <p className="font-semibold">{selectedSupplier.email}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Address</Label>
                  <p className="font-semibold">{selectedSupplier.address}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Remarks</Label>
                  <p className="font-semibold">{selectedSupplier.remarks}</p>
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
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Supplier Modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Supplier</DialogTitle>
            <DialogDescription>Update supplier details for {selectedSupplier?.name}</DialogDescription>
          </DialogHeader>
          {selectedSupplier && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="editSupplierName">Supplier Name</Label>
                  <Input id="editSupplierName" defaultValue={selectedSupplier.name} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editContact">Contact Person</Label>
                  <Input id="editContact" defaultValue={selectedSupplier.contact} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editPhone">Phone Number</Label>
                  <Input id="editPhone" defaultValue={selectedSupplier.phone} />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="editEmail">Email Address</Label>
                  <Input id="editEmail" type="email" defaultValue={selectedSupplier.email} />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="editAddress">Address</Label>
                  <Input id="editAddress" defaultValue={selectedSupplier.address} />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="editRemarks">Remarks</Label>
                  <Input id="editRemarks" defaultValue={selectedSupplier.remarks} />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-primary">
                  Save Changes
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
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedSupplier?.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Past Transactions Section */}
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
                    key={index} 
                    className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
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
                      <Badge className={transaction.status === "Paid" ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}>
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

      {/* Transaction Detail Modal */}
      <Dialog open={transactionDetailOpen} onOpenChange={setTransactionDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
            <DialogDescription>Complete information for transaction</DialogDescription>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Date</Label>
                  <p className="font-semibold">{selectedTransaction.date}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge className={selectedTransaction.status === "Paid" ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}>
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
                  <div className="mt-1">
                    <Badge variant="outline">{selectedTransaction.method}</Badge>
                  </div>
                </div>
                <div className="col-span-2">
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
